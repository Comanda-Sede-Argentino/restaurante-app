// Copias de seguridad automáticas de la base de datos.
// Hace un backup al arrancar y cada 6 horas, y conserva las últimas 14 copias.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

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
  await db.backup(dest); // backup online seguro (no corta el uso)
  // Conservar solo las últimas N copias
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.startsWith('restaurante-') && f.endsWith('.db'))
    .sort();
  while (files.length > MAX_COPIAS) {
    try { fs.unlinkSync(path.join(DIR, files.shift())); } catch { /* ignorar */ }
  }
  return dest;
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
