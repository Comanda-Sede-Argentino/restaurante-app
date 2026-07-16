// Impresión de comandas en impresora térmica (Windows).
// Estrategia compatible: genera el texto de la comanda y lo manda a la impresora
// instalada en Windows con Out-Printer (driver GDI; el driver térmico maneja ancho y corte).
// Si no hay impresora configurada para el sector, guarda la comanda como .txt
// en backend/comandas_impresas/ (sirve de respaldo y para probar sin hardware).
import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const OUT_DIR = path.join(__dirname, 'comandas_impresas');
fs.mkdirSync(OUT_DIR, { recursive: true });

const defaultConfig = {
  impresion: {
    habilitada: true,
    anchoColumnas: 42,
    modo: 'escpos', // 'escpos' (térmica, texto destacado) | 'texto' (impresora común GDI)
    conexion: 'windows', // 'windows' (impresora instalada) | 'serial' (puerto COM directo)
    impresoraComanda: '', // impresora Windows de las COMANDAS de cocina (si conexion=windows)
    impresoraCuenta: '', // impresora Windows de las CUENTAS/tickets (caja). Vacío = usa la de comandas.
    anchoCuenta: 0, // ancho (columnas) de la impresora de cuentas. 0 = usar anchoColumnas.
    imprimirBebidas: false, // si true, imprime un ticket aparte con las BEBIDAS (para la barra)
    impresoraBebidas: '', // impresora del ticket de bebidas. Vacío = usa la de comandas.
    anchoBebidas: 0, // ancho del ticket de bebidas. 0 = usar anchoColumnas.
    sonidoComanda: false, // si true, la impresora suena una chicharra al imprimir cada comanda (para la cocina)
    puertoCom: '', // ej. 'COM1' (si conexion=serial)
    baud: 9600, // velocidad del puerto serial
    porSector: {}, // compatibilidad: { "Cocina": "Nombre Impresora", ... }
    impresoraPorDefecto: '',
  },
  whatsapp: {
    habilitado: true,
    autoRespuesta: true,
    cooldownMin: 180, // no repetir la auto-respuesta al mismo número dentro de este lapso
    palabrasPedido: [
      'pedido', 'pedir', 'encargar', 'encargo', 'quiero', 'quisiera', 'querria',
      'mandame', 'manda', 'enviar', 'envien', 'envienme', 'delivery', 'para llevar',
      'llevar', 'necesito', 'me traes', 'traeme', 'comprar', 'ordenar', 'anotar', 'agregar',
    ],
    textoRecepcion:
      '¡Hola! 👋 Recibimos tu pedido en Sede Social. En unos minutos te lo confirmamos. ¡Gracias!',
    textoConsulta:
      '¡Hola! 👋 Gracias por escribir a Sede Social. En breve te respondemos. Si querés hacer un pedido, escribinos con la palabra "pedido" junto con lo que querés encargar. 🍽️',
  },
  telegram: {
    habilitado: false,
    token: '', // token del bot (de @BotFather)
    autorizados: [], // IDs de chat de Telegram autorizados a mandar pedidos
    claveIA: '', // clave de API de Claude (Anthropic) para interpretar el pedido
    modeloIA: 'claude-sonnet-4-6', // Sonnet: mejor interpretación de pedidos (cambiable en Ajustes)
    claveVoz: '', // clave de OpenAI (Whisper) para transcribir notas de voz. Vacío = audios desactivados.
    costoEnvio: 0, // cargo de delivery que se suma al total (0 = sin cargo)
    guarnicionDefault: 'papas fritas', // guarnición por defecto si el cliente no aclara
    confirmar: false, // si true, el bot muestra el pedido y espera "SÍ" antes de imprimir
  },
  cocina: {
    // Guarniciones que aparecen como botones rápidos al cargar platos con guarnición
    guarniciones: ['Papas fritas', 'Puré', 'Ensalada mixta', 'Rúcula con queso', 'Puré mixto'],
  },
  backup: {
    // Carpeta EXTERNA donde copiar los respaldos (pendrive o carpeta de Google Drive/OneDrive).
    // Ej: "E:\\respaldos" o "C:\\Users\\...\\Google Drive\\SedeSocial". Vacío = solo respaldo local.
    rutaExterna: '',
  },
  caja: {
    // Avisar "cerrá la caja" si pasan más de estas horas con ventas sin cerrar (0 = sin aviso)
    avisarHoras: 8,
  },
  facturador: {
    habilitado: false, // muestra el botón "Facturar" en Caja
    url: 'http://localhost:5000', // dirección del facturador AFIP (misma PC = localhost:5000)
  },
};

