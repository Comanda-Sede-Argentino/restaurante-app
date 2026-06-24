import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'data', 'restaurante.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sector_cocina (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS categoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  orden INTEGER DEFAULT 0,
  activa INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plato (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categoria(id),
  sector_id INTEGER REFERENCES sector_cocina(id),
  precio REAL NOT NULL DEFAULT 0,
  activo INTEGER DEFAULT 1,
  revisar_precio INTEGER DEFAULT 1,
  ventas_historicas INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS usuario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'mozo',
  pin TEXT
);

CREATE TABLE IF NOT EXISTS mesa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL UNIQUE,
  sala TEXT DEFAULT 'Salón',
  capacidad INTEGER DEFAULT 4,
  estado TEXT DEFAULT 'libre'
);

CREATE TABLE IF NOT EXISTS pedido (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL DEFAULT 'salon',            -- salon | mostrador | delivery
  mesa_id INTEGER REFERENCES mesa(id),
  mozo_id INTEGER REFERENCES usuario(id),
  mozo_nombre TEXT,
  estado TEXT NOT NULL DEFAULT 'abierto',         -- abierto | en_cocina | servido | cobrado | anulado
  cubiertos INTEGER DEFAULT 1,
  observacion TEXT,
  cliente_nombre TEXT,
  cliente_telefono TEXT,
  cliente_direccion TEXT,
  hora_entrega TEXT,
  abierto_en TEXT DEFAULT (datetime('now','localtime')),
  cerrado_en TEXT,
  total REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pedido_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedido(id) ON DELETE CASCADE,
  plato_id INTEGER REFERENCES plato(id),
  nombre TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  precio_unit REAL NOT NULL DEFAULT 0,
  observacion TEXT,
  sector_id INTEGER,
  sector_nombre TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',       -- pendiente | en_preparacion | listo | entregado | anulado
  enviado_en TEXT DEFAULT (datetime('now','localtime')),
  listo_en TEXT
);

CREATE TABLE IF NOT EXISTS pago (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedido(id),
  medio TEXT NOT NULL DEFAULT 'EFECTIVO',
  importe REAL NOT NULL,
  fecha TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS wa_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_jid TEXT,
  telefono TEXT,
  nombre TEXT,
  texto TEXT,
  fecha TEXT DEFAULT (datetime('now','localtime')),
  estado TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | convertido | descartado
  pedido_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_wa_estado ON wa_inbox(estado);
CREATE INDEX IF NOT EXISTS idx_item_pedido ON pedido_item(pedido_id);
CREATE INDEX IF NOT EXISTS idx_item_estado ON pedido_item(estado);
CREATE INDEX IF NOT EXISTS idx_pedido_estado ON pedido(estado);
CREATE INDEX IF NOT EXISTS idx_plato_cat ON plato(categoria_id);
`);

// Migraciones para bases ya existentes (ALTER ignora si la columna ya existe)
const addCol = (sql) => { try { db.exec(sql); } catch (e) { /* ya existe */ } };
addCol("ALTER TABLE pedido ADD COLUMN cliente_nombre TEXT");
addCol("ALTER TABLE pedido ADD COLUMN cliente_telefono TEXT");
addCol("ALTER TABLE pedido ADD COLUMN cliente_direccion TEXT");
addCol("ALTER TABLE pedido ADD COLUMN hora_entrega TEXT");

export default db;
