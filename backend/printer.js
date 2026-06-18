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
    porSector: {}, // { "Cocina": "Nombre Impresora", "Barra": "...", ... }
    impresoraPorDefecto: '', // si un sector no tiene impresora, usa esta
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

const linea = (w) => '='.repeat(w);
const centrar = (t, w) => {
  t = t.slice(0, w);
  const pad = Math.max(0, Math.floor((w - t.length) / 2));
  return ' '.repeat(pad) + t;
};

// Construye el texto de la comanda para un sector
export function construirComanda(pedido, items, sector, w = 42) {
  const L = [];
  L.push(centrar('*** COMANDA ' + sector.toUpperCase() + ' ***', w));
  L.push(linea(w));
  const origen =
    pedido.tipo === 'salon'
      ? 'MESA ' + (pedido.mesa?.numero ?? pedido.mesa_id ?? '?')
      : pedido.tipo === 'delivery'
      ? 'DELIVERY'
      : 'MOSTRADOR';
  L.push(origen + '   Pedido #' + pedido.id);
  if (pedido.mozo_nombre) L.push('Mozo: ' + pedido.mozo_nombre);
  if (pedido.tipo === 'delivery') {
    if (pedido.cliente_nombre) L.push('Cliente: ' + pedido.cliente_nombre);
    if (pedido.cliente_direccion) L.push('Dir: ' + pedido.cliente_direccion);
    if (pedido.cliente_telefono) L.push('Tel: ' + pedido.cliente_telefono);
  }
  const ahora = new Date().toLocaleString('es-AR');
  L.push(ahora);
  L.push(linea(w));
  for (const it of items) {
    L.push(it.cantidad + ' x ' + it.nombre);
    if (it.observacion) L.push('   >> ' + it.observacion);
  }
  L.push(linea(w));
  L.push('');
  L.push('');
  return L.join('\r\n');
}

function imprimirTexto(texto, impresora) {
  return new Promise((resolve) => {
    const tmp = path.join(OUT_DIR, `_tmp_${Date.now()}_${Math.floor(Math.random() * 1e6)}.txt`);
    fs.writeFileSync(tmp, texto, 'latin1');
    // Out-Printer renderiza texto con el driver de Windows (compatible con térmicas)
    const cmd = impresora
      ? `Get-Content -LiteralPath '${tmp}' -Encoding Default | Out-Printer -Name '${impresora.replace(/'/g, "''")}'`
      : `Get-Content -LiteralPath '${tmp}' -Encoding Default | Out-Printer`;
    const ps = spawn('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true });
    ps.on('close', (code) => {
      fs.unlink(tmp, () => {});
      resolve(code === 0);
    });
    ps.on('error', () => resolve(false));
  });
}

// Imprime (o archiva) la comanda de un sector
export async function imprimirComanda(pedido, items, sector, impresoraOverride) {
  const { impresion } = getConfig();
  const texto = construirComanda(pedido, items, sector, impresion.anchoColumnas);
  // Respaldo siempre en archivo
  const archivo = path.join(
    OUT_DIR,
    `pedido${pedido.id}_${sector}_${Date.now()}.txt`.replace(/[^\w.\-]/g, '_')
  );
  fs.writeFileSync(archivo, texto, 'latin1');

  if (!impresion.habilitada && !impresoraOverride) return { ok: true, modo: 'deshabilitada', archivo };
  const impresora = impresoraOverride || impresion.porSector?.[sector] || impresion.impresoraPorDefecto || '';
  if (!impresora) return { ok: true, modo: 'archivo', archivo };
  const ok = await imprimirTexto(texto, impresora);
  return { ok, modo: ok ? 'impreso' : 'error-impresion', impresora, archivo };
}

// Agrupa los items por sector e imprime una comanda por sector
export async function imprimirPorSectores(pedido, items) {
  const grupos = {};
  for (const it of items) {
    const s = it.sector_nombre || 'Cocina';
    (grupos[s] = grupos[s] || []).push(it);
  }
  const res = [];
  for (const [sector, its] of Object.entries(grupos)) {
    res.push(await imprimirComanda(pedido, its, sector));
  }
  return res;
}