export function getConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, ''));
    c.impresion = { ...defaultConfig.impresion, ...(c.impresion || {}) };
    c.whatsapp = { ...defaultConfig.whatsapp, ...(c.whatsapp || {}) };
    c.telegram = { ...defaultConfig.telegram, ...(c.telegram || {}) };
    c.cocina = { ...defaultConfig.cocina, ...(c.cocina || {}) };
    c.backup = { ...defaultConfig.backup, ...(c.backup || {}) };
    c.caja = { ...defaultConfig.caja, ...(c.caja || {}) };
    c.facturador = { ...defaultConfig.facturador, ...(c.facturador || {}) };
    return c;
  } catch {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    return JSON.parse(JSON.stringify(defaultConfig));
  }
}

const MASK = '••••••••';

export function setConfig(nuevo) {
  const c = getConfig();
  c.impresion = { ...c.impresion, ...(nuevo.impresion || {}) };
  c.whatsapp = { ...c.whatsapp, ...(nuevo.whatsapp || {}) };
  c.cocina = { ...c.cocina, ...(nuevo.cocina || {}) };
  c.backup = { ...c.backup, ...(nuevo.backup || {}) };
  c.caja = { ...c.caja, ...(nuevo.caja || {}) };
  c.facturador = { ...c.facturador, ...(nuevo.facturador || {}) };
  const tg = { ...c.telegram, ...(nuevo.telegram || {}) };
  // No sobreescribir los secretos si llegan enmascarados desde el frontend
  if (tg.token === MASK) tg.token = c.telegram.token;
  if (tg.claveIA === MASK) tg.claveIA = c.telegram.claveIA;
  if (tg.claveVoz === MASK) tg.claveVoz = c.telegram.claveVoz;
  c.telegram = tg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
  return getConfigPublic();
}

// Igual que getConfig pero con los secretos enmascarados (para el frontend)
export function getConfigPublic() {
  const c = getConfig();
  return {
    ...c,
    telegram: {
      ...c.telegram,
      token: c.telegram.token ? MASK : '',
      claveIA: c.telegram.claveIA ? MASK : '',
      claveVoz: c.telegram.claveVoz ? MASK : '',
    },
  };
}

// Lista las impresoras instaladas en Windows
export function listarImpresoras() {
  return new Promise((resolve) => {
    exec(
      'powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"',
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      }
    );
  });
}

const sinAcentos = (s) => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '');
const money = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-AR');
const linea = (w, c = '=') => c.repeat(w);
const centrar = (t, w) => {
  t = String(t).slice(0, w);
  const pad = Math.max(0, Math.floor((w - t.length) / 2));
  return ' '.repeat(pad) + t;
};
// Corta un texto en renglones por PALABRAS (no parte palabras al medio).
// Si una palabra es más larga que el ancho, recién ahí la corta duro.
function wrapPalabras(s, w) {
  const lines = [];
  let cur = '';
  const push = () => { if (cur) { lines.push(cur); cur = ''; } };
  for (let word of String(s).split(/\s+/).filter(Boolean)) {
    while (word.length > w) { push(); lines.push(word.slice(0, w)); word = word.slice(w); }
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= w) cur += ' ' + word;
    else { push(); cur = word; }
  }
  push();
  return lines.length ? lines : [''];
}
function origenDe(pedido) {
  if (pedido.tipo === 'salon') return 'MESA ' + (pedido.mesa?.numero ?? pedido.mesa_id ?? '?');
  if (pedido.tipo === 'delivery') return 'DELIVERY';
  return 'MOSTRADOR';
}

// Un ticket puede ser COMANDA (a cocina) o CUENTA (para el cliente).
// - Salón + comanda: solo platos, SIN precios (a la cocina no le sirven).
// - Delivery + comanda: con datos del cliente, hora y precios.
// - Cuenta (cualquiera): siempre con precios y TOTAL.
function llevaPrecios(pedido, cuenta) { return cuenta || pedido.tipo !== 'salon'; }

