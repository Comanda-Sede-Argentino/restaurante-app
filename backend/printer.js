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
    impresoraComanda: '', // impresora Windows donde sale la comanda (si conexion=windows)
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
};

export function getConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, ''));
    c.impresion = { ...defaultConfig.impresion, ...(c.impresion || {}) };
    c.whatsapp = { ...defaultConfig.whatsapp, ...(c.whatsapp || {}) };
    return c;
  } catch {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    return JSON.parse(JSON.stringify(defaultConfig));
  }
}

export function setConfig(nuevo) {
  const c = getConfig();
  c.impresion = { ...c.impresion, ...(nuevo.impresion || {}) };
  c.whatsapp = { ...c.whatsapp, ...(nuevo.whatsapp || {}) };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
  return c;
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
function construirTicketEscpos(pedido, items, cuenta = false) {
  const b = [];
  const raw = (...x) => b.push(...x);
  const txt = (s) => { for (const c of Buffer.from(sinAcentos(s), 'latin1')) b.push(c); };
  const nl = () => b.push(0x0a);
  const align = (n) => raw(ESC, 0x61, n);   // 0 izq, 1 centro, 2 der
  const bold = (on) => raw(ESC, 0x45, on ? 1 : 0);
  const grande = (on) => raw(GS, 0x21, on ? 0x11 : 0x00); // doble alto y ancho
  const precios = llevaPrecios(pedido, cuenta);

  raw(ESC, 0x40); // init
  // Encabezado DESTACADO (CUENTA / DELIVERY / MESA)
  align(1); bold(1); grande(1);
  txt(cuenta ? 'CUENTA' : origenDe(pedido)); nl();
  if (cuenta) { txt(origenDe(pedido)); nl(); }
  grande(0); bold(0); align(0);
  txt('Pedido #' + pedido.id + '  ' + new Date().toLocaleString('es-AR')); nl();
  if (!cuenta && pedido.mozo_nombre) { bold(1); txt('Mozo: ' + pedido.mozo_nombre); bold(0); nl(); }
  if (pedido.tipo === 'delivery') {
    if (pedido.cliente_nombre) { bold(1); txt('Cliente: ' + pedido.cliente_nombre); bold(0); nl(); }
    if (pedido.cliente_direccion) { txt('Dir: ' + pedido.cliente_direccion); nl(); }
    if (pedido.cliente_telefono) { txt('Tel: ' + pedido.cliente_telefono); nl(); }
  }
  if (!cuenta && pedido.hora_entrega) { nl(); align(1); bold(1); grande(1); txt('ENTREGAR ' + pedido.hora_entrega); nl(); grande(0); bold(0); align(0); }
  txt('--------------------------------'); nl();
  let total = 0;
  for (const it of items) {
    total += it.cantidad * it.precio_unit;
    bold(1); grande(1);
    txt(it.cantidad + ' ' + (it.nombre || '').toUpperCase()); nl();
    grande(0); bold(0);
    if (it.observacion) { txt('   >> ' + it.observacion); nl(); }
    if (precios) { align(2); txt(money(it.cantidad * it.precio_unit)); nl(); align(0); }
  }
  if (precios) {
    txt('--------------------------------'); nl();
    align(2); bold(1); grande(1); txt('TOTAL ' + money(total)); nl(); grande(0); bold(0); align(0);
  }
  raw(0x0a, 0x0a, 0x0a, 0x0a);
  raw(GS, 0x56, 66, 0); // corte parcial
  return Buffer.from(b);
}

// Envío en TEXTO plano vía driver de Windows (Out-Printer / GDI)
function imprimirTextoGDI(texto, impresora) {
  return new Promise((resolve) => {
    const tmp = path.join(OUT_DIR, `_tmp_${Date.now()}_${Math.floor(Math.random() * 1e6)}.txt`);
    fs.writeFileSync(tmp, texto, 'latin1');
    const cmd = impresora
      ? `Get-Content -LiteralPath '${tmp}' -Encoding Default | Out-Printer -Name '${impresora.replace(/'/g, "''")}'`
      : `Get-Content -LiteralPath '${tmp}' -Encoding Default | Out-Printer`;
    const ps = spawn('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true });
    ps.on('close', (code) => { fs.unlink(tmp, () => {}); resolve(code === 0); });
    ps.on('error', () => resolve(false));
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
  const texto = construirTicketTexto(pedido, items, impresion.anchoColumnas, cuenta);
  const prefijo = cuenta ? 'cuenta' : 'comanda';
  const archivo = path.join(OUT_DIR, `${prefijo}_pedido${pedido.id}_${Date.now()}.txt`);
  fs.writeFileSync(archivo, texto, 'latin1');

  if (!impresion.habilitada && !impresoraOverride) return { ok: true, modo: 'deshabilitada', archivo };

  // Conexión por puerto serial (COM): se manda ESC/POS directo al puerto.
  if (impresion.conexion === 'serial' && impresion.puertoCom && !impresoraOverride) {
    const ok = await imprimirSerial(construirTicketEscpos(pedido, items, cuenta), impresion.puertoCom, impresion.baud);
    return { ok, modo: ok ? 'impreso' : 'error-impresion', destino: impresion.puertoCom, archivo };
  }

  // Conexión por impresora de Windows (USB/red instalada)
  const impresora = impresoraComanda(impresion, impresoraOverride);
  if (!impresora) return { ok: true, modo: 'archivo', archivo };

  let ok;
  if (impresion.modo === 'texto') ok = await imprimirTextoGDI(texto, impresora);
  else ok = await imprimirRaw(construirTicketEscpos(pedido, items, cuenta), impresora);
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
