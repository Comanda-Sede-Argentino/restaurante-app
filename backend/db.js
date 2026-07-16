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

-- Cuentas corrientes (fiado): empresas o personas que pagan después
CREATE TABLE IF NOT EXISTS cuenta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT DEFAULT 'empresa',          -- empresa | persona
  telefono TEXT,
  nota TEXT,
  activo INTEGER DEFAULT 1,
  creado_en TEXT DEFAULT (datetime('now','localtime'))
);

-- Movimientos de cuenta corriente: 'cargo' (consumió fiado) o 'pago' (la empresa abonó)
CREATE TABLE IF NOT EXISTS cuenta_mov (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL REFERENCES cuenta(id),
  tipo TEXT NOT NULL,                   -- cargo | pago
  importe REAL NOT NULL,                -- siempre positivo; el tipo define el signo
  pedido_id INTEGER,                    -- si el cargo viene de un pedido
  medio TEXT,                           -- si es pago: EFECTIVO / TRANSFERENCIA / etc.
  detalle TEXT,                         -- ej. nombre del comensal o referencia
  fecha TEXT DEFAULT (datetime('now','localtime'))
);

-- Insumos / stock: lo que se compra y se controla
CREATE TABLE IF NOT EXISTS insumo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  unidad TEXT DEFAULT 'unidad',         -- unidad | kg | litro | etc.
  stock REAL NOT NULL DEFAULT 0,
  stock_minimo REAL NOT NULL DEFAULT 0, -- umbral de alerta "para comprar"
  costo REAL DEFAULT 0,                 -- costo unitario (opcional)
  proveedor TEXT,
  activo INTEGER DEFAULT 1,
  creado_en TEXT DEFAULT (datetime('now','localtime'))
);

-- Receta: qué insumos consume cada plato (1 fila = stock directo; varias = receta completa)
CREATE TABLE IF NOT EXISTS receta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plato_id INTEGER NOT NULL REFERENCES plato(id),
  insumo_id INTEGER NOT NULL REFERENCES insumo(id),
  cantidad REAL NOT NULL DEFAULT 1
);

-- Movimientos de stock: auditoría de toda entrada/salida
CREATE TABLE IF NOT EXISTS stock_mov (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insumo_id INTEGER NOT NULL REFERENCES insumo(id),
  tipo TEXT NOT NULL,                   -- venta | compra | ajuste | devolucion
  cantidad REAL NOT NULL,               -- + entra, - sale
  pedido_id INTEGER,
  detalle TEXT,
  fecha TEXT DEFAULT (datetime('now','localtime'))
);

-- Movimientos de caja manuales: apertura (fondo), egreso (retiro/pago), ingreso extra
CREATE TABLE IF NOT EXISTS caja_mov (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,                   -- apertura | egreso | ingreso
  importe REAL NOT NULL,                -- siempre positivo; el tipo define el signo
  detalle TEXT,
  fecha TEXT DEFAULT (datetime('now','localtime'))
);

-- Cierres de caja (arqueo): foto del período cobrado entre cierres
CREATE TABLE IF NOT EXISTS cierre_caja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  desde TEXT,
  hasta TEXT,
  total REAL NOT NULL DEFAULT 0,
  tickets INTEGER NOT NULL DEFAULT 0,
  fondo REAL DEFAULT 0,                 -- fondo inicial del período
  egresos REAL DEFAULT 0,               -- retiros/pagos en efectivo
  esperado REAL DEFAULT 0,              -- efectivo que debería haber
  contado REAL,                         -- efectivo realmente contado (arqueo)
  diferencia REAL,                      -- contado - esperado (+ sobra / - falta)
  detalle TEXT,                         -- JSON con el desglose completo
  usuario TEXT,
  fecha TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_wa_estado ON wa_inbox(estado);
CREATE INDEX IF NOT EXISTS idx_item_pedido ON pedido_item(pedido_id);
CREATE INDEX IF NOT EXISTS idx_item_estado ON pedido_item(estado);
CREATE INDEX IF NOT EXISTS idx_pedido_estado ON pedido(estado);
CREATE INDEX IF NOT EXISTS idx_plato_cat ON plato(categoria_id);
CREATE INDEX IF NOT EXISTS idx_pago_fecha ON pago(fecha);
CREATE INDEX IF NOT EXISTS idx_cuentamov_cuenta ON cuenta_mov(cuenta_id);
`);

// Migraciones para bases ya existentes (ALTER ignora si la columna ya existe)
const addCol = (sql) => { try { db.exec(sql); } catch (e) { /* ya existe */ } };
addCol("ALTER TABLE pedido ADD COLUMN cliente_nombre TEXT");
addCol("ALTER TABLE pedido ADD COLUMN cliente_telefono TEXT");
addCol("ALTER TABLE pedido ADD COLUMN cliente_direccion TEXT");
addCol("ALTER TABLE pedido ADD COLUMN hora_entrega TEXT");
// Ayudas para la IA de pedidos: alias por plato y guarnición por categoría
addCol("ALTER TABLE plato ADD COLUMN alias_ia TEXT");
// Punto de cocción: platos que se piden por punto (bife, entrecot) -> se elige por unidad
addCol("ALTER TABLE plato ADD COLUMN punto INTEGER DEFAULT 0");
// Favorito: platos "a mano" que el mozo ve primero en la pantalla de pedido
addCol("ALTER TABLE plato ADD COLUMN favorito INTEGER DEFAULT 0");
// Disponible: la cocina lo marca "sin stock" (temporal) y no se puede vender hasta rehabilitar
addCol("ALTER TABLE plato ADD COLUMN disponible INTEGER DEFAULT 1");
addCol("ALTER TABLE categoria ADD COLUMN guarnicion INTEGER DEFAULT 0");
// Categorías que NO salen en la comanda de cocina (ej. bebidas: el mozo las sirve)
addCol("ALTER TABLE categoria ADD COLUMN en_comanda INTEGER DEFAULT 1");
// Control de stock: marca si ya se devolvió el stock de un ítem anulado (evita doble devolución)
addCol("ALTER TABLE pedido_item ADD COLUMN stock_devuelto INTEGER DEFAULT 0");
// Caja: descuento y propina por pedido
addCol("ALTER TABLE pedido ADD COLUMN descuento REAL DEFAULT 0");
addCol("ALTER TABLE pedido ADD COLUMN propina REAL DEFAULT 0");
// Delivery: momento de la entrega (separado del cobro)
addCol("ALTER TABLE pedido ADD COLUMN entregado_en TEXT");
// Facturación AFIP: referencia de la factura que el facturador avisa de vuelta
addCol("ALTER TABLE pedido ADD COLUMN factura_ref TEXT");
addCol("ALTER TABLE pedido ADD COLUMN factura_cae TEXT");
addCol("ALTER TABLE pedido ADD COLUMN facturado_en TEXT");
// Arqueo: columnas nuevas en cierres ya existentes
addCol("ALTER TABLE cierre_caja ADD COLUMN fondo REAL DEFAULT 0");
addCol("ALTER TABLE cierre_caja ADD COLUMN egresos REAL DEFAULT 0");
addCol("ALTER TABLE cierre_caja ADD COLUMN esperado REAL DEFAULT 0");
addCol("ALTER TABLE cierre_caja ADD COLUMN contado REAL");
addCol("ALTER TABLE cierre_caja ADD COLUMN diferencia REAL");
addCol("CREATE INDEX IF NOT EXISTS idx_receta_plato ON receta(plato_id)");
addCol("CREATE INDEX IF NOT EXISTS idx_stockmov_insumo ON stock_mov(insumo_id)");

export default db;