// ---------- Ticket en texto (respaldo en archivo y modo 'texto') ----------
export function construirTicketTexto(pedido, items, w = 42, cuenta = false) {
  const L = [];
  const origen = origenDe(pedido);
  const precios = llevaPrecios(pedido, cuenta);
  L.push(linea(w));
  L.push(centrar('*** ' + (cuenta ? 'CUENTA - ' + origen : origen) + ' ***', w));
  L.push(linea(w));
  L.push('Pedido #' + pedido.id + '   ' + new Date().toLocaleString('es-AR'));
  if (!cuenta && pedido.mozo_nombre) L.push('Mozo: ' + pedido.mozo_nombre);
  if (!cuenta && pedido.hora_entrega) L.push('>>> ENTREGAR: ' + pedido.hora_entrega + ' <<<');
  if (pedido.tipo === 'delivery') {
    if (pedido.cliente_nombre) L.push('Cliente: ' + pedido.cliente_nombre);
    if (pedido.cliente_direccion) L.push('Direccion: ' + pedido.cliente_direccion);
    if (pedido.cliente_telefono) L.push('Tel: ' + pedido.cliente_telefono);
  }
  L.push(linea(w, '-'));
  let total = 0;
  for (const it of items) {
    total += it.cantidad * it.precio_unit;
    const izq = it.cantidad + ' x ' + (it.nombre || '').toUpperCase();
    if (precios) {
      const sub = money(it.cantidad * it.precio_unit);
      L.push(izq + ' '.repeat(Math.max(1, w - izq.length - sub.length)) + sub);
    } else {
      L.push(izq);
    }
    if (it.observacion) L.push('   >> ' + it.observacion);
  }
  if (precios) {
    L.push(linea(w, '-'));
    const tot = 'TOTAL: ' + money(total);
    L.push(' '.repeat(Math.max(0, w - tot.length)) + tot);
  }
  L.push(linea(w));
  L.push(''); L.push('');
  return L.join('\r\n');
}

