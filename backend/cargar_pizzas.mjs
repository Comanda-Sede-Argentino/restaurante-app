// Carga (idempotente) las variedades de pizza en el catálogo y marca la categoría "Pizzas"
// para el botón de media y media. Se puede correr varias veces sin duplicar.
//   Uso:  node backend/cargar_pizzas.mjs
import db from './db.js';

const PIZZAS = [
  ['Muzzarella', 16500],
  ['Especial con jamón', 20000],
  ['Especial con huevo', 20000],
  ['Napolitana', 21000],
  ['Palmitos', 24000],
  ['Roquefort', 21000],
  ['4 quesos', 22500],
  ['Calabresa', 21000],
  ['Fugazzeta', 20000],
  ['Rúcula con jamón', 22500],
  ['Anchoa', 20000],
  ['Fugazza', 20000],
];

// Categoría "Pizzas": usar la que exista o crearla, y marcarla para media y media
let cat = db.prepare("SELECT id FROM categoria WHERE lower(nombre)='pizzas' OR lower(nombre)='pizza'").get();
if (!cat) cat = { id: db.prepare("INSERT INTO categoria (nombre, pizza) VALUES ('Pizzas', 1)").run().lastInsertRowid };
db.prepare('UPDATE categoria SET pizza=1 WHERE id=?').run(cat.id);

// Heredar el sector de cocina de alguna pizza que ya exista (para que salga en la comanda correcta)
const ref = db.prepare("SELECT sector_id FROM plato WHERE lower(nombre) LIKE '%pizza%' AND sector_id IS NOT NULL LIMIT 1").get();
const sectorId = ref ? ref.sector_id : null;

let nuevas = 0, actualizadas = 0;
const tx = db.transaction(() => {
  for (const [nombre, precio] of PIZZAS) {
    const ex = db.prepare('SELECT id FROM plato WHERE nombre=? AND categoria_id=?').get(nombre, cat.id);
    if (ex) { db.prepare('UPDATE plato SET precio=?, activo=1 WHERE id=?').run(precio, ex.id); actualizadas++; }
    else { db.prepare('INSERT INTO plato (nombre, categoria_id, sector_id, precio, activo) VALUES (?,?,?,?,1)').run(nombre, cat.id, sectorId, precio); nuevas++; }
  }
});
tx();

console.log(`✅ Listo. Categoría "Pizzas" (id ${cat.id}) marcada para media y media.`);
console.log(`   Pizzas: ${nuevas} nuevas, ${actualizadas} actualizadas.`);
console.log('   Revisá en Catálogo el SECTOR de cocina de las pizzas si usás varios sectores.');
