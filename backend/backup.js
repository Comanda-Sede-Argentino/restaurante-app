// Copias de seguridad automáticas de la base de datos.
// Hace un backup al arrancar y cada 6 horas, y conserva las últimas 14 copias.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { getConfig } from './printer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'backups');
fs.mkdirSync(DIR, { recursive: true });
const MAX_COPIAS = 14;

function sello() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function hacerBackup() {
  const dest = path.join(DIR, `restaurante-${sello()}.db`);
  const tmp = dest + '.tmp';
  await db.backup(tmp); // backup online seguro (no corta el uso)
  fs.renameSync(tmp, dest); // publicar solo si terminó OK
  // Conservar solo las últimas N copias
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.startsWith('restaurante-') && f.endsWith('.db'))
    .sort();
  while (files.length > MAX_COPIAS) {
    try { fs.unlinkSync(path.join(DIR, files.shift())); } catch { /* ignorar */ }
  }
  copiarAExterno(dest); // copia extra fuera de la PC (si está configurada y disponible)
  return dest;
}

// Copia el respaldo a una carpeta externa (pendrive / Google Drive). Nunca tumba el backup local.
function copiarAExterno(origen) {
  let ruta = '';
  try { ruta = (getConfig().backup || {}).rutaExterna || ''; } catch { ruta = ''; }
  if (!ruta) return;
  try {
    if (!fs.existsSync(ruta)) { // pendrive desconectado / carpeta no disponible: se ignora sin romper
      console.warn('  Backup externo: la carpeta no está disponible (' + ruta + ')');
      return;
    }
    fs.copyFileSync(origen, path.join(ruta, path.basename(origen)));
    const ext = fs.readdirSync(ruta)
      .filter((f) => f.startsWith('restaurante-') && f.endsWith('.db'))
      .sort();
    while (ext.length > MAX_COPIAS) {
      try { fs.unlinkSync(path.join(ruta, ext.shift())); } catch { /* ignorar */ }
    }
    console.log('  Backup externo OK:', path.basename(origen), '->', ruta);
  } catch (e) {
    console.error('  Backup externo falló (se ignora):', e.message);
  }
}

export function listarBackups() {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.db'))
    .sort()
    .reverse()
    .map((f) => ({ archivo: f, ruta: path.join(DIR, f) }));
}

export function iniciarBackups() {
  hacerBackup()
    .then((d) => console.log('  Backup inicial OK:', path.basename(d)))
    .catch((e) => console.error('  Backup error:', e.message));
  setInterval(() => {
    hacerBackup()
      .then((d) => console.log('  Backup OK:', path.basename(d)))
      .catch((e) => console.error('  Backup error:', e.message));
  }, 6 * 60 * 60 * 1000);
}