// ---------- Ticket en ESC/POS (térmica, con texto destacado) ----------
const ESC = 0x1b, GS = 0x1d;
function construirTicketEscpos(pedido, items, cuenta = false, ancho = 32, titulo = '', sonido = false) {
  const b = [];
  const W = ancho > 0 ? ancho : 32; // ancho en caracteres (58mm=32, 80mm=48)
  const raw = (...x) => b.push(...x);
  const txt = (s) => { for (const c of Buffer.from(sinAcentos(s), 'latin1')) b.push(c); };
  const nl = () => b.push(0x0a);
  const align = (n) => raw(ESC, 0x61, n);   // 0 izq, 1 centro, 2 der
  const sep = () => { txt('-'.repeat(W)); nl(); };
  // Tamaño/estilo en el "idioma" que la TM-T58 entiende: mandamos ESC ! y GS ! JUNTOS
  // (esta impresora es finicky con la fuente; uno u otro le hace caso). Bits ESC !:
  // 0x08 negrita | 0x10 doble alto | 0x20 doble ancho. GS ! n = alto|ancho (x2).
  const estilo = (escBits, gsMag) => { raw(ESC, 0x21, escBits); raw(GS, 0x21, gsMag); raw(ESC, 0x45, (escBits & 0x08) ? 1 : 0); };
  const NORMAL = () => estilo(0x00, 0x00);
  const BOLD = () => estilo(0x08, 0x00);                 // negrita, tamaño normal
  const ALTO = () => estilo(0x18, 0x01);                 // doble alto + negrita
  const TITULO = () => estilo(0x18, 0x02);               // triple alto + negrita (nombre del plato)
  const GRANDE = () => estilo(0x38, 0x11);               // doble alto + doble ancho + negrita
  const precios = llevaPrecios(pedido, cuenta);

  raw(ESC, 0x40); // init
  // Encabezado bien GRANDE (BEBIDAS / CUENTA / DELIVERY / MESA)
  align(1); GRANDE();
  txt(titulo || (cuenta ? 'CUENTA' : origenDe(pedido))); nl();
  if (titulo || cuenta) { txt(origenDe(pedido)); nl(); }
  NORMAL(); align(0);
  txt('Pedido #' + pedido.id + '  ' + new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })); nl();
  if (!cuenta && pedido.mozo_nombre) { ALTO(); txt('Mozo: ' + pedido.mozo_nombre); NORMAL(); nl(); }
  if (pedido.tipo === 'delivery') {
    if (pedido.cliente_nombre) { ALTO(); txt(pedido.cliente_nombre); NORMAL(); nl(); }
    if (pedido.cliente_direccion) { BOLD(); txt('Dir: ' + pedido.cliente_direccion); NORMAL(); nl(); }
    if (pedido.cliente_telefono) { txt('Tel: ' + pedido.cliente_telefono); nl(); }
  }
  if (!cuenta && pedido.hora_entrega) { nl(); align(1); GRANDE(); txt('ENTREGAR ' + pedido.hora_entrega); nl(); NORMAL(); align(0); }
  sep();
  nl(); // aire después del encabezado
  // Nombre del plato BIEN GRANDE. En 80mm (papel ancho) lo hacemos DOBLE ANCHO para que las letras
  // no queden apretadas; en 58mm se mantiene ancho normal para que el nombre entre completo.
  const platoAncho = W >= 42;
  const PLATO = () => estilo(platoAncho ? 0x38 : 0x18, platoAncho ? 0x12 : 0x02);
  const wPlato = platoAncho ? Math.floor(W / 2) : W;
  let total = 0;
  items.forEach((it, idx) => {
    if (idx > 0) { NORMAL(); sep(); }   // línea entre plato y plato
    total += it.cantidad * it.precio_unit;
    // Cantidad + nombre en letra grande: "2x MILANESA" (la "x" evita confundir el número)
    PLATO();
    for (const ln of wrapPalabras(it.cantidad + 'x ' + (it.nombre || '').toUpperCase(), wPlato)) { txt(ln); nl(); }
    NORMAL();
    if (it.observacion) { ALTO(); for (const ln of wrapPalabras('>> ' + it.observacion, W)) { txt(ln); nl(); } NORMAL(); }
    if (precios) { align(2); BOLD(); txt(money(it.cantidad * it.precio_unit)); NORMAL(); nl(); align(0); }
  });
  // Pie: en la comanda de salón (sin precios) mostramos cuántos ítems, para que la cocina cuente rápido.
  if (!cuenta && !precios) {
    const unidades = items.filter((it) => it.plato_id).reduce((a, it) => a + (Number(it.cantidad) || 0), 0);
    if (unidades > 0) { sep(); align(1); ALTO(); txt(unidades + (unidades === 1 ? ' ITEM' : ' ITEMS')); NORMAL(); align(0); nl(); }
  }
  if (precios) {
    sep();
    align(2); GRANDE(); txt('TOTAL ' + money(total)); nl(); NORMAL(); align(0);
  }
  NORMAL();
  if (sonido) raw(ESC, 0x42, 0x05, 0x09); // chicharra (ESC B): avisa a la cocina que salió una comanda
  raw(0x0a, 0x0a, 0x0a);
  raw(GS, 0x56, 66, 0); // corte parcial
  return Buffer.from(b);
}

// Envío en TEXTO plano vía driver de Windows (Out-Printer / GDI)
function imprimirTextoGDI(texto, impresora) {
  return new Promise((resolve) => {
    const tmp = path.join(OUT_DIR, `_tmp_${Date.now()}_${Math.floor(Math.random() * 1e6)}.txt`);
    fs.writeFileSync(tmp, texto, 'latin1');
    const ps1 = path.join(__dirname, 'textprint.ps1');
    // Pasar nombre de impresora y ruta como parámetros del .ps1 (no por -Command): evita inyección.
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-File', tmp];
    if (impresora) args.push('-Printer', impresora);
    const ps = spawn('powershell', args, { windowsHide: true });
    ps.on('close', (code) => { fs.unlink(tmp, () => {}); resolve(code === 0); });
    ps.on('error', () => resolve(false));
  });
}

