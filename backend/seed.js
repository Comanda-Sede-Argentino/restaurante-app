// Carga inicial: sectores de cocina, categorías, platos (datos reales extraídos del
// sistema legado MRC en C:\sistemas), usuarios y mesas de ejemplo.
import db from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const yaCargado = db.prepare('SELECT COUNT(*) c FROM plato').get().c;
if (yaCargado > 0) {
  console.log(`Seed omitido: ya hay ${yaCargado} platos cargados.`);
  process.exit(0);
}

const SECTORES = ['Cocina', 'Parrilla', 'Barra', 'Postres'];
const insSector = db.prepare('INSERT INTO sector_cocina (nombre) VALUES (?)');
const sectorId = {};
for (const s of SECTORES) sectorId[s] = insSector.run(s).lastInsertRowid;

const platos = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'seed_platos.json'), 'utf8').replace(/^﻿/, '')
);

// Categorías únicas, ordenadas por aparición
const cats = [...new Set(platos.map((p) => p.categoria))];
const insCat = db.prepare('INSERT INTO categoria (nombre, orden) VALUES (?, ?)');
const catId = {};
cats.forEach((c, i) => (catId[c] = insCat.run(c, i).lastInsertRowid));

const insPlato = db.prepare(
  `INSERT INTO plato (nombre, categoria_id, sector_id, precio, activo, revisar_precio, ventas_historicas)
   VALUES (@nombre, @categoria_id, @sector_id, @precio, @activo, 0, @ventas)`
);
const tx = db.transaction((rows) => {
  for (const p of rows) {
    insPlato.run({
      nombre: p.nombre,
      categoria_id: catId[p.categoria],
      sector_id: sectorId[p.sector] || sectorId['Cocina'],
      precio: p.precio,
      activo: p.activo ?? 1,
      ventas: p.ventas || 0,
    });
  }
});
tx(platos);

// Usuarios (roles)
const insUser = db.prepare('INSERT INTO usuario (nombre, rol, pin) VALUES (?, ?, ?)');
[
  ['Administrador', 'admin', '0000'],
  ['Mozo 1', 'mozo', '1111'],
  ['Mozo 2', 'mozo', '2222'],
  ['Cajero', 'cajero', '3333'],
  ['Cocina', 'cocina', '4444'],
].forEach((u) => insUser.run(...u));

// Mesas (1..20 en Salón + 4 en Patio)
const insMesa = db.prepare('INSERT INTO mesa (numero, sala, capacidad) VALUES (?, ?, ?)');
for (let i = 1; i <= 20; i++) insMesa.run(i, 'Salón', i % 3 === 0 ? 6 : 4);
for (let i = 21; i <= 24; i++) insMesa.run(i, 'Patio', 4);

console.log(`Seed OK: ${cats.length} categorías, ${platos.length} platos, mesas y usuarios cargados.`);