// Cantidad de trabajos en la cola de la impresora de comandas (para detectar que se trancó).
// Devuelve { count, printer }. count = -1 si no aplica (serial o sin impresora).
export function colaImpresora() {
  return new Promise((resolve) => {
    const { impresion } = getConfig();
    const printer = impresoraComanda(impresion);
    if (impresion.conexion === 'serial' || !printer) return resolve({ count: -1, printer: null });
    // Contamos SOLO los trabajos con un problema real (sin papel / apagada / pausada / error),
    // no los que estan normales o ya impresos pero "retenidos" en la cola (driver Generic/Text Only).
    const ps = spawn('powershell', ['-NoProfile', '-Command',
      `try { @(Get-PrintJob -PrinterName '${printer.replace(/'/g, "''")}' -ErrorAction Stop | Where-Object { "$($_.JobStatus)" -match 'Error|Offline|PaperOut|Paused|Blocked|UserIntervention' }).Count } catch { 0 }`],
      { windowsHide: true });
    let out = '';
    ps.stdout.on('data', (d) => { out += d; });
    ps.on('close', () => resolve({ count: parseInt(out.trim(), 10) || 0, printer }));
    ps.on('error', () => resolve({ count: -1, printer }));
  });
}

// Lista los puertos serie (COM) disponibles en Windows
export function listarPuertosCom() {
  return new Promise((resolve) => {
    exec(
      'powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames()"',
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      }
    );
  });
}

// Envío RAW de bytes ESC/POS a un puerto serie (COM) vía serialprint.ps1
function imprimirSerial(bytes, puerto, baud) {
  return new Promise((resolve) => {
    const tmp = path.join(OUT_DIR, `_tmp_${Date.now()}_${Math.floor(Math.random() * 1e6)}.bin`);
    fs.writeFileSync(tmp, bytes);
    const ps1 = path.join(__dirname, 'serialprint.ps1');
    const ps = spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1,
      '-Port', puerto, '-Baud', String(baud || 9600), '-File', tmp,
    ], { windowsHide: true });
    ps.on('close', (code) => { fs.unlink(tmp, () => {}); resolve(code === 0); });
    ps.on('error', () => resolve(false));
  });
}

// Envío RAW de bytes ESC/POS vía winspool (rawprint.ps1)
function imprimirRaw(bytes, impresora) {
  return new Promise((resolve) => {
    const tmp = path.join(OUT_DIR, `_tmp_${Date.now()}_${Math.floor(Math.random() * 1e6)}.bin`);
    fs.writeFileSync(tmp, bytes);
    const ps1 = path.join(__dirname, 'rawprint.ps1');
    const ps = spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1,
      '-Printer', impresora, '-File', tmp,
    ], { windowsHide: true });
    ps.on('close', (code) => { fs.unlink(tmp, () => {}); resolve(code === 0); });
    ps.on('error', () => resolve(false));
  });
}

function impresoraComanda(impresion, override) {
  return override || impresion.impresoraComanda || impresion.impresoraPorDefecto ||
    Object.values(impresion.porSector || {}).find(Boolean) || '';
}

// Imprime un ticket (comanda o cuenta). Respaldo siempre en archivo .txt
async function imprimirTicket(pedido, items, { cuenta = false, impresoraOverride } = {}) {
  const { impresion } = getConfig();
  // La CUENTA puede salir por otra impresora (ej. la de caja) y con otro ancho de papel.
  const ancho = (cuenta && Number(impresion.anchoCuenta) > 0) ? Number(impresion.anchoCuenta) : (impresion.anchoColumnas || 42);
  // Chicharra: solo en COMANDAS (no en la cuenta del cliente), para avisar en la cocina.
  const sonido = !cuenta && !!impresion.sonidoComanda;
  const texto = construirTicketTexto(pedido, items, ancho, cuenta);
  const prefijo = cuenta ? 'cuenta' : 'comanda';
  const archivo = path.join(OUT_DIR, `${prefijo}_pedido${pedido.id}_${Date.now()}.txt`);
  try { fs.writeFileSync(archivo, texto, 'latin1'); }
  catch (e) { console.error('No se pudo guardar respaldo de comanda:', e.message); }

  if (!impresion.habilitada && !impresoraOverride) return { ok: true, modo: 'deshabilitada', archivo };

  // Conexión por puerto serial (COM): se manda ESC/POS directo al puerto.
  if (impresion.conexion === 'serial' && impresion.puertoCom && !impresoraOverride) {
    const ok = await imprimirSerial(construirTicketEscpos(pedido, items, cuenta, ancho, '', sonido), impresion.puertoCom, impresion.baud);
    return { ok, modo: ok ? 'impreso' : 'error-impresion', destino: impresion.puertoCom, archivo };
  }

  // Impresora de Windows: comandas -> impresora de cocina; cuentas -> impresora de caja (si está configurada).
  let impresora = impresoraOverride;
  if (!impresora) impresora = (cuenta && impresion.impresoraCuenta) ? impresion.impresoraCuenta : impresoraComanda(impresion);
  if (!impresora) return { ok: true, modo: 'archivo', archivo };

  let ok;
  if (impresion.modo === 'texto') ok = await imprimirTextoGDI(texto, impresora);
  else ok = await imprimirRaw(construirTicketEscpos(pedido, items, cuenta, ancho, '', sonido), impresora);
  return { ok, modo: ok ? 'impreso' : 'error-impresion', impresora, archivo };
}

// Comanda a cocina (no lleva precios en salón). NO cierra la mesa.
export async function imprimirComandaUnica(pedido, items, impresoraOverride) {
  return imprimirTicket(pedido, items, { cuenta: false, impresoraOverride });
}

// Cuenta para el cliente (siempre con precios y TOTAL). NO cierra la mesa.
export async function imprimirCuenta(pedido, items, impresoraOverride) {
  return imprimirTicket(pedido, items, { cuenta: true, impresoraOverride });
}

// Ticket aparte de BEBIDAS para la barra (solo si está activado en Ajustes).
export async function imprimirBebidas(pedido, bebidas) {
  const { impresion } = getConfig();
  if (!impresion.imprimirBebidas) return { ok: true, modo: 'off' };
  if (!bebidas || !bebidas.length) return { ok: true, modo: 'sin-bebidas' };
  const ancho = Number(impresion.anchoBebidas) > 0 ? Number(impresion.anchoBebidas) : (impresion.anchoColumnas || 42);
  const texto = construirTicketTexto(pedido, bebidas, ancho, false);
  const archivo = path.join(OUT_DIR, `bebidas_pedido${pedido.id}_${Date.now()}.txt`);
  try { fs.writeFileSync(archivo, texto, 'latin1'); } catch (e) { console.error('respaldo bebidas:', e.message); }
  if (!impresion.habilitada) return { ok: true, modo: 'archivo', archivo };
  const impresora = impresion.impresoraBebidas || impresion.impresoraComanda || '';
  if (!impresora) return { ok: true, modo: 'archivo', archivo };
  let ok;
  if (impresion.modo === 'texto') ok = await imprimirTextoGDI(texto, impresora);
  else ok = await imprimirRaw(construirTicketEscpos(pedido, bebidas, false, ancho, 'BEBIDAS', !!impresion.sonidoComanda), impresora);
  return { ok, modo: ok ? 'impreso' : 'error-impresion', impresora, archivo };
}

// Imprime texto libre (ej. arqueo / cierre de caja). Título centrado y líneas tal cual.
export async function imprimirTextoPlano(titulo, lineas) {
  const { impresion } = getConfig();
  const w = impresion.anchoColumnas || 42;
  const cuerpo = [linea(w), centrar(titulo, w), linea(w), ...lineas, linea(w)].join('\r\n');
  const archivo = path.join(OUT_DIR, `cierre_${Date.now()}.txt`);
  try { fs.writeFileSync(archivo, cuerpo, 'latin1'); } catch (e) { console.error('respaldo cierre:', e.message); }
  if (!impresion.habilitada) return { ok: true, modo: 'archivo', archivo };

  // ESC/POS: init + texto + avance + corte
  const b = [ESC, 0x40];
  for (const c of Buffer.from(sinAcentos(cuerpo) + '\n', 'latin1')) b.push(c);
  b.push(0x0a, 0x0a, 0x0a, GS, 0x56, 66, 0);
  const bytes = Buffer.from(b);

  if (impresion.conexion === 'serial' && impresion.puertoCom) {
    const ok = await imprimirSerial(bytes, impresion.puertoCom, impresion.baud);
    return { ok, modo: ok ? 'impreso' : 'error-impresion', destino: impresion.puertoCom, archivo };
  }
  const impresora = impresoraComanda(impresion);
  if (!impresora) return { ok: true, modo: 'archivo', archivo };
  const ok = impresion.modo === 'texto'
    ? await imprimirTextoGDI(cuerpo, impresora)
    : await imprimirRaw(bytes, impresora);
  return { ok, modo: ok ? 'impreso' : 'error-impresion', impresora, archivo };
}
