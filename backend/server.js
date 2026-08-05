import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import {
  imprimirComandaUnica, imprimirCuenta, imprimirBebidas, imprimirTextoPlano, listarImpresoras, listarPuertosCom, colaImpresora, getConfig, getConfigPublic, setConfig,
} from './printer.js';
import * as wa from './whatsapp.js';
import * as tg from './telegram.js';
import { parsearPedidoIA, parsearViandaIA, claudeConTools } from './ia.js';
import { transcribirAudio } from './voz.js';
import os from 'os';
import QRCode from 'qrcode';
import { iniciarBackups, listarBackups, hacerBackup } from './backup.js';
import { registrarReportes } from './reportes.js';
import { registrarStock, consumirStockVenta, devolverStockItem, devolverStockPedido, insumosFaltantes, setAlertaStock } from './stock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Servir el frontend compilado si existe (modo producción / local).
// Caché: index.html NUNCA se cachea (así el teléfono siempre baja la última versión y sus
// nuevos bundles); los archivos con hash en /assets se cachean para siempre (su nombre cambia
// en cada build, así que no hay riesgo de quedar viejo).
const dist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(dist, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
}));

const PORT = process.env.PORT || 3001;

// ---------- helpers ----------
const recalcTotal = (pedidoId) => {
  const t = db
    .prepare(
      `SELECT COALESCE(SUM(cantidad*precio_unit),0) total
       FROM pedido_item WHERE pedido_id=? AND estado<>'anulado'`
    )
    .get(pedidoId).total;
  db.prepare('UPDATE pedido SET total=? WHERE id=?').run(t, pedidoId);
  return t;
};

const pedidoCompleto = (id) => {
  const p = db.prepare('SELECT * FROM pedido WHERE id=?').get(id);
  if (!p) return null;
  p.items = db
    .prepare('SELECT * FROM pedido_item WHERE pedido_id=? ORDER BY id').all(id);
  if (p.mesa_id) p.mesa = db.prepare('SELECT * FROM mesa WHERE id=?').get(p.mesa_id);
  return p;
};

const emitDashboard = () => io.emit('dashboard:update', dashboardData());

// ================= CATÁLOGO =================
app.get('/api/sectores', (req, res) =>
  res.json(db.prepare('SELECT * FROM sector_cocina ORDER BY nombre').all())
);

app.get('/api/categorias', (req, res) =>
  res.json(db.prepare('SELECT * FROM categoria WHERE activa=1 ORDER BY orden, nombre').all())
);

app.get('/api/platos', (req, res) => {
  const { categoria, q, todos } = req.query;
  let sql = `SELECT p.*, c.nombre categoria, COALESCE(c.guarnicion,0) cat_guarnicion,
                    COALESCE(c.salsa,0) cat_salsa, COALESCE(c.cafeteria,0) cat_cafeteria, COALESCE(c.pizza,0) cat_pizza, COALESCE(c.en_comanda,1) cat_en_comanda, s.nombre sector
             FROM plato p
             LEFT JOIN categoria c ON c.id=p.categoria_id
             LEFT JOIN sector_cocina s ON s.id=p.sector_id WHERE 1=1`;
  const args = [];
  if (!todos) sql += ' AND p.activo=1';
  if (categoria) { sql += ' AND p.categoria_id=?'; args.push(categoria); }
  if (q) { sql += ' AND p.nombre LIKE ?'; args.push('%' + q + '%'); }
  sql += ' ORDER BY p.ventas_historicas DESC, p.nombre LIMIT 1000';
  res.json(db.prepare(sql).all(...args));
});

app.post('/api/platos', (req, res) => {
  const { nombre, categoria_id, sector_id, precio, activo, alias_ia, punto, precio_media } = req.body;
  const r = db
    .prepare(
      `INSERT INTO plato (nombre, categoria_id, sector_id, precio, activo, alias_ia, punto, precio_media, revisar_precio)
       VALUES (?,?,?,?,?,?,?,?,0)`
    )
    .run(nombre, categoria_id, sector_id, precio || 0, activo ?? 1, alias_ia || null, punto ? 1 : 0,
         (precio_media === '' || precio_media == null) ? null : Number(precio_media) || null);
  res.json(db.prepare('SELECT * FROM plato WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/platos/:id', (req, res) => {
  const { nombre, categoria_id, sector_id, precio, activo, alias_ia, punto, favorito, disponible, precio_media } = req.body;
  db.prepare(
    `UPDATE plato SET nombre=COALESCE(?,nombre), categoria_id=COALESCE(?,categoria_id),
       sector_id=COALESCE(?,sector_id), precio=COALESCE(?,precio), activo=COALESCE(?,activo),
       alias_ia=COALESCE(?,alias_ia), punto=COALESCE(?,punto), favorito=COALESCE(?,favorito),
       disponible=COALESCE(?,disponible), precio_media=COALESCE(?,precio_media), revisar_precio=0 WHERE id=?`
  ).run(nombre, categoria_id, sector_id, precio, activo, alias_ia ?? null,
        punto == null ? null : (punto ? 1 : 0),
        favorito == null ? null : (favorito ? 1 : 0),
        disponible == null ? null : (disponible ? 1 : 0),
        precio_media === undefined ? null : (precio_media === '' || precio_media === null ? null : Number(precio_media)),
        req.params.id);
  res.json(db.prepare('SELECT * FROM plato WHERE id=?').get(req.params.id));
});

// Carga (idempotente) las 12 variedades de pizza con su precio entero y de media, y marca la
// categoría "Pizzas" para el botón de media y media. Para el botón del Catálogo (no borra nada).
app.post('/api/platos/cargar-pizzas', (req, res) => {
  const PIZZAS = [
    ['Muzzarella', 16500, 11000], ['Especial con jamón', 20000, 13000], ['Especial con huevo', 20000, 13000],
    ['Napolitana', 21000, 14000], ['Palmitos', 24000, 15000], ['Roquefort', 21000, 14000],
    ['4 quesos', 22500, 14000], ['Calabresa', 21000, 14000], ['Fugazzeta', 20000, 13000],
    ['Rúcula con jamón', 22500, 14000], ['Anchoa', 20000, 13000], ['Fugazza', 20000, 13000],
  ];
  let cat = db.prepare("SELECT id FROM categoria WHERE lower(nombre) IN ('pizzas','pizza')").get();
  if (!cat) cat = { id: db.prepare("INSERT INTO categoria (nombre, pizza) VALUES ('Pizzas', 1)").run().lastInsertRowid };
  db.prepare('UPDATE categoria SET pizza=1 WHERE id=?').run(cat.id);
  const ref = db.prepare("SELECT sector_id FROM plato WHERE lower(nombre) LIKE '%pizza%' AND sector_id IS NOT NULL LIMIT 1").get();
  const sectorId = ref ? ref.sector_id : null;
  let nuevas = 0, actualizadas = 0;
  const tx = db.transaction(() => {
    for (const [nombre, precio, media] of PIZZAS) {
      const ex = db.prepare('SELECT id FROM plato WHERE nombre=? AND categoria_id=?').get(nombre, cat.id);
      if (ex) { db.prepare('UPDATE plato SET precio=?, precio_media=?, activo=1 WHERE id=?').run(precio, media, ex.id); actualizadas++; }
      else { db.prepare('INSERT INTO plato (nombre, categoria_id, sector_id, precio, precio_media, activo) VALUES (?,?,?,?,?,1)').run(nombre, cat.id, sectorId, precio, media); nuevas++; }
    }
  });
  tx();
  res.json({ ok: true, nuevas, actualizadas, categoria_id: cat.id });
});

// Marcar un plato como disponible / sin stock (desde la cocina). Avisa en tiempo real a los mozos.
app.post('/api/platos/:id/disponible', (req, res) => {
  const disp = req.body.disponible ? 1 : 0;
  db.prepare('UPDATE plato SET disponible=? WHERE id=?').run(disp, req.params.id);
  const p = db.prepare('SELECT id, nombre, disponible FROM plato WHERE id=?').get(req.params.id);
  io.emit('plato:disponibilidad', p);
  res.json(p);
});

// Platos "frecuentes" para la pantalla del mozo: favoritos primero, luego los más vendidos
// de verdad (por el historial real del sistema), sin bebidas.
app.get('/api/platos/frecuentes', (req, res) => {
  const n = Math.min(60, Math.max(1, Number(req.query.n) || 30));
  res.json(db.prepare(
    `SELECT p.*, c.nombre categoria, COALESCE(c.guarnicion,0) cat_guarnicion,
            COALESCE(c.salsa,0) cat_salsa, COALESCE(c.pizza,0) cat_pizza, COALESCE(c.en_comanda,1) cat_en_comanda, s.nombre sector,
            COALESCE(SUM(CASE WHEN i.estado<>'anulado' THEN i.cantidad ELSE 0 END),0) vendidos
     FROM plato p
     LEFT JOIN categoria c ON c.id=p.categoria_id
     LEFT JOIN sector_cocina s ON s.id=p.sector_id
     LEFT JOIN pedido_item i ON i.plato_id=p.id
     WHERE p.activo=1 AND COALESCE(c.en_comanda,1)<>0
     GROUP BY p.id
     ORDER BY p.favorito DESC, vendidos DESC, p.ventas_historicas DESC, p.nombre
     LIMIT ?`
  ).all(n));
});

app.delete('/api/platos/:id', (req, res) => {
  db.prepare('UPDATE plato SET activo=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Eliminar DE VERDAD un producto (solo si nunca se vendió; si tiene ventas se rompería el historial)
app.post('/api/platos/:id/eliminar', (req, res) => {
  const id = req.params.id;
  const ventas = db.prepare('SELECT COUNT(*) c FROM pedido_item WHERE plato_id=?').get(id).c;
  if (ventas > 0) return res.status(409).json({ error: 'Tiene ventas registradas: no se puede borrar (rompe el historial). Desactivalo.' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM receta WHERE plato_id=?').run(id);
    db.prepare('DELETE FROM plato WHERE id=?').run(id);
  });
  tx();
  res.json({ ok: true });
});

// Limpieza: elimina DE VERDAD todos los inactivos que nunca se vendieron. Los que tienen ventas se conservan.
app.post('/api/platos/limpiar-inactivos', (req, res) => {
  const conVentas = new Set(db.prepare('SELECT DISTINCT plato_id FROM pedido_item WHERE plato_id IS NOT NULL').all().map((r) => r.plato_id));
  const inactivos = db.prepare('SELECT id FROM plato WHERE activo=0').all().map((r) => r.id);
  const borrables = inactivos.filter((id) => !conVentas.has(id));
  const tx = db.transaction(() => {
    for (const id of borrables) {
      db.prepare('DELETE FROM receta WHERE plato_id=?').run(id);
      db.prepare('DELETE FROM plato WHERE id=?').run(id);
    }
  });
  tx();
  res.json({ ok: true, eliminados: borrables.length, conservados: inactivos.length - borrables.length });
});

app.get('/api/categorias/:id', (req, res) =>
  res.json(db.prepare('SELECT * FROM categoria WHERE id=?').get(req.params.id))
);
app.post('/api/categorias', (req, res) => {
  const r = db.prepare('INSERT INTO categoria (nombre, orden) VALUES (?,?)')
    .run(req.body.nombre, req.body.orden || 0);
  res.json(db.prepare('SELECT * FROM categoria WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/categorias/:id', (req, res) => {
  const { nombre, orden, guarnicion, en_comanda, salsa, cafeteria, pizza, grupo } = req.body;
  const grupoOk = ['comida', 'bebidas', 'cafeteria'].includes(grupo) ? grupo : null;
  db.prepare(
    `UPDATE categoria SET nombre=COALESCE(?,nombre), orden=COALESCE(?,orden),
       guarnicion=COALESCE(?,guarnicion), en_comanda=COALESCE(?,en_comanda), salsa=COALESCE(?,salsa), cafeteria=COALESCE(?,cafeteria), pizza=COALESCE(?,pizza),
       grupo=COALESCE(?,grupo) WHERE id=?`
  ).run(nombre ?? null, orden ?? null,
        guarnicion == null ? null : (guarnicion ? 1 : 0),
        en_comanda == null ? null : (en_comanda ? 1 : 0),
        salsa == null ? null : (salsa ? 1 : 0),
        cafeteria == null ? null : (cafeteria ? 1 : 0),
        pizza == null ? null : (pizza ? 1 : 0),
        grupoOk,
        req.params.id);
  res.json(db.prepare('SELECT * FROM categoria WHERE id=?').get(req.params.id));
});

// Filtra los ítems que NO van a la comanda de cocina (ej. bebidas).
// Solo aplica en SALÓN (el mozo sirve la bebida). En delivery/mostrador la comanda lleva todo.
function itemsComandaCocina(items, tipo) {
  if (tipo !== 'salon') return items || [];
  const noCom = new Set(db.prepare('SELECT id FROM categoria WHERE en_comanda=0').all().map((c) => c.id));
  if (!noCom.size) return items;
  return (items || []).filter((it) => {
    if (!it.plato_id) return true;
    const p = db.prepare('SELECT categoria_id FROM plato WHERE id=?').get(it.plato_id);
    return !p || !noCom.has(p.categoria_id);
  });
}

// Devuelve SOLO las bebidas de una lista de ítems (categorías que no van a la comanda de cocina).
function bebidasDeItems(items) {
  const noCom = new Set(db.prepare('SELECT id FROM categoria WHERE en_comanda=0').all().map((c) => c.id));
  if (!noCom.size) return [];
  return (items || []).filter((it) => {
    if (!it.plato_id) return false;
    const p = db.prepare('SELECT categoria_id FROM plato WHERE id=?').get(it.plato_id);
    return p && noCom.has(p.categoria_id);
  });
}

// ================= USUARIOS / MESAS =================
app.get('/api/usuarios', (req, res) =>
  res.json(db.prepare('SELECT id,nombre,rol FROM usuario ORDER BY rol,nombre').all())
);

app.post('/api/usuarios', (req, res) => {
  const { nombre, rol } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre' });
  const r = db.prepare('INSERT INTO usuario (nombre, rol) VALUES (?,?)').run(nombre.trim(), rol || 'mozo');
  res.json(db.prepare('SELECT id,nombre,rol FROM usuario WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/usuarios/:id', (req, res) => {
  const { nombre, rol } = req.body;
  db.prepare('UPDATE usuario SET nombre=COALESCE(?,nombre), rol=COALESCE(?,rol) WHERE id=?')
    .run(nombre ?? null, rol ?? null, req.params.id);
  res.json(db.prepare('SELECT id,nombre,rol FROM usuario WHERE id=?').get(req.params.id));
});

app.delete('/api/usuarios/:id', (req, res) => {
  db.prepare('DELETE FROM usuario WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/mesas', (req, res) => {
  const mesas = db.prepare('SELECT * FROM mesa ORDER BY numero').all();
  for (const m of mesas) {
    const ped = db.prepare(
      `SELECT p.id, p.total, p.abierto_en, p.mozo_nombre,
         (SELECT COUNT(*) FROM pedido_item i WHERE i.pedido_id=p.id AND i.estado<>'anulado') AS nitems
       FROM pedido p
       WHERE p.mesa_id=? AND p.estado IN ('abierto','en_cocina','servido')
       ORDER BY p.id DESC LIMIT 1`
    ).get(m.id);
    // La mesa se considera ocupada solo si su pedido tiene al menos un plato vigente
    m.pedido = ped && ped.nitems > 0 ? ped : null;
  }
  res.json(mesas);
});

// Renombrar una mesa (etiqueta opcional para identificarla, ej. "Ventana", "Barra 1")
app.put('/api/mesas/:id', (req, res) => {
  const nombre = (req.body.nombre || '').trim() || null;
  db.prepare('UPDATE mesa SET nombre=? WHERE id=?').run(nombre, req.params.id);
  io.emit('mesa:actualizada', { id: Number(req.params.id), nombre });
  res.json(db.prepare('SELECT * FROM mesa WHERE id=?').get(req.params.id));
});

// ================= PEDIDOS =================
app.get('/api/pedidos', (req, res) => {
  const { estado, pendienteEntrega } = req.query;
  let sql = 'SELECT * FROM pedido';
  const args = [];
  if (pendienteEntrega === '1') {
    // Módulo Delivery: sigue en la lista mientras NO esté (cobrado Y entregado).
    // Así un pre-pago sin entregar, o un entregado sin cobrar, no desaparece.
    sql += " WHERE tipo='delivery' AND estado <> 'anulado' AND NOT (estado='cobrado' AND entregado_en IS NOT NULL)";
  } else if (estado) { sql += ' WHERE estado=?'; args.push(estado); }
  else sql += " WHERE estado IN ('abierto','en_cocina','servido')";
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...args).map((p) => pedidoCompleto(p.id)));
});

// Buscar clientes de delivery anteriores (por teléfono o nombre) para autocompletar el pedido
app.get('/api/clientes', (req, res) => {
  const q = '%' + (req.query.q || '').trim() + '%';
  const rows = db.prepare(
    `SELECT cliente_telefono telefono, cliente_nombre nombre, cliente_direccion direccion, MAX(id) mid
     FROM pedido
     WHERE tipo IN ('delivery','vianda') AND TRIM(COALESCE(cliente_nombre,'')) <> ''
       AND (cliente_telefono LIKE ? OR cliente_nombre LIKE ?)
     GROUP BY CASE WHEN TRIM(COALESCE(cliente_telefono,'')) <> '' THEN cliente_telefono
                   ELSE lower(cliente_nombre) END
     ORDER BY mid DESC LIMIT 8`
  ).all(q, q);
  res.json(rows);
});

// Marcar un pedido de delivery como ENTREGADO (independiente del cobro)
app.post('/api/pedidos/:id/entregar', (req, res) => {
  const p = db.prepare('SELECT * FROM pedido WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const entregar = req.body.entregado !== false;
  if (entregar) db.prepare("UPDATE pedido SET entregado_en=datetime('now','localtime') WHERE id=?").run(req.params.id);
  else db.prepare('UPDATE pedido SET entregado_en=NULL WHERE id=?').run(req.params.id);
  const full = pedidoCompleto(req.params.id);
  io.emit('pedido:actualizado', full);
  emitDashboard();
  res.json(full);
});

// Marcar como ENTREGADOS todos los delivery activos que faltan (pasada rápida de cierre)
app.post('/api/delivery/entregar-todos', (req, res) => {
  const dom = req.body.soloDomicilio ? "AND EXISTS (SELECT 1 FROM pedido_item i WHERE i.pedido_id=pedido.id AND i.nombre='Envío' AND i.estado<>'anulado')" : '';
  const r = db.prepare(
    "UPDATE pedido SET entregado_en=datetime('now','localtime') WHERE tipo='delivery' AND estado<>'anulado' AND entregado_en IS NULL " + dom
  ).run();
  io.emit('pedido:actualizado', {});
  emitDashboard();
  res.json({ ok: true, n: r.changes });
});

// Cobrar en EFECTIVO todos los delivery ENTREGADOS que todavía no se cobraron (cierre de delivery)
app.post('/api/delivery/cobrar-entregados', (req, res) => {
  const dom = req.body.soloDomicilio ? "AND EXISTS (SELECT 1 FROM pedido_item i WHERE i.pedido_id=o.id AND i.nombre='Envío' AND i.estado<>'anulado')" : '';
  const rows = db.prepare(
    "SELECT o.id, o.total FROM pedido o WHERE o.tipo='delivery' AND o.estado<>'anulado' AND o.estado<>'cobrado' AND o.entregado_en IS NOT NULL AND o.total > 0 " + dom
  ).all();
  const insPago = db.prepare('INSERT INTO pago (pedido_id, medio, importe) VALUES (?,?,?)');
  const upd = db.prepare("UPDATE pedido SET estado='cobrado', cerrado_en=datetime('now','localtime') WHERE id=?");
  const tx = db.transaction(() => {
    for (const p of rows) { insPago.run(p.id, 'EFECTIVO', Math.round(p.total)); upd.run(p.id); }
  });
  tx();
  const total = rows.reduce((a, p) => a + Math.round(p.total), 0);
  io.emit('pedido:cobrado', {});
  emitDashboard();
  res.json({ ok: true, n: rows.length, total });
});

// Imprime el CIERRE DE DELIVERY del turno: TODO el delivery cobrado desde el último cierre de caja
// (domicilios Y retiros), con el desglose, el total y cuánto es en efectivo.
app.post('/api/delivery/cierre-imprimir', async (req, res) => {
  const desde = inicioPeriodoCaja();
  const base = "o.tipo='delivery' AND o.estado='cobrado' AND o.cerrado_en > ?";
  const DOM = "EXISTS (SELECT 1 FROM pedido_item i WHERE i.pedido_id=o.id AND i.nombre='Envío' AND i.estado<>'anulado')";
  const pedidos = db.prepare(
    `SELECT o.cliente_nombre, o.total, o.cerrado_en, (${DOM}) domicilio FROM pedido o WHERE ${base} ORDER BY o.cerrado_en ASC`
  ).all(desde);
  const medios = db.prepare(
    `SELECT pg.medio, COALESCE(SUM(pg.importe),0) total, COUNT(*) n
     FROM pago pg JOIN pedido o ON o.id=pg.pedido_id WHERE ${base} GROUP BY pg.medio ORDER BY total DESC`
  ).all(desde);
  const totalVendido = pedidos.reduce((a, p) => a + Math.round(p.total || 0), 0);
  const efectivo = medios.filter((m) => /EFECTIVO/i.test(m.medio)).reduce((a, m) => a + m.total, 0);
  const domic = pedidos.filter((p) => p.domicilio);
  const retiros = pedidos.filter((p) => !p.domicilio);
  const domTotal = domic.reduce((a, p) => a + Math.round(p.total || 0), 0);
  const retTotal = retiros.reduce((a, p) => a + Math.round(p.total || 0), 0);
  const fecha = new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const L = [];
  L.push('Emitido: ' + fecha);
  L.push('(D = a domicilio · R = retira)');
  L.push('----------------------------------------');
  if (!pedidos.length) L.push('Sin delivery cobrado en el turno.');
  for (const p of pedidos) {
    const h = (p.cerrado_en || '').slice(11, 16);
    const nom = (p.cliente_nombre || 'Cliente').slice(0, 14);
    L.push(h + ' ' + (p.domicilio ? 'D' : 'R') + ' ' + nom + '  ' + moneyTxt(p.total));
  }
  L.push('----------------------------------------');
  L.push('Pedidos: ' + pedidos.length + '  (D:' + domic.length + '  R:' + retiros.length + ')');
  if (domTotal > 0) L.push(' A domicilio: ' + moneyTxt(domTotal));
  if (retTotal > 0) L.push(' Retiros: ' + moneyTxt(retTotal));
  L.push('----------------------------------------');
  L.push('Por medio de pago:');
  for (const m of medios) L.push('  ' + m.medio + ': ' + moneyTxt(m.total) + ' (' + m.n + ')');
  L.push('----------------------------------------');
  L.push('TOTAL DELIVERY: ' + moneyTxt(totalVendido));
  L.push('EN EFECTIVO: ' + moneyTxt(efectivo));
  const impresora = (getConfig().impresion || {}).impresoraCuenta || undefined;
  let r;
  try { r = await imprimirTextoPlano('CIERRE DE DELIVERY', L, impresora, req.body.operador); }
  catch (e) { r = { ok: false, error: e.message }; }
  res.json({ ok: true, resultado: r, totalVendido, efectivo, n: pedidos.length, domicilios: domic.length, retiros: retiros.length });
});

// El facturador AFIP avisa que este pedido fue facturado (guarda la referencia para Caja/Reportes)
app.post('/api/pedidos/:id/facturado', (req, res) => {
  const p = db.prepare('SELECT id FROM pedido WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const ref = String(req.body.ref || '').slice(0, 120);
  const cae = String(req.body.cae || '').slice(0, 40);
  db.prepare("UPDATE pedido SET factura_ref=?, factura_cae=?, facturado_en=datetime('now','localtime') WHERE id=?")
    .run(ref || null, cae || null, req.params.id);
  const full = pedidoCompleto(req.params.id);
  io.emit('pedido:actualizado', full);
  emitDashboard();
  res.json({ ok: true });
});

app.get('/api/pedidos/:id', (req, res) => {
  const p = pedidoCompleto(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  res.json(p);
});

app.post('/api/pedidos', (req, res) => {
  const {
    tipo = 'salon', mesa_id, mozo_id, mozo_nombre, cubiertos = 1,
    cliente_nombre, cliente_telefono, cliente_direccion, hora_entrega,
  } = req.body;
  // Reutilizar pedido abierto de la mesa si existe
  if (mesa_id) {
    const ex = db.prepare(
      "SELECT id FROM pedido WHERE mesa_id=? AND estado IN ('abierto','en_cocina','servido') ORDER BY id DESC LIMIT 1"
    ).get(mesa_id);
    if (ex) return res.json(pedidoCompleto(ex.id));
  }
  const r = db.prepare(
    `INSERT INTO pedido (tipo, mesa_id, mozo_id, mozo_nombre, cubiertos, cliente_nombre, cliente_telefono, cliente_direccion, hora_entrega)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(tipo, mesa_id || null, mozo_id || null, mozo_nombre || null, cubiertos,
        cliente_nombre || null, cliente_telefono || null, cliente_direccion || null, hora_entrega || null);
  if (mesa_id) db.prepare("UPDATE mesa SET estado='ocupada' WHERE id=?").run(mesa_id);
  const p = pedidoCompleto(r.lastInsertRowid);
  io.emit('pedido:nuevo', p);
  emitDashboard();
  res.json(p);
});

// Actualizar datos de cabecera del pedido (hora de entrega, cliente, cubiertos)
app.put('/api/pedidos/:id', (req, res) => {
  const { cliente_nombre, cliente_telefono, cliente_direccion, hora_entrega, cubiertos } = req.body;
  db.prepare(
    `UPDATE pedido SET
       cliente_nombre=COALESCE(?,cliente_nombre),
       cliente_telefono=COALESCE(?,cliente_telefono),
       cliente_direccion=COALESCE(?,cliente_direccion),
       hora_entrega=COALESCE(?,hora_entrega),
       cubiertos=COALESCE(?,cubiertos)
     WHERE id=?`
  ).run(cliente_nombre ?? null, cliente_telefono ?? null, cliente_direccion ?? null,
        hora_entrega ?? null, cubiertos ?? null, req.params.id);
  const p = pedidoCompleto(req.params.id);
  io.emit('pedido:actualizado', p);
  res.json(p);
});

// Agregar items y enviarlos a cocina
app.post('/api/pedidos/:id/items', (req, res) => {
  const pedidoId = req.params.id;
  const ped = db.prepare('SELECT * FROM pedido WHERE id=?').get(pedidoId);
  if (!ped) return res.status(404).json({ error: 'Pedido inexistente' });
  const items = req.body.items || [];
  // "Sin comanda": el mozo ya sirvió esto (ej. una porción que fue a buscar a la cocina).
  // Se registra para la cuenta y el stock, pero NO se imprime la comanda ni aparece en la pantalla
  // de cocina (se guarda como 'servido').
  const sinComanda = req.body.sinComanda === true;
  const estadoItem = sinComanda ? 'servido' : 'pendiente';
  // Bloquear platos marcados "sin stock" por la cocina
  const sinStock = items
    .map((it) => db.prepare('SELECT nombre FROM plato WHERE id=? AND disponible=0').get(it.plato_id))
    .filter(Boolean).map((p) => p.nombre);
  if (sinStock.length) return res.status(409).json({ error: 'Sin stock: ' + [...new Set(sinStock)].join(', ') });
  const ins = db.prepare(
    `INSERT INTO pedido_item (pedido_id, plato_id, nombre, cantidad, precio_unit, observacion, sector_id, sector_nombre, estado)
     VALUES (@pedido_id,@plato_id,@nombre,@cantidad,@precio_unit,@observacion,@sector_id,@sector_nombre,@estado)`
  );
  const nuevos = [];
  const tx = db.transaction(() => {
    for (const it of items) {
      const plato = db.prepare(
        'SELECT p.*, s.nombre sector FROM plato p LEFT JOIN sector_cocina s ON s.id=p.sector_id WHERE p.id=?'
      ).get(it.plato_id);
      const r = ins.run({
        pedido_id: pedidoId,
        plato_id: it.plato_id,
        nombre: plato ? plato.nombre : it.nombre,
        cantidad: it.cantidad || 1,
        precio_unit: it.precio_unit ?? (plato ? plato.precio : 0),
        observacion: it.observacion || null,
        sector_id: plato ? plato.sector_id : null,
        sector_nombre: plato ? plato.sector : null,
        estado: estadoItem,
      });
      nuevos.push(db.prepare('SELECT * FROM pedido_item WHERE id=?').get(r.lastInsertRowid));
    }
    // Solo pasa a "en_cocina" si algo va realmente a cocina. Lo "sin comanda" ya está servido.
    if (!sinComanda) db.prepare("UPDATE pedido SET estado='en_cocina' WHERE id=?").run(pedidoId);
    recalcTotal(pedidoId);
  });
  tx();
  // Descontar stock de cada plato vendido (según receta; bebidas = 1:1)
  for (const it of nuevos) consumirStockVenta(pedidoId, it.plato_id, it.cantidad);
  // Emitir cada item nuevo a la cocina (KDS) por sector. "Sin comanda" no va a la pantalla de cocina.
  if (!sinComanda) {
    for (const it of nuevos) {
      io.emit('item:nuevo', { ...it, pedido: pedidoCompleto(pedidoId) });
    }
  }
  const p = pedidoCompleto(pedidoId);
  io.emit('pedido:actualizado', p);
  emitDashboard();
  if (sinComanda) return res.json(p); // no imprime comanda ni ticket de bebidas
  // Qué se imprime en la comanda:
  // - SALÓN: es la comanda de cocina -> solo lo NUEVO (sin bebidas, sin precios).
  // - DELIVERY / MOSTRADOR: la comanda es también el remito del cliente (con precios y TOTAL),
  //   así que imprimimos el pedido COMPLETO para que salga el Envío y el total correcto.
  const paraComanda = (p.tipo === 'salon')
    ? nuevos
    : (p.items || []).filter((i) => i.estado !== 'anulado');
  const aCocina = itemsComandaCocina(paraComanda, p.tipo);
  if (aCocina.length) {
    imprimirComandaUnica(p, aCocina)
      .then((r) => {
        io.emit('impresion', { pedido_id: pedidoId, resultado: r });
        if (!r || r.ok === false)
          io.emit('impresion:error', { pedido_id: pedidoId, resultado: r });
      })
      .catch((e) => {
        console.error('Error impresión:', e.message);
        io.emit('impresion:error', { pedido_id: pedidoId, error: e.message });
      });
  }
  // Ticket aparte de bebidas para la barra (si está activado en Ajustes). No bloquea.
  const bebidas = bebidasDeItems(nuevos);
  if (bebidas.length) imprimirBebidas(p, bebidas).catch((e) => console.error('Bebidas:', e.message));
  res.json(p);
});

// Costo de envío por defecto: lo configurado, o $3.000 si no hay nada cargado
function costoEnvioDefault() {
  const c = Math.round(Number((getConfig().telegram || {}).costoEnvio) || 0);
  return c > 0 ? c : 3000;
}

// Agregar / quitar la línea de "Envío" en un pedido de delivery
app.post('/api/pedidos/:id/envio', (req, res) => {
  const pedidoId = req.params.id;
  const ped = db.prepare('SELECT * FROM pedido WHERE id=?').get(pedidoId);
  if (!ped) return res.status(404).json({ error: 'Pedido inexistente' });
  const cobrar = req.body.cobrar !== false; // por defecto true
  const costoBody = Math.round(Number(req.body.costo) || 0);
  const costo = costoBody > 0 ? costoBody : costoEnvioDefault();
  // Sacar cualquier envío previo (para no duplicar) y volver a poner si corresponde
  db.prepare("DELETE FROM pedido_item WHERE pedido_id=? AND plato_id IS NULL AND nombre='Envío'").run(pedidoId);
  if (cobrar) {
    db.prepare(
      `INSERT INTO pedido_item (pedido_id, plato_id, nombre, cantidad, precio_unit, sector_nombre, estado)
       VALUES (?, NULL, 'Envío', 1, ?, 'Delivery', 'entregado')`
    ).run(pedidoId, costo);
  }
  recalcTotal(pedidoId);
  const p = pedidoCompleto(pedidoId);
  io.emit('pedido:actualizado', p);
  emitDashboard();
  res.json(p);
});

// ================= IMPRESIÓN =================
app.get('/api/impresoras', async (req, res) => res.json(await listarImpresoras()));
app.get('/api/puertos-com', async (req, res) => res.json(await listarPuertosCom()));
app.get('/api/config', (req, res) => res.json(getConfigPublic()));
app.put('/api/config', (req, res) => res.json(setConfig(req.body)));

// Reimprimir la comanda de un pedido (todos sus items vigentes)
app.post('/api/pedidos/:id/reimprimir', async (req, res) => {
  const p = pedidoCompleto(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const items = itemsComandaCocina((p.items || []).filter((i) => i.estado !== 'anulado'), p.tipo);
  if (!items.length) return res.json({ ok: true, resultado: { ok: true, modo: 'sin-cocina' } });
  const r = await imprimirComandaUnica(p, items);
  res.json({ ok: true, resultado: r });
});

// Imprimir la CUENTA del cliente (total). NO cierra la mesa.
app.post('/api/pedidos/:id/cuenta', async (req, res) => {
  const p = pedidoCompleto(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const items = (p.items || []).filter((i) => i.estado !== 'anulado');
  if (!items.length) return res.status(400).json({ error: 'El pedido no tiene platos' });
  const r = await imprimirCuenta(p, items, undefined, !!req.body.firma); // firma: bloque para firmar (fiado)
  res.json({ ok: true, resultado: r });
});

// Probar impresora
app.post('/api/impresoras/test', async (req, res) => {
  const { impresora } = req.body;
  const fake = {
    id: 0, tipo: 'delivery', cliente_nombre: 'PRUEBA', cliente_direccion: 'Calle Falsa 123',
    cliente_telefono: '000', hora_entrega: '20:30',
  };
  const r = await imprimirComandaUnica(
    fake,
    [{ cantidad: 2, nombre: 'PRUEBA DE IMPRESION', precio_unit: 1000, observacion: 'ticket de test' }],
    impresora
  );
  res.json(r);
});

// Cocina cambia el estado de un item
app.put('/api/items/:id/estado', (req, res) => {
  const { estado } = req.body; // en_preparacion | listo | entregado | anulado
  const setListo = estado === 'listo' ? ", listo_en=datetime('now','localtime')" : '';
  db.prepare(`UPDATE pedido_item SET estado=?${setListo} WHERE id=?`).run(estado, req.params.id);
  const it = db.prepare('SELECT * FROM pedido_item WHERE id=?').get(req.params.id);
  if (estado === 'anulado') devolverStockItem(it); // devolver stock del ítem anulado
  recalcTotal(it.pedido_id);
  // Si todos los items están listos/entregados -> pedido servido
  const pend = db.prepare(
    "SELECT COUNT(*) c FROM pedido_item WHERE pedido_id=? AND estado IN ('pendiente','en_preparacion')"
  ).get(it.pedido_id).c;
  if (pend === 0) db.prepare("UPDATE pedido SET estado='servido' WHERE id=? AND estado='en_cocina'").run(it.pedido_id);
  const p = pedidoCompleto(it.pedido_id);
  io.emit('item:estado', { item: it, pedido: p });
  io.emit('pedido:actualizado', p);
  emitDashboard();
  res.json(it);
});

// Marcar TODOS los platos en espera (pendiente/en_preparacion) como LISTOS de una vez.
// Se usa en la cocina cuando ya se cocinó todo. Opcionalmente filtra por sector.
app.post('/api/kds/listo-todo', (req, res) => {
  const sector = req.body.sector && req.body.sector !== 'Todos' ? req.body.sector : null;
  let sql = "SELECT id, pedido_id FROM pedido_item WHERE estado IN ('pendiente','en_preparacion')";
  const args = [];
  if (sector) { sql += ' AND sector_nombre=?'; args.push(sector); }
  const items = db.prepare(sql).all(...args);
  if (!items.length) return res.json({ ok: true, n: 0 });
  const pedidoIds = [...new Set(items.map((i) => i.pedido_id))];
  const tx = db.transaction(() => {
    const upd = db.prepare("UPDATE pedido_item SET estado='listo', listo_en=datetime('now','localtime') WHERE id=?");
    for (const it of items) upd.run(it.id);
    // Pedidos que ya no tienen nada en cocina -> servido
    for (const pid of pedidoIds) {
      const pend = db.prepare(
        "SELECT COUNT(*) c FROM pedido_item WHERE pedido_id=? AND estado IN ('pendiente','en_preparacion')"
      ).get(pid).c;
      if (pend === 0) db.prepare("UPDATE pedido SET estado='servido' WHERE id=? AND estado='en_cocina'").run(pid);
    }
  });
  tx();
  for (const pid of pedidoIds) io.emit('pedido:actualizado', pedidoCompleto(pid));
  io.emit('item:estado', { bulk: true }); // que las pantallas de cocina recarguen
  emitDashboard();
  res.json({ ok: true, n: items.length });
});

// ================= CAFETERÍA (mostrador, carga rápida) =================
// Abrir una nueva "mesa de café" (pedido tipo cafeteria; no lleva comanda ni impresión).
app.post('/api/cafeteria/nueva', (req, res) => {
  const r = db.prepare("INSERT INTO pedido (tipo, mozo_nombre) VALUES ('cafeteria', ?)")
    .run(req.body.mozo_nombre || 'Cafetería');
  const p = pedidoCompleto(r.lastInsertRowid);
  io.emit('pedido:nuevo', p);
  emitDashboard();
  res.json(p);
});

// Mesas de café abiertas (sin cobrar) + total vendido en cafetería en el turno actual (desde el último cierre)
app.get('/api/cafeteria/mesas', (req, res) => {
  const rows = db.prepare(
    "SELECT id FROM pedido WHERE tipo='cafeteria' AND estado NOT IN ('cobrado','anulado') ORDER BY id ASC"
  ).all();
  const totalTurno = db.prepare(
    "SELECT COALESCE(SUM(total),0) t FROM pedido WHERE tipo='cafeteria' AND estado='cobrado' AND cerrado_en > ?"
  ).get(inicioPeriodoCaja()).t;
  res.json({ mesas: rows.map((r) => pedidoCompleto(r.id)), totalTurno });
});

// Sumar / restar un producto en una mesa de café (junta cantidades en una sola línea). NO imprime.
app.post('/api/cafeteria/:id/item', (req, res) => {
  const pedidoId = req.params.id;
  const platoId = Number(req.body.plato_id);
  const delta = Math.trunc(Number(req.body.delta) || 1);
  const ped = db.prepare('SELECT id FROM pedido WHERE id=?').get(pedidoId);
  if (!ped) return res.status(404).json({ error: 'No existe' });
  const plato = db.prepare(
    'SELECT p.*, s.nombre sector FROM plato p LEFT JOIN sector_cocina s ON s.id=p.sector_id WHERE p.id=?'
  ).get(platoId);
  if (!plato) return res.status(404).json({ error: 'Plato inexistente' });
  const ex = db.prepare(
    "SELECT * FROM pedido_item WHERE pedido_id=? AND plato_id=? AND estado<>'anulado' ORDER BY id DESC LIMIT 1"
  ).get(pedidoId, platoId);
  if (ex) {
    const nueva = ex.cantidad + delta;
    if (nueva <= 0) db.prepare("UPDATE pedido_item SET estado='anulado' WHERE id=?").run(ex.id);
    else db.prepare('UPDATE pedido_item SET cantidad=? WHERE id=?').run(nueva, ex.id);
  } else if (delta > 0) {
    // estado 'listo': se registra y se cobra, pero NO aparece en la pantalla de cocina (KDS)
    db.prepare(
      `INSERT INTO pedido_item (pedido_id, plato_id, nombre, cantidad, precio_unit, sector_id, sector_nombre, estado)
       VALUES (?,?,?,?,?,?,?,'listo')`
    ).run(pedidoId, plato.id, plato.nombre, delta, plato.precio, plato.sector_id, plato.sector);
  }
  recalcTotal(pedidoId);
  const p = pedidoCompleto(pedidoId);
  io.emit('pedido:actualizado', p);
  emitDashboard();
  res.json(p);
});

// ================= VIANDAS (mediodía) =================
const fechaHoy = () => db.prepare("SELECT date('now','localtime') d").get().d;

// Menús de un día (por defecto hoy)
app.get('/api/menu-dia', (req, res) => {
  const fecha = req.query.fecha || fechaHoy();
  const menus = db.prepare("SELECT * FROM menu_dia WHERE fecha=? AND activo=1 ORDER BY opcion ASC").all(fecha);
  res.json({ fecha, menus });
});

// Guardar los menús de un día. Actualiza EN EL LUGAR (conserva los IDs) para no romper
// los pedidos ya tomados: si se reguarda para corregir un typo/precio, el conteo por menú
// (cocina, cierre, reportes) se mantiene. Los menús que se quitan se desactivan, no se borran.
app.put('/api/menu-dia', (req, res) => {
  const fecha = req.body.fecha || fechaHoy();
  const menus = Array.isArray(req.body.menus) ? req.body.menus : [];
  const tx = db.transaction(() => {
    const existentes = db.prepare("SELECT * FROM menu_dia WHERE fecha=?").all(fecha);
    const usados = new Set();
    menus.forEach((m, i) => {
      if (!m || !String(m.nombre || '').trim()) return;
      const opcion = m.opcion || (i + 1);
      const nombre = String(m.nombre).trim();
      const descripcion = m.descripcion || null;
      const precio = Math.max(0, Number(m.precio) || 0);
      const ex = existentes.find((e) => e.opcion === opcion && !usados.has(e.id));
      if (ex) {
        db.prepare("UPDATE menu_dia SET nombre=?, descripcion=?, precio=?, activo=1 WHERE id=?").run(nombre, descripcion, precio, ex.id);
        usados.add(ex.id);
      } else {
        const r = db.prepare("INSERT INTO menu_dia (fecha, opcion, nombre, descripcion, precio) VALUES (?,?,?,?,?)").run(fecha, opcion, nombre, descripcion, precio);
        usados.add(r.lastInsertRowid);
      }
    });
    // Los que ya no vienen se DESACTIVAN (no se borran, para no romper pedidos que los referencian)
    for (const e of existentes) if (!usados.has(e.id)) db.prepare("UPDATE menu_dia SET activo=0 WHERE id=?").run(e.id);
  });
  tx();
  // Al cargar los menús del día, generar automáticamente los pedidos de los clientes fijos de hoy.
  let fijos = { n: 0 };
  try { fijos = generarFijosHoy(); } catch (e) { console.error('generarFijosHoy:', e.message); }
  const guardados = db.prepare("SELECT * FROM menu_dia WHERE fecha=? AND activo=1 ORDER BY opcion ASC").all(fecha);
  res.json({ fecha, menus: guardados, fijosGenerados: fijos.n || 0 });
});

// Sugerencias de menús anteriores (para reusar los que se repiten)
app.get('/api/menu-dia/historial', (req, res) => {
  const rows = db.prepare(
    "SELECT nombre, MAX(precio) precio, MAX(fecha) ultima FROM menu_dia GROUP BY nombre ORDER BY ultima DESC LIMIT 40"
  ).all();
  res.json(rows);
});

// Menús del último día anterior que tenga menús cargados (para "repetir los de la última vez")
app.get('/api/menu-dia/ultimo', (req, res) => {
  const fecha = req.query.fecha || fechaHoy();
  const ult = db.prepare("SELECT MAX(fecha) f FROM menu_dia WHERE fecha < ?").get(fecha).f;
  if (!ult) return res.json({ fecha: null, menus: [] });
  const menus = db.prepare("SELECT * FROM menu_dia WHERE fecha=? AND activo=1 ORDER BY opcion ASC").all(ult);
  res.json({ fecha: ult, menus });
});

// Texto listo para pegar en la lista de difusión de WhatsApp
app.get('/api/viandas/mensaje', (req, res) => {
  const fecha = req.query.fecha || fechaHoy();
  const menus = db.prepare("SELECT * FROM menu_dia WHERE fecha=? AND activo=1 ORDER BY opcion ASC").all(fecha);
  const cfg = getConfig();
  const link = (cfg.whatsapp && cfg.whatsapp.linkPedidos) || '';
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  const L = ['🍽 *Viandas de hoy* 🍽', ''];
  menus.forEach((m, i) => {
    L.push(`*${i + 1}) ${m.nombre}* — ${money(m.precio)}`);
    if (m.descripcion) L.push(`   ${m.descripcion}`);
  });
  L.push('', 'Respondé con el número de menú, cantidad y tu dirección 🛵');
  if (link) L.push('', 'También podés pedir por acá 👉 ' + link);
  res.json({ fecha, texto: L.join('\n'), menus });
});

// Resuelve un ítem de vianda (menú del día o plato de carta) a los campos que se guardan.
function resolverItemVianda(it) {
  let nombre = it.nombre || 'Ítem', precio = Number(it.precio_unit) || 0;
  let sector_id = null, sector = null, plato_id = null, menu_dia_id = null;
  if (it.menu_dia_id) {
    const m = db.prepare("SELECT * FROM menu_dia WHERE id=?").get(it.menu_dia_id);
    if (m) { nombre = m.nombre; precio = m.precio; menu_dia_id = m.id; }
  } else if (it.plato_id) {
    const p = db.prepare('SELECT p.*, s.nombre sector FROM plato p LEFT JOIN sector_cocina s ON s.id=p.sector_id WHERE p.id=?').get(it.plato_id);
    if (p) { nombre = p.nombre; precio = it.precio_unit ?? p.precio; sector_id = p.sector_id; sector = p.sector; plato_id = p.id; }
  }
  const cant = Math.max(1, Math.trunc(Number(it.cantidad) || 1));
  const observacion = (it.observacion || '').trim() || null;
  return { plato_id, menu_dia_id, nombre, cantidad: cant, precio, observacion, sector_id, sector };
}

// Inserta la lista de ítems de un pedido de vianda (estado 'listo': se registra y cobra pero
// no satura la cocina) y descuenta el stock de los platos de carta. Devuelve el total de platos.
function guardarItemsVianda(pedidoId, items) {
  const ins = db.prepare(
    `INSERT INTO pedido_item (pedido_id, plato_id, menu_dia_id, nombre, cantidad, precio_unit, observacion, sector_id, sector_nombre, estado)
     VALUES (?,?,?,?,?,?,?,?,?, 'listo')`
  );
  const platos = [];
  for (const raw of items) {
    const it = resolverItemVianda(raw);
    ins.run(pedidoId, it.plato_id, it.menu_dia_id, it.nombre, it.cantidad, it.precio, it.observacion, it.sector_id, it.sector);
    if (it.plato_id) platos.push({ plato_id: it.plato_id, cantidad: it.cantidad });
  }
  return platos;
}

// Crea un pedido de vianda con sus ítems (menús del día y/o platos de la carta). Devuelve el pedido.
function crearViandaPedido({ cliente_nombre, cliente_telefono, cliente_direccion, entrega, hora_entrega, observacion, items }) {
  const ent = entrega === 'retiro' ? 'retiro' : 'domicilio';
  const r = db.prepare(
    `INSERT INTO pedido (tipo, entrega, cliente_nombre, cliente_telefono, cliente_direccion, hora_entrega, observacion, estado)
     VALUES ('vianda', ?,?,?,?,?,?, 'en_cocina')`
  ).run(ent, cliente_nombre || null, cliente_telefono || null, cliente_direccion || null, hora_entrega || null, (observacion || '').trim() || null);
  const pedidoId = r.lastInsertRowid;
  let platos = [];
  const tx = db.transaction(() => { platos = guardarItemsVianda(pedidoId, items); recalcTotal(pedidoId); });
  tx();
  for (const it of platos) { try { consumirStockVenta(pedidoId, it.plato_id, it.cantidad); } catch { /* sin receta */ } }
  const p = pedidoCompleto(pedidoId);
  io.emit('pedido:nuevo', p);
  emitDashboard();
  return p;
}

app.post('/api/viandas', (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'El pedido no tiene ítems' });
  const p = crearViandaPedido({
    cliente_nombre: req.body.cliente_nombre, cliente_telefono: req.body.cliente_telefono,
    cliente_direccion: req.body.cliente_direccion, entrega: req.body.entrega,
    hora_entrega: req.body.hora_entrega, observacion: req.body.observacion, items,
  });
  res.json(p);
});

// Editar un pedido de vianda ya cargado (mientras NO esté cobrado): reemplaza ítems y datos.
app.put('/api/viandas/:id', (req, res) => {
  const id = req.params.id;
  const ped = db.prepare("SELECT * FROM pedido WHERE id=? AND tipo='vianda'").get(id);
  if (!ped) return res.status(404).json({ error: 'No existe' });
  if (ped.estado === 'cobrado') return res.status(409).json({ error: 'El pedido ya fue cobrado. Reabrilo desde Caja para editarlo.' });
  if (ped.estado === 'anulado') return res.status(409).json({ error: 'El pedido está anulado' });
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'El pedido no tiene ítems' });
  const ent = req.body.entrega === 'retiro' ? 'retiro' : 'domicilio';
  let platos = [];
  const tx = db.transaction(() => {
    devolverStockPedido(id);                                   // devuelve el stock de los platos actuales
    db.prepare('DELETE FROM pedido_item WHERE pedido_id=?').run(id);
    platos = guardarItemsVianda(id, items);
    db.prepare(
      `UPDATE pedido SET entrega=?, cliente_nombre=?, cliente_telefono=?, cliente_direccion=?, hora_entrega=?, observacion=? WHERE id=?`
    ).run(ent, req.body.cliente_nombre || null, req.body.cliente_telefono || ped.cliente_telefono || null,
          req.body.cliente_direccion || null, req.body.hora_entrega || null, (req.body.observacion || '').trim() || null, id);
    recalcTotal(id);
  });
  tx();
  for (const it of platos) { try { consumirStockVenta(id, it.plato_id, it.cantidad); } catch { /* sin receta */ } }
  const p = pedidoCompleto(id);
  io.emit('pedido:actualizado', p);
  emitDashboard();
  res.json(p);
});

// ---------- CLIENTES FIJOS DE VIANDA (reciben automáticamente los días que corresponde) ----------
app.get('/api/viandas/fijos', (req, res) => {
  res.json(db.prepare(
    `SELECT f.*, c.nombre cuenta_nombre FROM vianda_fijo f LEFT JOIN cuenta c ON c.id=f.cuenta_id
     ORDER BY f.activo DESC, f.cliente_nombre`
  ).all());
});
function guardarFijo(b, id) {
  const nombre = String(b.cliente_nombre || '').trim();
  const entrega = b.entrega === 'retiro' ? 'retiro' : 'domicilio';
  const dias = String(b.dias || '1,2,3,4,5');
  const opcion = Number(b.opcion) || 1;
  const cantidad = Math.max(1, Number(b.cantidad) || 1);
  const pago = b.pago === 'fiado' ? 'fiado' : 'dia';
  const cuenta_id = pago === 'fiado' ? (Number(b.cuenta_id) || null) : null;
  if (id) {
    db.prepare(`UPDATE vianda_fijo SET cliente_nombre=?, cliente_telefono=?, cliente_direccion=?, entrega=?, dias=?, opcion=?, cantidad=?, pago=?, cuenta_id=?, nota=?, activo=? WHERE id=?`)
      .run(nombre, b.cliente_telefono || null, b.cliente_direccion || null, entrega, dias, opcion, cantidad, pago, cuenta_id, b.nota || null, b.activo === false ? 0 : 1, id);
    return id;
  }
  return db.prepare(`INSERT INTO vianda_fijo (cliente_nombre, cliente_telefono, cliente_direccion, entrega, dias, opcion, cantidad, pago, cuenta_id, nota, activo) VALUES (?,?,?,?,?,?,?,?,?,?,1)`)
    .run(nombre, b.cliente_telefono || null, b.cliente_direccion || null, entrega, dias, opcion, cantidad, pago, cuenta_id, b.nota || null).lastInsertRowid;
}
app.post('/api/viandas/fijos', (req, res) => {
  if (!String(req.body.cliente_nombre || '').trim()) return res.status(400).json({ error: 'Falta el nombre' });
  const id = guardarFijo(req.body);
  res.json(db.prepare('SELECT * FROM vianda_fijo WHERE id=?').get(id));
});
app.put('/api/viandas/fijos/:id', (req, res) => {
  guardarFijo(req.body, req.params.id);
  res.json(db.prepare('SELECT * FROM vianda_fijo WHERE id=?').get(req.params.id));
});
app.delete('/api/viandas/fijos/:id', (req, res) => {
  db.prepare('DELETE FROM vianda_fijo WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Genera (sin duplicar) los pedidos de los clientes fijos que corresponden a HOY. Necesita menús cargados.
function generarFijosHoy() {
  const fecha = fechaHoy();
  const dow = String(db.prepare("SELECT strftime('%w','now','localtime') w").get().w);
  const menus = db.prepare("SELECT * FROM menu_dia WHERE fecha=? AND activo=1 ORDER BY opcion ASC").all(fecha);
  if (!menus.length) return { n: 0, sinMenus: true };
  const fijos = db.prepare('SELECT * FROM vianda_fijo WHERE activo=1').all();
  let n = 0;
  for (const f of fijos) {
    const dias = (f.dias || '').trim();
    const aplica = dias ? dias.split(',').map((s) => s.trim()).includes(dow) : ['1', '2', '3', '4', '5'].includes(dow);
    if (!aplica) continue;
    const ya = db.prepare("SELECT id FROM pedido WHERE tipo='vianda' AND fijo_id=? AND estado<>'anulado' AND date(abierto_en)=?").get(f.id, fecha);
    if (ya) continue;
    const m = menus.find((x) => x.opcion === (f.opcion || 1)) || menus[0];
    if (!m) continue;
    const r = db.prepare(
      `INSERT INTO pedido (tipo, entrega, cliente_nombre, cliente_telefono, cliente_direccion, observacion, fijo_id, estado)
       VALUES ('vianda', ?,?,?,?,?,?, 'en_cocina')`
    ).run(f.entrega === 'retiro' ? 'retiro' : 'domicilio', f.cliente_nombre, f.cliente_telefono, f.cliente_direccion, f.nota, f.id);
    const pid = r.lastInsertRowid;
    db.prepare(`INSERT INTO pedido_item (pedido_id, menu_dia_id, nombre, cantidad, precio_unit, estado) VALUES (?,?,?,?,?, 'listo')`)
      .run(pid, m.id, m.nombre, Math.max(1, f.cantidad || 1), m.precio);
    recalcTotal(pid);
    io.emit('pedido:nuevo', pedidoCompleto(pid));
    n++;
  }
  if (n) emitDashboard();
  return { n };
}
app.post('/api/viandas/generar-fijos', (req, res) => res.json(generarFijosHoy()));

// Pedidos de vianda de un día + resumen por menú (para la vista del mediodía)
app.get('/api/viandas', (req, res) => {
  const fecha = req.query.fecha || fechaHoy();
  const rows = db.prepare(
    "SELECT id FROM pedido WHERE tipo='vianda' AND date(abierto_en)=? AND estado<>'anulado' ORDER BY id ASC"
  ).all(fecha);
  const pedidos = rows.map((row) => pedidoCompleto(row.id));
  // Para los pedidos que vienen de un cliente FIJO, adjuntar su forma de pago (y la cuenta si es fiado)
  for (const p of pedidos) {
    if (!p.fijo_id) continue;
    const f = db.prepare('SELECT f.pago, c.nombre cuenta FROM vianda_fijo f LEFT JOIN cuenta c ON c.id=f.cuenta_id WHERE f.id=?').get(p.fijo_id);
    if (f) { p.fijoPago = f.pago; p.fijoCuenta = f.cuenta || null; }
  }
  const menus = db.prepare("SELECT * FROM menu_dia WHERE fecha=? AND activo=1 ORDER BY opcion ASC").all(fecha);
  // Cantidad e importe vendidos por cada menú del día
  const porMenu = db.prepare(
    `SELECT md.id, md.opcion, md.nombre, md.precio,
            COALESCE(SUM(CASE WHEN o.estado<>'anulado' THEN i.cantidad ELSE 0 END),0) cantidad,
            COALESCE(SUM(CASE WHEN o.estado<>'anulado' AND o.entregado_en IS NOT NULL THEN i.cantidad ELSE 0 END),0) entregadas,
            COALESCE(SUM(CASE WHEN o.estado<>'anulado' THEN i.cantidad*i.precio_unit ELSE 0 END),0) importe
     FROM menu_dia md
     LEFT JOIN pedido_item i ON i.menu_dia_id=md.id AND i.estado<>'anulado'
     LEFT JOIN pedido o ON o.id=i.pedido_id
     WHERE md.fecha=? AND md.activo=1
     GROUP BY md.id ORDER BY md.opcion ASC`
  ).all(fecha);
  const totalDia = db.prepare(
    "SELECT COALESCE(SUM(total),0) t FROM pedido WHERE tipo='vianda' AND date(abierto_en)=? AND estado='cobrado'"
  ).get(fecha).t;
  const sinCobrar = pedidos.filter((p) => p.estado !== 'cobrado').length;
  res.json({ fecha, pedidos, menus, porMenu, totalDia, sinCobrar });
});

// Estado EN VIVO para la pantalla de cocina: por cada menú, cuántas se vendieron, cuántas
// ya entregó el delivery y cuántas FALTAN hacer. Se refresca solo cuando entran/entregan viandas.
app.get('/api/viandas/cocina-estado', (req, res) => {
  const fecha = req.query.fecha || fechaHoy();
  // Entre las que FALTAN salir, cuántas van a domicilio (delivery) y cuántas son de retiro
  const NOSALIO = "o.estado<>'anulado' AND o.entregado_en IS NULL";
  const porMenu = db.prepare(
    `SELECT md.opcion, md.nombre,
            COALESCE(SUM(CASE WHEN o.estado<>'anulado' THEN i.cantidad ELSE 0 END),0) vendidas,
            COALESCE(SUM(CASE WHEN o.estado<>'anulado' AND o.entregado_en IS NOT NULL THEN i.cantidad ELSE 0 END),0) entregadas,
            COALESCE(SUM(CASE WHEN ${NOSALIO} AND o.entrega<>'retiro' THEN i.cantidad ELSE 0 END),0) faltanDom,
            COALESCE(SUM(CASE WHEN ${NOSALIO} AND o.entrega='retiro' THEN i.cantidad ELSE 0 END),0) faltanRet
     FROM menu_dia md
     LEFT JOIN pedido_item i ON i.menu_dia_id=md.id AND i.estado<>'anulado'
     LEFT JOIN pedido o ON o.id=i.pedido_id
     WHERE md.fecha=? AND md.activo=1
     GROUP BY md.id ORDER BY md.opcion ASC`
  ).all(fecha).map((m, i) => ({ ...m, n: i + 1, faltan: Math.max(0, m.vendidas - m.entregadas) }));
  // Ítems de carta pedidos junto con las viandas: mismo criterio (faltan = pedidas - salidas)
  const cartaItems = db.prepare(
    `SELECT i.nombre,
            SUM(i.cantidad) vendidas,
            SUM(CASE WHEN o.entregado_en IS NOT NULL THEN i.cantidad ELSE 0 END) entregadas
     FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
     WHERE o.tipo='vianda' AND date(o.abierto_en)=? AND o.estado<>'anulado'
       AND i.estado<>'anulado' AND i.menu_dia_id IS NULL
     GROUP BY i.nombre ORDER BY vendidas DESC`
  ).all(fecha).map((c) => ({ ...c, faltan: Math.max(0, c.vendidas - c.entregadas) }));
  // Cambios/aclaraciones de menús (ej. "con ensalada en vez de puré"): para que la cocina los prepare bien
  const cambios = db.prepare(
    `SELECT i.cantidad, md.opcion, i.observacion, o.cliente_nombre nombre, (o.entregado_en IS NOT NULL) salio
     FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id JOIN menu_dia md ON md.id=i.menu_dia_id
     WHERE o.tipo='vianda' AND date(o.abierto_en)=? AND o.estado<>'anulado' AND i.estado<>'anulado'
       AND i.observacion IS NOT NULL AND TRIM(i.observacion)<>''
     ORDER BY i.id`
  ).all(fecha);
  const vendidas = porMenu.reduce((a, m) => a + m.vendidas, 0);
  const entregadas = porMenu.reduce((a, m) => a + m.entregadas, 0);
  const faltanDom = porMenu.reduce((a, m) => a + m.faltanDom, 0);
  const faltanRet = porMenu.reduce((a, m) => a + m.faltanRet, 0);
  res.json({ fecha, porMenu, cartaItems, cambios, vendidas, entregadas, faltanDom, faltanRet, faltan: Math.max(0, vendidas - entregadas) });
});

// Resumen ACUMULADO para pasar a la cocina: cuántas de cada menú van hasta ahora (12x Menú 1, 6x Menú 2...)
// Sale por la impresora de comandas. Se puede imprimir varias veces a medida que entran pedidos.
app.post('/api/viandas/cocina-imprimir', async (req, res) => {
  const fecha = req.body.fecha || fechaHoy();
  const NOSALIO = "o.estado<>'anulado' AND o.entregado_en IS NULL";
  const porMenu = db.prepare(
    `SELECT md.opcion, md.nombre,
            COALESCE(SUM(CASE WHEN o.estado<>'anulado' THEN i.cantidad ELSE 0 END),0) vendidas,
            COALESCE(SUM(CASE WHEN o.estado<>'anulado' AND o.entregado_en IS NOT NULL THEN i.cantidad ELSE 0 END),0) entregadas,
            COALESCE(SUM(CASE WHEN ${NOSALIO} AND o.entrega<>'retiro' THEN i.cantidad ELSE 0 END),0) faltanDom,
            COALESCE(SUM(CASE WHEN ${NOSALIO} AND o.entrega='retiro' THEN i.cantidad ELSE 0 END),0) faltanRet
     FROM menu_dia md
     LEFT JOIN pedido_item i ON i.menu_dia_id=md.id AND i.estado<>'anulado'
     LEFT JOIN pedido o ON o.id=i.pedido_id
     WHERE md.fecha=? AND md.activo=1 GROUP BY md.id ORDER BY md.opcion ASC`
  ).all(fecha).map((m) => ({ ...m, faltan: Math.max(0, m.vendidas - m.entregadas) }));
  // Ítems de carta pedidos junto con las viandas: faltan = pedidas - salidas
  const cartaItems = db.prepare(
    `SELECT i.nombre, SUM(i.cantidad) vendidas,
            SUM(CASE WHEN o.entregado_en IS NOT NULL THEN i.cantidad ELSE 0 END) entregadas
     FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
     WHERE o.tipo='vianda' AND date(o.abierto_en)=? AND o.estado<>'anulado'
       AND i.estado<>'anulado' AND i.menu_dia_id IS NULL
     GROUP BY i.nombre ORDER BY vendidas DESC`
  ).all(fecha).map((c) => ({ ...c, faltan: Math.max(0, c.vendidas - c.entregadas) }));
  // Cambios/aclaraciones de menús (para prepararlos bien)
  const cambios = db.prepare(
    `SELECT i.cantidad, md.opcion, i.observacion, o.cliente_nombre nombre
     FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id JOIN menu_dia md ON md.id=i.menu_dia_id
     WHERE o.tipo='vianda' AND date(o.abierto_en)=? AND o.estado<>'anulado' AND i.estado<>'anulado'
       AND i.observacion IS NOT NULL AND TRIM(i.observacion)<>''
     ORDER BY i.id`
  ).all(fecha);
  const totalPedidos = db.prepare(
    "SELECT COUNT(*) c FROM pedido WHERE tipo='vianda' AND date(abierto_en)=? AND estado<>'anulado'"
  ).get(fecha).c;
  const totalVendidas = porMenu.reduce((a, m) => a + m.vendidas, 0);
  const totalEntregadas = porMenu.reduce((a, m) => a + m.entregadas, 0);
  const totalFaltan = Math.max(0, totalVendidas - totalEntregadas);
  const hora = db.prepare("SELECT time('now','localtime') t").get().t.slice(0, 5);
  // El número GRANDE es lo que FALTA preparar (vendidas - entregadas). Debajo, en chico, el detalle.
  const totalDom = porMenu.reduce((a, m) => a + m.faltanDom, 0);
  const totalRet = porMenu.reduce((a, m) => a + m.faltanRet, 0);
  const L = ['Actualizado: ' + hora, ' FALTAN PREPARAR:', ''];
  porMenu.forEach((m, i) => {
    L.push({ t: ' ' + String(m.faltan).padStart(2) + '  Menu ' + (i + 1), big: true });
    L.push('     (' + m.nombre + ')  dom ' + m.faltanDom + ' / ret ' + m.faltanRet);
  });
  if (cartaItems.length) {
    L.push('', ' --- De la carta ---');
    cartaItems.forEach((c) => L.push({ t: ' ' + String(c.faltan).padStart(2) + '  ' + c.nombre.slice(0, 14), big: true }));
  }
  if (cambios.length) {
    L.push('', ' --- CAMBIOS ---');
    cambios.forEach((c) => L.push(' ' + c.cantidad + 'x Menu ' + c.opcion + ': ' + c.observacion + (c.nombre ? ' (' + c.nombre + ')' : '')));
  }
  L.push('');
  L.push({ t: ' FALTAN: ' + totalFaltan, big: true });
  L.push(' Domicilio: ' + totalDom + '   Retiro: ' + totalRet);
  L.push(' Pedidos: ' + totalPedidos);
  const resultado = await imprimirTextoPlano('COCINA - VIANDAS ' + fecha, L, undefined, req.body.operador);
  res.json({ resultado, porMenu, cartaItems, totalViandas: totalVendidas, totalFaltan, totalEntregadas, totalPedidos });
});

// Marcar como ENTREGADOS todos los domicilios de vianda que faltan (no toca el cobro)
app.post('/api/viandas/entregar-todos', (req, res) => {
  const fecha = req.body.fecha || fechaHoy();
  const rows = db.prepare(
    `SELECT id FROM pedido WHERE tipo='vianda' AND estado<>'anulado' AND entregado_en IS NULL
       AND (entrega IS NULL OR entrega<>'retiro') AND date(abierto_en)=?`
  ).all(fecha);
  const tx = db.transaction(() => {
    for (const r of rows) db.prepare("UPDATE pedido SET entregado_en=datetime('now','localtime') WHERE id=?").run(r.id);
  });
  tx();
  for (const r of rows) io.emit('pedido:actualizado', pedidoCompleto(r.id));
  emitDashboard();
  res.json({ n: rows.length });
});

// Hoja de reparto: lista imprimible de los domicilios por entregar (para que la lleve el cadete)
app.post('/api/viandas/reparto-imprimir', async (req, res) => {
  const fecha = req.body.fecha || fechaHoy();
  const rows = db.prepare(
    `SELECT id FROM pedido WHERE tipo='vianda' AND estado<>'anulado' AND entregado_en IS NULL
       AND (entrega IS NULL OR entrega<>'retiro') AND date(abierto_en)=?
     ORDER BY COALESCE(hora_entrega,'~'), id`
  ).all(fecha);
  const peds = rows.map((r) => pedidoCompleto(r.id));
  const L = ['  ' + peds.length + ' entrega(s) - ' + fecha, ''];
  if (!peds.length) L.push('  No hay domicilios por entregar.');
  peds.forEach((p, i) => {
    L.push((i + 1) + ') ' + (p.cliente_nombre || 'Cliente') + '   ' + moneyTxt(p.total) + (p.estado === 'cobrado' ? '  (PAGADO)' : ''));
    L.push('   Dir: ' + (p.cliente_direccion || '-'));
    if (p.cliente_telefono) L.push('   Tel: ' + p.cliente_telefono);
    if (p.hora_entrega) L.push('   Hora: ' + p.hora_entrega);
    (p.items || []).filter((it) => it.estado !== 'anulado').forEach((it) =>
      L.push('   - ' + it.cantidad + 'x ' + it.nombre + (it.observacion ? ' (' + it.observacion + ')' : '')));
    if (p.observacion) L.push('   Nota: ' + p.observacion);
    L.push('----------------------------------------');
  });
  const impresora = (getConfig().impresion || {}).impresoraCuenta || undefined;
  let resultado;
  try { resultado = await imprimirTextoPlano('HOJA DE REPARTO - VIANDAS', L, impresora, req.body.operador); }
  catch (e) { resultado = { ok: false, error: e.message }; }
  res.json({ ok: true, resultado, n: peds.length });
});

// Cierre de VIANDAS del día: ticket con desglose por menú, formas de pago, total y efectivo.
// Se saca al terminar el reparto del mediodía.
app.post('/api/viandas/cierre-imprimir', async (req, res) => {
  const fecha = req.body.fecha || fechaHoy();
  const baseCobr = "tipo='vianda' AND estado='cobrado' AND date(cerrado_en)=?";
  // Desglose por menú (solo cobradas)
  const porMenu = db.prepare(
    `SELECT md.opcion, md.nombre, COALESCE(SUM(i.cantidad),0) cantidad, COALESCE(SUM(i.cantidad*i.precio_unit),0) importe
     FROM menu_dia md JOIN pedido_item i ON i.menu_dia_id=md.id AND i.estado<>'anulado'
     JOIN pedido o ON o.id=i.pedido_id
     WHERE md.fecha=? AND o.tipo='vianda' AND o.estado='cobrado' AND date(o.cerrado_en)=?
     GROUP BY md.id ORDER BY md.opcion ASC`
  ).all(fecha, fecha);
  const cartaItems = db.prepare(
    `SELECT i.nombre, SUM(i.cantidad) cantidad, COALESCE(SUM(i.cantidad*i.precio_unit),0) importe
     FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
     WHERE o.tipo='vianda' AND o.estado='cobrado' AND date(o.cerrado_en)=? AND i.estado<>'anulado' AND i.menu_dia_id IS NULL
     GROUP BY i.nombre ORDER BY cantidad DESC`
  ).all(fecha);
  const medios = db.prepare(
    `SELECT pg.medio, COALESCE(SUM(pg.importe),0) total, COUNT(*) n
     FROM pago pg JOIN pedido o ON o.id=pg.pedido_id
     WHERE o.${baseCobr} GROUP BY pg.medio ORDER BY total DESC`
  ).all(fecha);
  const ent = db.prepare(
    `SELECT COALESCE(NULLIF(entrega,''),'domicilio') entrega, COUNT(*) n
     FROM pedido WHERE ${baseCobr} GROUP BY entrega`
  ).all(fecha);
  const tot = db.prepare(`SELECT COALESCE(SUM(total),0) total, COUNT(*) n FROM pedido WHERE ${baseCobr}`).get(fecha);
  const pend = db.prepare(
    "SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM pedido WHERE tipo='vianda' AND estado<>'cobrado' AND estado<>'anulado' AND date(abierto_en)=?"
  ).get(fecha);
  const totalViandas = porMenu.reduce((a, m) => a + m.cantidad, 0);
  const efectivo = medios.filter((m) => /EFECTIVO/i.test(m.medio)).reduce((a, m) => a + m.total, 0);
  const dom = (ent.find((e) => e.entrega === 'domicilio') || {}).n || 0;
  const ret = (ent.find((e) => e.entrega === 'retiro') || {}).n || 0;
  const emitido = new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const L = [];
  L.push('  Fecha: ' + fecha + '   Emitido: ' + emitido, '');
  if (!porMenu.length && !cartaItems.length) L.push('  Sin viandas cobradas hoy.');
  porMenu.forEach((m, i) => L.push('  ' + String(m.cantidad).padStart(3) + ' x Menu ' + (i + 1) + ': ' + m.nombre + '  ' + moneyTxt(m.importe)));
  if (cartaItems.length) {
    L.push('  --- De la carta ---');
    cartaItems.forEach((c) => L.push('  ' + String(c.cantidad).padStart(3) + ' x ' + c.nombre + '  ' + moneyTxt(c.importe)));
  }
  L.push('----------------------------------------');
  L.push('  Viandas: ' + totalViandas + '    Pedidos: ' + tot.n);
  L.push('  A domicilio: ' + dom + '    Retiran: ' + ret);
  L.push('----------------------------------------');
  L.push('  Formas de pago:');
  for (const m of medios) L.push('   ' + m.medio + ': ' + moneyTxt(m.total) + ' (' + m.n + ')');
  L.push('----------------------------------------');
  L.push('  TOTAL VENDIDO: ' + moneyTxt(tot.total));
  L.push('  EN EFECTIVO: ' + moneyTxt(efectivo));
  if (pend.n > 0) { L.push('----------------------------------------'); L.push('  OJO: ' + pend.n + ' pedido(s) SIN COBRAR (' + moneyTxt(pend.total) + ')'); }
  const impresora = (getConfig().impresion || {}).impresoraCuenta || undefined;
  let resultado;
  try { resultado = await imprimirTextoPlano('CIERRE DE VIANDAS', L, impresora, req.body.operador); }
  catch (e) { resultado = { ok: false, error: e.message }; }
  res.json({ ok: true, resultado, fecha, totalVendido: tot.total, efectivo, totalViandas, pedidos: tot.n, sinCobrar: pend.n });
});

// Bandeja del BOT de viandas: mensajes de WhatsApp que la IA interpretó como pedido de vianda,
// esperando que el local los confirme.
app.get('/api/viandas/inbox', (req, res) => {
  const rows = db.prepare("SELECT * FROM wa_inbox WHERE clase='vianda' AND estado='pendiente' ORDER BY id DESC LIMIT 100").all();
  res.json(rows.map((r) => { let p = null; try { p = JSON.parse(r.propuesta || 'null'); } catch { p = null; } return { ...r, propuesta: p }; }));
});

// Confirmar una propuesta -> crea el pedido de vianda y recién ahí le avisa al cliente por WhatsApp.
// El body puede traer la versión EDITADA por el cajero (items/cliente/entrega).
app.post('/api/viandas/inbox/:id/confirmar', (req, res) => {
  const msg = db.prepare("SELECT * FROM wa_inbox WHERE id=?").get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'No existe' });
  let prop = {}; try { prop = JSON.parse(msg.propuesta || '{}') || {}; } catch { prop = {}; }
  const data = (req.body && Array.isArray(req.body.items)) ? req.body : prop;
  const items = (data.items || []).map((x) => {
    const base = { nombre: x.nombre, precio_unit: x.precio ?? x.precio_unit ?? 0, cantidad: x.cantidad, observacion: (x.observacion || '').trim() || null };
    if (x.menu_dia_id) return { ...base, menu_dia_id: x.menu_dia_id };
    if (x.plato_id) return { ...base, plato_id: x.plato_id };
    return base; // ítem libre / extra fuera del menú
  });
  if (!items.length) return res.status(400).json({ error: 'La propuesta no tiene ítems' });
  const p = crearViandaPedido({
    cliente_nombre: data.cliente_nombre, cliente_telefono: data.cliente_telefono || msg.telefono,
    cliente_direccion: data.cliente_direccion, entrega: data.entrega, hora_entrega: data.hora_entrega,
    observacion: data.observacion || data.nota, items,
  });
  db.prepare("UPDATE wa_inbox SET estado='convertido', pedido_id=? WHERE id=?").run(p.id, msg.id);
  io.emit('wa:actualizado', db.prepare('SELECT * FROM wa_inbox WHERE id=?').get(msg.id));
  io.emit('vianda:inbox', db.prepare('SELECT * FROM wa_inbox WHERE id=?').get(msg.id));
  // Avisar al cliente (recién ahora, ya confirmado por el local)
  const w = getConfig().whatsapp || {};
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  // Detalle adaptado a LO QUE PIDIÓ: incluye el cambio/aclaración de cada ítem y los extras
  const det = items.map((i) => `${i.cantidad}× ${i.nombre}${i.observacion ? ' (' + i.observacion + ')' : ''}`).join(', ');
  let txt = (w.textoViandaOK || '¡Anotado! 🍱 {detalle}. Total {total}. ¡Gracias! 🙌').replace('{detalle}', det).replace('{total}', money(p.total));
  if ((data.entrega || 'domicilio') !== 'retiro') {
    // ETA según la hora: pasadas las 12:30 el "mediodía" ya no aplica, avisamos "cerca de las 13 hs"
    const t = db.prepare("SELECT strftime('%H:%M','now','localtime') t").get().t;
    const [hh, mm] = t.split(':').map(Number);
    const tarde = (hh * 60 + mm) >= (12 * 60 + 30);
    txt += tarde ? ' Cerca de las 13 hs te lo llevamos 🛵' : ' Te lo llevamos al mediodía 🛵';
  }
  if (msg.wa_jid) wa.enviarMensaje(msg.wa_jid, txt);
  res.json(p);
});

app.post('/api/viandas/inbox/:id/descartar', (req, res) => {
  db.prepare("UPDATE wa_inbox SET estado='descartado' WHERE id=?").run(req.params.id);
  io.emit('vianda:inbox', db.prepare('SELECT * FROM wa_inbox WHERE id=?').get(req.params.id));
  res.json({ ok: true });
});

// Cobrar / cerrar pedido
app.post('/api/pedidos/:id/pagar', (req, res) => {
  const pedidoId = req.params.id;
  const actual = db.prepare('SELECT estado, total FROM pedido WHERE id=?').get(pedidoId);
  if (!actual) return res.status(404).json({ error: 'No existe' });
  if (actual.estado === 'cobrado') return res.status(409).json({ error: 'El pedido ya fue cobrado' });
  // No permitir cobrar un pedido sin ítems vigentes (evita cobros en $0 y descuadres)
  const nItems = db.prepare("SELECT COUNT(*) c FROM pedido_item WHERE pedido_id=? AND estado<>'anulado'").get(pedidoId).c;
  if (nItems === 0) return res.status(400).json({ error: 'El pedido no tiene ítems para cobrar' });
  const pagos = (req.body.pagos && req.body.pagos.length) ? req.body.pagos : [{ medio: 'EFECTIVO', importe: req.body.total }];
  const descuento = Math.max(0, Number(req.body.descuento) || 0);
  const propina = Math.max(0, Number(req.body.propina) || 0);
  // Normalizar importes: redondeados y nunca negativos; y exigir que se cobre algo > 0
  for (const pg of pagos) pg.importe = Math.max(0, Math.round(Number(pg.importe) || 0));
  if (pagos.reduce((a, pg) => a + pg.importe, 0) <= 0) return res.status(400).json({ error: 'El importe cobrado debe ser mayor a 0' });
  // Si se cobra como FIADO, hay que indicar a qué cuenta corriente se carga.
  const fiado = pagos.find((pg) => /FIADO/i.test(pg.medio || ''));
  if (fiado && !req.body.cuenta_id) return res.status(400).json({ error: 'Falta la cuenta corriente para el fiado' });
  if (req.body.cuenta_id) {
    const c = db.prepare('SELECT id FROM cuenta WHERE id=? AND activo=1').get(req.body.cuenta_id);
    if (!c) return res.status(400).json({ error: 'La cuenta corriente no existe' });
  }
  const insPago = db.prepare('INSERT INTO pago (pedido_id, medio, importe) VALUES (?,?,?)');
  const tx = db.transaction(() => {
    for (const pg of pagos) insPago.run(pedidoId, pg.medio || 'EFECTIVO', pg.importe);
    // Cargo a la cuenta corriente por la parte fiada (importe ya redondeado, topeado a lo cobrable)
    if (fiado) {
      const cobrable = Math.max(0, Math.round(actual.total - descuento + propina));
      const importeFiado = Math.min(fiado.importe, cobrable);
      db.prepare(
        "INSERT INTO cuenta_mov (cuenta_id, tipo, importe, pedido_id, detalle) VALUES (?, 'cargo', ?, ?, ?)"
      ).run(req.body.cuenta_id, importeFiado, pedidoId, req.body.detalle || null);
    }
    db.prepare("UPDATE pedido SET estado='cobrado', descuento=?, propina=?, cerrado_en=datetime('now','localtime') WHERE id=?")
      .run(descuento, propina, pedidoId);
    const ped = db.prepare('SELECT mesa_id FROM pedido WHERE id=?').get(pedidoId);
    if (ped.mesa_id) db.prepare("UPDATE mesa SET estado='libre' WHERE id=?").run(ped.mesa_id);
  });
  tx();
  const p = pedidoCompleto(pedidoId);
  io.emit('pedido:cobrado', p);
  emitDashboard();
  res.json(p);
});

// Reabrir un pedido cobrado por error: borra sus pagos, revierte el fiado y lo deja para volver a cobrar
app.post('/api/pedidos/:id/reabrir', (req, res) => {
  const pedidoId = req.params.id;
  const ped = db.prepare('SELECT * FROM pedido WHERE id=?').get(pedidoId);
  if (!ped) return res.status(404).json({ error: 'No existe' });
  if (ped.estado !== 'cobrado') return res.status(409).json({ error: 'El pedido no está cobrado' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM pago WHERE pedido_id=?').run(pedidoId);
    // revertir cargos de fiado de este pedido
    db.prepare("DELETE FROM cuenta_mov WHERE pedido_id=? AND tipo='cargo'").run(pedidoId);
    const nuevoEstado = ped.mesa_id ? 'servido' : 'en_cocina';
    db.prepare("UPDATE pedido SET estado=?, cerrado_en=NULL, descuento=0, propina=0 WHERE id=?").run(nuevoEstado, pedidoId);
    if (ped.mesa_id) db.prepare("UPDATE mesa SET estado='ocupada' WHERE id=?").run(ped.mesa_id);
  });
  tx();
  const p = pedidoCompleto(pedidoId);
  io.emit('pedido:actualizado', p);
  emitDashboard();
  res.json(p);
});

// Mover un pedido a otra mesa (la mesa destino debe estar libre)
app.post('/api/pedidos/:id/mover', (req, res) => {
  const ped = db.prepare('SELECT * FROM pedido WHERE id=?').get(req.params.id);
  if (!ped) return res.status(404).json({ error: 'No existe' });
  if (!['abierto', 'en_cocina', 'servido'].includes(ped.estado)) return res.status(409).json({ error: 'El pedido no está abierto' });
  const mesaId = Number(req.body.mesa_id);
  const mesa = db.prepare('SELECT * FROM mesa WHERE id=?').get(mesaId);
  if (!mesa) return res.status(400).json({ error: 'La mesa no existe' });
  const ocupada = db.prepare("SELECT id FROM pedido WHERE mesa_id=? AND estado IN ('abierto','en_cocina','servido')").get(mesaId);
  if (ocupada) return res.status(409).json({ error: 'La mesa destino está ocupada (usá Unir mesas)' });
  const vieja = ped.mesa_id;
  db.prepare('UPDATE pedido SET mesa_id=? WHERE id=?').run(mesaId, ped.id);
  db.prepare("UPDATE mesa SET estado='ocupada' WHERE id=?").run(mesaId);
  if (vieja && vieja !== mesaId) db.prepare("UPDATE mesa SET estado='libre' WHERE id=?").run(vieja);
  const p = pedidoCompleto(ped.id);
  io.emit('pedido:actualizado', p);
  emitDashboard();
  res.json(p);
});

// Unir: pasa los platos de este pedido a otro pedido (mesa destino) y cierra este
app.post('/api/pedidos/:id/unir', (req, res) => {
  const origen = db.prepare('SELECT * FROM pedido WHERE id=?').get(req.params.id);
  const destino = db.prepare('SELECT * FROM pedido WHERE id=?').get(Number(req.body.destino_pedido_id));
  if (!origen || !destino) return res.status(404).json({ error: 'No existe' });
  if (origen.id === destino.id) return res.status(400).json({ error: 'Mismo pedido' });
  if (![origen, destino].every((p) => ['abierto', 'en_cocina', 'servido'].includes(p.estado)))
    return res.status(409).json({ error: 'Ambos pedidos deben estar abiertos' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE pedido_item SET pedido_id=? WHERE pedido_id=?').run(destino.id, origen.id);
    db.prepare("UPDATE pedido SET estado='anulado', observacion=?, cerrado_en=datetime('now','localtime') WHERE id=?")
      .run('Unido al pedido #' + destino.id, origen.id);
    if (origen.mesa_id) db.prepare("UPDATE mesa SET estado='libre' WHERE id=?").run(origen.mesa_id);
    recalcTotal(destino.id);
    recalcTotal(origen.id);
  });
  tx();
  const p = pedidoCompleto(destino.id);
  io.emit('pedido:actualizado', p);
  io.emit('pedido:actualizado', pedidoCompleto(origen.id));
  emitDashboard();
  res.json(p);
});

app.post('/api/pedidos/:id/anular', (req, res) => {
  const pedidoId = req.params.id;
  const ped = db.prepare('SELECT * FROM pedido WHERE id=?').get(pedidoId);
  if (!ped) return res.status(404).json({ error: 'No existe' });
  if (ped.estado === 'cobrado') return res.status(409).json({ error: 'El pedido ya fue cobrado. Usá "Reabrir cobro" primero.' });
  devolverStockPedido(pedidoId); // devolver al stock lo consumido antes de anular
  const motivo = (req.body.motivo || '').trim();
  const obs = motivo ? ('Anulado: ' + motivo + (ped.observacion ? ' · ' + ped.observacion : '')) : ped.observacion;
  db.prepare("UPDATE pedido SET estado='anulado', observacion=?, cerrado_en=datetime('now','localtime') WHERE id=?")
    .run(obs, pedidoId);
  if (ped.mesa_id) db.prepare("UPDATE mesa SET estado='libre' WHERE id=?").run(ped.mesa_id);
  io.emit('pedido:actualizado', pedidoCompleto(pedidoId));
  emitDashboard();
  res.json({ ok: true });
});

// ================= CUENTAS CORRIENTES (fiado) =================
const saldoSql = "COALESCE((SELECT SUM(CASE WHEN tipo='cargo' THEN importe ELSE -importe END) FROM cuenta_mov WHERE cuenta_id=c.id),0)";

const MESES_ES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
// 'YYYY-MM' -> 'Julio 2026'
const nombreMes = (ym) => { const [a, m] = (ym || '').split('-'); return (MESES_ES[Number(m)] || ym) + ' ' + a; };

// Desglose de la cuenta POR MES de consumo, con los pagos aplicados FIFO (primero el mes más viejo).
// Así julio no se mezcla con agosto: cada mes queda con su pendiente hasta que se salda.
function desgloseMensual(cuentaId) {
  const cargos = db.prepare(
    "SELECT substr(fecha,1,7) mes, SUM(importe) total FROM cuenta_mov WHERE cuenta_id=? AND tipo='cargo' GROUP BY mes ORDER BY mes"
  ).all(cuentaId);
  const totalPagos = db.prepare("SELECT COALESCE(SUM(importe),0) t FROM cuenta_mov WHERE cuenta_id=? AND tipo='pago'").get(cuentaId).t;
  let restante = totalPagos;
  const porMes = cargos.map((c) => {
    const pagado = Math.min(restante, c.total);
    restante -= pagado;
    return { mes: c.mes, etiqueta: nombreMes(c.mes), cargos: c.total, pagado, pendiente: Math.round(c.total - pagado) };
  });
  const credito = Math.round(restante); // pago a favor si pagaron de más
  const totalCargos = cargos.reduce((a, c) => a + c.total, 0);
  return { porMes, credito, totalPagos, saldo: Math.round(totalCargos - totalPagos) };
}

app.get('/api/cuentas', (req, res) => {
  const rows = db.prepare(`SELECT c.*, ${saldoSql} saldo FROM cuenta c WHERE c.activo=1 ORDER BY c.nombre`).all();
  // Adjuntar el desglose por mes (para mostrar julio/agosto separados en la lista)
  for (const c of rows) c.porMes = desgloseMensual(c.id).porMes.filter((m) => m.pendiente > 0);
  res.json(rows);
});

app.post('/api/cuentas', (req, res) => {
  const { nombre, tipo, telefono, nota } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre' });
  const r = db.prepare('INSERT INTO cuenta (nombre, tipo, telefono, nota) VALUES (?,?,?,?)')
    .run(nombre.trim(), tipo || 'empresa', telefono || null, nota || null);
  res.json(db.prepare('SELECT * FROM cuenta WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/cuentas/:id', (req, res) => {
  const { nombre, tipo, telefono, nota, activo } = req.body;
  db.prepare(
    `UPDATE cuenta SET nombre=COALESCE(?,nombre), tipo=COALESCE(?,tipo),
       telefono=COALESCE(?,telefono), nota=COALESCE(?,nota), activo=COALESCE(?,activo) WHERE id=?`
  ).run(nombre ?? null, tipo ?? null, telefono ?? null, nota ?? null, activo ?? null, req.params.id);
  res.json(db.prepare('SELECT * FROM cuenta WHERE id=?').get(req.params.id));
});

app.get('/api/cuentas/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM cuenta WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No existe' });
  c.movimientos = db.prepare(
    `SELECT m.*, p.tipo pedido_tipo FROM cuenta_mov m LEFT JOIN pedido p ON p.id=m.pedido_id
     WHERE m.cuenta_id=? ORDER BY m.id DESC LIMIT 300`
  ).all(c.id);
  const dg = desgloseMensual(c.id);
  c.saldo = dg.saldo;
  c.porMes = dg.porMes;
  c.credito = dg.credito;
  res.json(c);
});

// Imprime el ESTADO DE CUENTA de una empresa (movimientos + saldo), para cobrarle a fin de mes.
app.post('/api/cuentas/:id/imprimir', async (req, res) => {
  const c = db.prepare('SELECT * FROM cuenta WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No existe' });
  const movs = db.prepare(
    "SELECT tipo, importe, medio, detalle, pedido_id, fecha FROM cuenta_mov WHERE cuenta_id=? ORDER BY id ASC"
  ).all(c.id);
  const saldo = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN tipo='cargo' THEN importe ELSE -importe END),0) s FROM cuenta_mov WHERE cuenta_id=?"
  ).get(c.id).s;
  const fecha = new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const periodo = (req.body.periodo || '').trim(); // 'YYYY-MM' para un solo mes; vacío = toda la cuenta
  const lineas = [];
  lineas.push('Empresa: ' + c.nombre);
  if (c.telefono) lineas.push('Tel: ' + c.telefono);
  lineas.push('Emitido: ' + fecha);
  lineas.push('----------------------------------------');
  const fdmy = (m) => (m.fecha || '').slice(0, 10).split('-').reverse().join('/'); // aaaa-mm-dd -> dd/mm/aaaa
  const dg = desgloseMensual(c.id);
  const cargos = movs.filter((m) => m.tipo === 'cargo');
  const pagos = movs.filter((m) => m.tipo === 'pago');
  const titulo = periodo ? 'ESTADO DE CUENTA - ' + nombreMes(periodo) : 'ESTADO DE CUENTA';

  if (periodo) {
    // ----- Un solo mes -----
    const mesItem = dg.porMes.find((m) => m.mes === periodo) || { cargos: 0, pagado: 0, pendiente: 0 };
    lineas.push('PERIODO: ' + nombreMes(periodo));
    lineas.push('----------------------------------------');
    const delMes = cargos.filter((m) => (m.fecha || '').slice(0, 7) === periodo);
    if (!delMes.length) lineas.push('Sin consumos en este periodo.');
    for (const m of delMes) lineas.push(' ' + fdmy(m) + ' Consumo' + (m.pedido_id ? ' #' + m.pedido_id : '') + (m.detalle ? ' ' + m.detalle : '') + '  +' + moneyTxt(m.importe));
    lineas.push('----------------------------------------');
    lineas.push('Consumos del mes: ' + moneyTxt(mesItem.cargos));
    if (mesItem.pagado > 0) lineas.push('Pagado a cuenta:  -' + moneyTxt(mesItem.pagado));
    lineas.push('PENDIENTE DEL MES: ' + moneyTxt(mesItem.pendiente));
  } else {
    // ----- Toda la cuenta, agrupada por mes -----
    if (!movs.length) lineas.push('Sin movimientos.');
    const meses = [...new Set(cargos.map((m) => (m.fecha || '').slice(0, 7)))].sort();
    for (const ym of meses) {
      lineas.push(nombreMes(ym).toUpperCase());
      let sub = 0;
      for (const m of cargos.filter((x) => (x.fecha || '').slice(0, 7) === ym)) {
        lineas.push(' ' + fdmy(m) + ' Consumo' + (m.pedido_id ? ' #' + m.pedido_id : '') + (m.detalle ? ' ' + m.detalle : '') + '  +' + moneyTxt(m.importe));
        sub += m.importe;
      }
      lineas.push('   Subtotal ' + nombreMes(ym) + ': ' + moneyTxt(sub));
    }
    if (pagos.length) {
      lineas.push('----------------------------------------');
      lineas.push('PAGOS RECIBIDOS');
      for (const m of pagos) lineas.push(' ' + fdmy(m) + ' Pago' + (m.medio ? ' ' + m.medio : '') + '  -' + moneyTxt(m.importe));
    }
    lineas.push('----------------------------------------');
    lineas.push('PENDIENTE POR MES (se cobra del mas viejo al mas nuevo):');
    for (const m of dg.porMes) lineas.push(' ' + m.etiqueta + ': ' + (m.pendiente <= 0 ? 'SALDADO' : 'debe ' + moneyTxt(m.pendiente)));
    if (dg.credito > 0) lineas.push(' A favor (credito): ' + moneyTxt(dg.credito));
    lineas.push('----------------------------------------');
    lineas.push('TOTAL A PAGAR: ' + moneyTxt(Math.max(0, saldo)));
  }
  const impresora = (getConfig().impresion || {}).impresoraCuenta || undefined;
  let r;
  try { r = await imprimirTextoPlano(titulo, lineas, impresora, req.body.operador); }
  catch (e) { r = { ok: false, error: e.message }; }
  res.json({ ok: true, resultado: r });
});

// Registrar un pago de la empresa/cliente (baja el saldo)
app.post('/api/cuentas/:id/pago', (req, res) => {
  const importe = Number(req.body.importe);
  if (!(importe > 0)) return res.status(400).json({ error: 'Importe inválido' });
  const c = db.prepare('SELECT id FROM cuenta WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No existe' });
  db.prepare("INSERT INTO cuenta_mov (cuenta_id, tipo, importe, medio, detalle) VALUES (?, 'pago', ?, ?, ?)")
    .run(req.params.id, importe, req.body.medio || 'EFECTIVO', req.body.detalle || null);
  emitDashboard();
  res.json({ ok: true });
});

// ================= CIERRE DE CAJA (arqueo) =================
function inicioPeriodoCaja() {
  const u = db.prepare('SELECT MAX(hasta) h FROM cierre_caja').get();
  return u && u.h ? u.h : '1970-01-01 00:00:00';
}

function resumenCaja() {
  const desde = inicioPeriodoCaja();
  // La caja es SOLO del salón (mediodía + noche, incl. cafetería/mostrador). Viandas y delivery
  // se manejan como cajas APARTE (cada una con su propio cierre) y no suman acá.
  const SALON = "o.tipo NOT IN ('vianda','delivery')";
  const ventas = db.prepare(
    `SELECT pg.medio, COALESCE(SUM(pg.importe),0) total, COUNT(*) n
     FROM pago pg JOIN pedido o ON o.id=pg.pedido_id
     WHERE pg.fecha > ? AND ${SALON} GROUP BY pg.medio ORDER BY total DESC`
  ).all(desde);
  const tot = db.prepare(
    `SELECT COALESCE(SUM(pg.importe),0) total, COUNT(DISTINCT pg.pedido_id) tickets
     FROM pago pg JOIN pedido o ON o.id=pg.pedido_id WHERE pg.fecha > ? AND ${SALON}`
  ).get(desde);
  const cobrosFiado = db.prepare(
    `SELECT COALESCE(medio,'(s/d)') medio, COALESCE(SUM(importe),0) total, COUNT(*) n
     FROM cuenta_mov WHERE tipo='pago' AND fecha > ? GROUP BY medio`
  ).all(desde);
  const movimientos = db.prepare('SELECT * FROM caja_mov WHERE fecha > ? ORDER BY id DESC').all(desde);
  const sumMov = (t) => movimientos.filter((m) => m.tipo === t).reduce((a, m) => a + m.importe, 0);
  const fondo = sumMov('apertura');
  const egresos = sumMov('egreso');
  const ingresos = sumMov('ingreso');
  const propinas = db.prepare(`SELECT COALESCE(SUM(o.propina),0) t FROM pedido o WHERE o.estado='cobrado' AND o.cerrado_en > ? AND ${SALON}`).get(desde).t;
  const descuentos = db.prepare(`SELECT COALESCE(SUM(o.descuento),0) t FROM pedido o WHERE o.estado='cobrado' AND o.cerrado_en > ? AND ${SALON}`).get(desde).t;
  const sum = (arr, f = () => true) => arr.filter(f).reduce((a, m) => a + m.total, 0);
  const esEfectivo = (m) => /EFECTIVO/i.test(m.medio);
  const esFiado = (m) => /FIADO/i.test(m.medio);
  const ventaEfectivo = sum(ventas, esEfectivo);
  const ventaFiado = sum(ventas, esFiado);
  const fiadoCobradoEfectivo = sum(cobrosFiado, esEfectivo);
  // Propina cobrada por TARJETA/TRANSFERENCIA: entra por el posnet, pero el mozo retira esa misma
  // plata en EFECTIVO del cajón → hay que restarla del esperado. (La de efectivo la saca antes de
  // que entre al cajón, así que no toca la caja: son los pedidos SIN ningún pago en efectivo.)
  const propinaRetiradaEfectivo = db.prepare(
    `SELECT COALESCE(SUM(o.propina),0) t FROM pedido o
     WHERE o.estado='cobrado' AND o.cerrado_en > ? AND o.propina > 0 AND ${SALON}
       AND NOT EXISTS (SELECT 1 FROM pago pg WHERE pg.pedido_id=o.id AND UPPER(pg.medio) LIKE '%EFECTIVO%')`
  ).get(desde).t;
  const esperado = fondo + ventaEfectivo + fiadoCobradoEfectivo + ingresos - egresos - propinaRetiradaEfectivo;
  // Informativo: lo que se vendió en las cajas APARTE (viandas y delivery). NO suma en el salón.
  const aparte = db.prepare(
    `SELECT o.tipo, COALESCE(SUM(pg.importe),0) total FROM pago pg JOIN pedido o ON o.id=pg.pedido_id
     WHERE pg.fecha > ? AND o.tipo IN ('vianda','delivery') GROUP BY o.tipo`
  ).all(desde);
  const aparteViandas = (aparte.find((a) => a.tipo === 'vianda') || {}).total || 0;
  const aparteDelivery = (aparte.find((a) => a.tipo === 'delivery') || {}).total || 0;
  return {
    desde, ventas, totalVentas: tot.total, tickets: tot.tickets,
    ventaEfectivo, ventaEfectivoSalon: ventaEfectivo,
    ventaFiado, ventaOtros: tot.total - ventaEfectivo - ventaFiado,
    cobrosFiado, fiadoCobradoTotal: sum(cobrosFiado), fiadoCobradoEfectivo,
    fondo, egresos, ingresos, propinas, propinaRetiradaEfectivo, descuentos, movimientos,
    aparteViandas, aparteDelivery,
    esperado, efectivoEnCaja: esperado,
  };
}

async function imprimirCierre(cierre, r) {
  const L = [];
  L.push('Cierre #' + cierre.id + '  (SALON)');
  L.push('  desde ' + cierre.desde);
  L.push('  hasta ' + cierre.hasta);
  L.push('------------------------');
  L.push('VENTAS POR MEDIO (salon)');
  for (const m of r.ventas) L.push(' ' + m.medio + ': ' + moneyTxt(m.total) + ' (' + m.n + ')');
  L.push('Tickets: ' + r.tickets);
  L.push('TOTAL VENTAS (salon): ' + moneyTxt(r.totalVentas));
  if (r.descuentos > 0) L.push('Descuentos: ' + moneyTxt(r.descuentos));
  if (r.propinas > 0) L.push('Propinas: ' + moneyTxt(r.propinas));
  if (r.fiadoCobradoTotal > 0) {
    L.push('------------------------');
    L.push('COBROS DE FIADO');
    for (const m of r.cobrosFiado) L.push(' ' + m.medio + ': ' + moneyTxt(m.total));
  }
  if (r.ventaFiado > 0) L.push('Fiado nuevo (a cobrar): ' + moneyTxt(r.ventaFiado));
  if (r.aparteViandas > 0 || r.aparteDelivery > 0) {
    L.push('------------------------');
    L.push('OTRAS CAJAS (aparte, no suman)');
    if (r.aparteViandas > 0) L.push(' Viandas: ' + moneyTxt(r.aparteViandas));
    if (r.aparteDelivery > 0) L.push(' Delivery: ' + moneyTxt(r.aparteDelivery));
  }
  L.push('------------------------');
  L.push('ARQUEO DE EFECTIVO (salon)');
  L.push(' Fondo inicial: ' + moneyTxt(r.fondo));
  L.push(' Ventas efectivo: ' + moneyTxt(r.ventaEfectivo));
  if (r.fiadoCobradoEfectivo > 0) L.push(' Fiado cobrado efvo: ' + moneyTxt(r.fiadoCobradoEfectivo));
  if (r.propinaRetiradaEfectivo > 0) L.push(' (-) Propinas tarjeta/transf (mozo retira efvo): ' + moneyTxt(r.propinaRetiradaEfectivo));
  if (r.ingresos > 0) L.push(' Ingresos: ' + moneyTxt(r.ingresos));
  if (r.egresos > 0) {
    L.push(' Egresos: -' + moneyTxt(r.egresos));
    // Detalle de cada egreso (para qué se usó la plata), del más viejo al más nuevo
    const egresos = (r.movimientos || []).filter((m) => m.tipo === 'egreso').slice().reverse();
    for (const e of egresos) L.push('   - ' + (e.detalle || 'sin detalle') + ': ' + moneyTxt(e.importe));
  }
  L.push(' ESPERADO: ' + moneyTxt(r.esperado));
  if (cierre.contado != null) {
    L.push(' Contado: ' + moneyTxt(cierre.contado));
    const d = cierre.diferencia;
    L.push(' DIFERENCIA: ' + (d === 0 ? 'OK' : (d > 0 ? 'SOBRA ' + moneyTxt(d) : 'FALTA ' + moneyTxt(-d))));
  }
  return imprimirTextoPlano('CIERRE DE CAJA', L, undefined, cierre.usuario);
}

// Registrar un movimiento de caja: apertura (fondo) | egreso (retiro/pago) | ingreso (extra)
app.post('/api/caja/movimiento', (req, res) => {
  const tipo = req.body.tipo;
  const importe = Math.round(Number(req.body.importe) || 0);
  if (!['apertura', 'egreso', 'ingreso'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  if (!(importe > 0)) return res.status(400).json({ error: 'Importe inválido' });
  const detalle = (req.body.detalle || '').trim();
  // En los egresos la descripción es obligatoria (se detalla en el ticket de cierre)
  if (tipo === 'egreso' && !detalle) return res.status(400).json({ error: 'El egreso necesita una descripción (para qué se usó).' });
  db.prepare('INSERT INTO caja_mov (tipo, importe, detalle) VALUES (?,?,?)').run(tipo, importe, detalle || null);
  emitDashboard();
  res.json({ ok: true });
});

app.get('/api/caja/resumen', (req, res) => res.json(resumenCaja()));

app.post('/api/caja/cerrar', async (req, res) => {
  const r = resumenCaja();
  const hasta = db.prepare("SELECT datetime('now','localtime') h").get().h;
  const contado = (req.body.contado === '' || req.body.contado == null) ? null : Math.round(Number(req.body.contado));
  const diferencia = contado == null ? null : contado - r.esperado;
  const ins = db.prepare(
    `INSERT INTO cierre_caja (desde, hasta, total, tickets, fondo, egresos, esperado, contado, diferencia, detalle, usuario)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(r.desde, hasta, r.totalVentas, r.tickets, r.fondo, r.egresos, r.esperado, contado, diferencia, JSON.stringify(r), req.body.usuario || null);
  const cierre = db.prepare('SELECT * FROM cierre_caja WHERE id=?').get(ins.lastInsertRowid);
  let impresion = null;
  if (req.body.imprimir) { try { impresion = await imprimirCierre(cierre, r); } catch (e) { console.error('print cierre:', e.message); } }
  res.json({ cierre, impresion });
});

app.get('/api/caja/cierres', (req, res) =>
  res.json(db.prepare('SELECT * FROM cierre_caja ORDER BY id DESC LIMIT 60').all())
);

// Reimprimir un cierre anterior
app.post('/api/caja/cierres/:id/imprimir', async (req, res) => {
  const cierre = db.prepare('SELECT * FROM cierre_caja WHERE id=?').get(req.params.id);
  if (!cierre) return res.status(404).json({ error: 'No existe' });
  let r = {};
  try { r = JSON.parse(cierre.detalle || '{}'); } catch { /* sin detalle */ }
  try { const imp = await imprimirCierre(cierre, r); res.json({ ok: true, impresion: imp }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ================= WHATSAPP =================
// Normaliza texto para comparar sin acentos ni mayúsculas
const normalizar = (s) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Clasifica el mensaje entrante: 'pedido' si contiene alguna palabra clave, si no 'consulta'
function clasificarMensaje(texto, palabras) {
  const t = normalizar(texto);
  return (palabras || []).some((p) => t.includes(normalizar(p))) ? 'pedido' : 'consulta';
}

// Memoria de la última auto-respuesta enviada a cada número (para no repetir)
const ultimaRespuestaWa = new Map(); // jid -> { tipo, ts }

// Pre-filtro barato: ¿vale la pena gastar la IA para ver si es un pedido de vianda?
// (evita llamar a la IA con saludos sueltos o mensajes largos que no tienen pinta de pedido)
function pareceVianda(texto, menus) {
  const t = (texto || '').toLowerCase();
  if (!t || t.length > 240) return false;
  if (/\d/.test(t)) return true;
  if (/\b(menu|men[uú]|vianda|viandas|opci[oó]n|opcion|uno|dos|tres|primer|segund)\b/.test(t)) return true;
  for (const m of menus) {
    for (const w of (m.nombre || '').toLowerCase().split(/\s+/)) {
      if (w.length >= 4 && t.includes(w)) return true;
    }
  }
  return false;
}

// ¿Estamos en el horario en que el bot de viandas debe interpretar? (config whatsapp.viandasDesde/Hasta)
// Vacío = sin restricción. Fuera de esa franja, el bot NO gasta IA interpretando viandas.
function enHorarioViandas(w) {
  const desde = (w.viandasDesde || '').trim();
  const hasta = (w.viandasHasta || '').trim();
  if (!desde && !hasta) return true;
  const now = db.prepare("SELECT strftime('%H:%M','now','localtime') t").get().t;
  if (desde && now < desde) return false;
  if (hasta && now > hasta) return false;
  return true;
}

wa.setHandlers({
  emitEstado: (st) => io.emit('wa:estado', st),
  onMensaje: async ({ jid, telefono, nombre, texto }) => {
    const r = db.prepare(
      'INSERT INTO wa_inbox (wa_jid, telefono, nombre, texto) VALUES (?,?,?,?)'
    ).run(jid, telefono, nombre, texto);
    const row = db.prepare('SELECT * FROM wa_inbox WHERE id=?').get(r.lastInsertRowid);
    io.emit('wa:nuevo', row);

    const cfg = getConfig();
    const w = cfg.whatsapp || {};

    // --- BOT DE VIANDAS: si hay menús del día cargados y el mensaje parece un pedido de vianda,
    // lo interpretamos con la IA y lo dejamos como PROPUESTA en la bandeja de viandas (NO se le
    // responde al cliente todavía: se le avisa recién cuando el local confirma). ---
    try {
      if (w.viandasBot !== false && enHorarioViandas(w)) {
        const fecha = fechaHoy();
        const menus = db.prepare("SELECT * FROM menu_dia WHERE fecha=? AND activo=1 ORDER BY opcion ASC").all(fecha);
        const claveIA = (cfg.telegram || {}).claveIA;
        if (menus.length && claveIA && pareceVianda(texto, menus)) {
          const ahora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
          const v = await parsearViandaIA(texto, menus, claveIA, 'claude-haiku-4-5', ahora);
          if (v && v.es_vianda && Array.isArray(v.items) && v.items.length) {
            // Completar nombre/dirección con lo guardado del cliente si el mensaje no los trae
            const prev = db.prepare(
              `SELECT cliente_nombre nombre, cliente_direccion direccion FROM pedido
               WHERE tipo IN ('delivery','vianda') AND cliente_telefono=? AND cliente_nombre IS NOT NULL
               ORDER BY id DESC LIMIT 1`
            ).get(telefono);
            const items = v.items.map((it) => {
              const op = Number(it.opcion) || 1;
              const m = menus.find((x) => x.opcion === op) || menus[op - 1];
              return m ? { menu_dia_id: m.id, opcion: m.opcion, nombre: m.nombre, precio: m.precio, cantidad: Math.max(1, Math.trunc(Number(it.cantidad) || 1)), observacion: (it.cambio || '').trim() } : null;
            }).filter(Boolean);
            // EXTRAS fuera del menú: intento ponerles el precio buscándolos en el CATÁLOGO.
            // Si lo encuentro, uso ese plato y su precio; si no, queda libre y el local le pone precio.
            const platosCat = db.prepare("SELECT id, nombre, precio FROM plato WHERE activo=1").all();
            const matchExtra = (nombre) => {
              const q = normalizar(nombre); if (!q) return null;
              const exacto = platosCat.find((p) => normalizar(p.nombre) === q);
              if (exacto) return exacto;
              const cont = platosCat.map((p) => ({ p, n: normalizar(p.nombre) }))
                .filter(({ n }) => n && (q.includes(n) || n.includes(q)))
                .sort((a, b) => b.n.length - a.n.length);
              return cont.length ? cont[0].p : null;
            };
            const extras = (Array.isArray(v.extras) ? v.extras : []).map((e) => {
              const nombre = (e.nombre || '').trim();
              const cant = Math.max(1, Math.trunc(Number(e.cantidad) || 1));
              const pl = nombre ? matchExtra(nombre) : null;
              if (pl) return { plato_id: pl.id, nombre: pl.nombre, precio: Math.round(pl.precio), cantidad: cant, observacion: '', deCarta: true };
              return { libre: true, precioPendiente: true, nombre, precio: 0, cantidad: cant, observacion: '' };
            }).filter((e) => e.nombre);
            if (items.length) {
              items.push(...extras);
              // Prioridad del nombre: guardado de pedidos anteriores > nombre del contacto de WhatsApp
              // (pushName) > lo que la IA haya extraído del texto. Así un "Hola Mati" no pisa al cliente real.
              const pushName = (nombre && nombre !== telefono) ? nombre : '';
              const propuesta = {
                cliente_nombre: (prev?.nombre || '').trim() || pushName || (v.cliente_nombre || '').trim() || '',
                cliente_telefono: telefono,
                cliente_direccion: (v.direccion || '').trim() || (prev?.direccion || ''),
                entrega: v.entrega === 'retiro' ? 'retiro' : 'domicilio',
                hora_entrega: (v.hora_entrega || '').trim(),
                nota: (v.nota || '').trim(),
                items,
              };
              db.prepare("UPDATE wa_inbox SET clase='vianda', propuesta=? WHERE id=?").run(JSON.stringify(propuesta), row.id);
              io.emit('vianda:inbox', db.prepare('SELECT * FROM wa_inbox WHERE id=?').get(row.id));
              return; // no seguimos con el triage normal ni auto-respondemos
            }
          }
        }
      }
    } catch (e) { console.error('Bot viandas:', e.message); /* si falla, seguimos con el triage normal */ }

    // Auto-respuesta inteligente: distinta según tipo de mensaje y sin repetir
    if (w.autoRespuesta === false) return;

    const tipo = clasificarMensaje(texto, w.palabrasPedido);
    const prev = ultimaRespuestaWa.get(jid);
    const cooldownMs = (w.cooldownMin ?? 180) * 60000;
    const ahora = Date.now();
    const enCooldown = prev && ahora - prev.ts < cooldownMs;
    // Dentro del cooldown NO se repite la respuesta (evita contestar varios
    // mensajes seguidos del mismo cliente). Única excepción: venía haciendo una
    // consulta y ahora sí hace un pedido -> se le confirma el pedido (una sola vez).
    const upgradeAPedido = prev && prev.tipo === 'consulta' && tipo === 'pedido';
    if (enCooldown && !upgradeAPedido) return;

    let txt;
    if (tipo === 'pedido') {
      // Cliente quiere pedir -> le mandamos el mensaje + el LINK de la web de pedidos
      txt = w.textoRecepcion || '¡Hola! 👋 Para hacer tu pedido entrá a nuestra página y elegí del menú. 🍽️';
      if (w.linkPedidos && w.linkPedidos.trim()) txt += '\n👉 ' + w.linkPedidos.trim();
    } else {
      // Consulta -> mensaje programado (horarios, info, etc.)
      txt = w.textoConsulta || '¡Hola! 👋 Gracias por escribir. En breve te respondemos.';
    }
    wa.enviarMensaje(jid, txt);
    ultimaRespuestaWa.set(jid, { tipo, ts: ahora });
  },
});

app.get('/api/whatsapp/estado', (req, res) => res.json(wa.getEstado()));
app.post('/api/whatsapp/conectar', async (req, res) => res.json(await wa.iniciar()));
app.post('/api/whatsapp/desconectar', async (req, res) => { await wa.desconectar(); res.json({ ok: true }); });
// Desvincular de verdad (borra la sesión guardada) para poder poner OTRO número
app.post('/api/whatsapp/desvincular', async (req, res) => { const st = await wa.desvincular(); res.json({ ok: true, estado: st }); });

app.get('/api/whatsapp/inbox', (req, res) => {
  const estado = req.query.estado || 'pendiente';
  // Las propuestas de vianda tienen su propia bandeja (no se mezclan acá)
  res.json(db.prepare("SELECT * FROM wa_inbox WHERE estado=? AND (clase IS NULL OR clase<>'vianda') ORDER BY id DESC LIMIT 200").all(estado));
});

// Convierte un mensaje de la bandeja en un pedido de delivery (el cajero luego carga los items)
app.post('/api/whatsapp/inbox/:id/convertir', (req, res) => {
  const msg = db.prepare('SELECT * FROM wa_inbox WHERE id=?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'No existe' });
  const r = db.prepare(
    `INSERT INTO pedido (tipo, mozo_nombre, cliente_nombre, cliente_telefono, observacion)
     VALUES ('delivery','WhatsApp',?,?,?)`
  ).run(msg.nombre, msg.telefono, 'Pedido WhatsApp: ' + msg.texto);
  db.prepare("UPDATE wa_inbox SET estado='convertido', pedido_id=? WHERE id=?").run(r.lastInsertRowid, msg.id);
  const p = pedidoCompleto(r.lastInsertRowid);
  io.emit('pedido:nuevo', p);
  io.emit('wa:actualizado', db.prepare('SELECT * FROM wa_inbox WHERE id=?').get(msg.id));
  emitDashboard();
  res.json(p);
});

app.post('/api/whatsapp/inbox/:id/descartar', (req, res) => {
  db.prepare("UPDATE wa_inbox SET estado='descartado' WHERE id=?").run(req.params.id);
  io.emit('wa:actualizado', db.prepare('SELECT * FROM wa_inbox WHERE id=?').get(req.params.id));
  res.json({ ok: true });
});

// Descartar TODA la bandeja pendiente de una vez (no toca las propuestas de vianda ni los pedidos creados)
app.post('/api/whatsapp/inbox/descartar-todos', (req, res) => {
  const r = db.prepare("UPDATE wa_inbox SET estado='descartado' WHERE estado='pendiente' AND (clase IS NULL OR clase<>'vianda')").run();
  io.emit('wa:actualizado', { bulk: true });
  res.json({ n: r.changes });
});

app.post('/api/whatsapp/responder', async (req, res) => {
  const { destino, texto } = req.body;
  const ok = await wa.enviarMensaje(destino, texto);
  res.json({ ok });
});

// ================= TELEGRAM (pedidos remotos con IA) =================
const moneyTxt = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-AR');
const ultimoPedidoTg = new Map(); // chatId -> timestamp del último pedido
const pendientesTg = new Map();   // chatId -> { parsed, items, nombre, ts } (modo confirmación)
const ultimaComandaTg = new Map(); // chatId -> { pedidoId, ts } (para reimprimir desde el celular)
const clampCant = (n) => Math.max(1, Math.min(50, Math.round(Number(n) || 1)));

// Detectar respuestas de SÍ / NO (sin acentos, sin signos)
const limpiarResp = (t) => normalizar(t).replace(/[!.¡¿?\s]+$/g, '').trim();
const SI_TG = ['si', 's', 'dale', 'ok', 'oka', 'okey', 'oki', 'listo', 'va', 'vale', 'perfecto', 'correcto', 'confirmo', 'confirmado', 'de una', 'sip', 'si dale', 'dale si', 'si confirmo', '👍', 'confirmar', 'confirma',
  'imprimi', 'imprimir', 'imprimilo', 'imprimila', 'mandalo', 'mandala', 'manda', 'mandale', 'mandale nomas', 'sale', 'dale listo', 'listo dale', 'ok dale', 'dale ok', 'ok listo', 'hacelo', 'hazlo', 'obvio', 'siii', 'sii', 'sipi', 'va que va', 'de once', 'joya', 'buenisimo', 'ok confirmo'];
const NO_TG = ['no', 'nop', 'cancelar', 'cancela', 'cancelalo', 'cancelala', 'negativo', 'anular', 'anulalo', 'borrar', 'borralo', 'mal', 'esta mal', 'no confirmo', 'cancelo', 'no gracias', 'dejalo', 'olvidalo', 'no va', 'mejor no', 'para', 'frena'];
const esSiTg = (t) => SI_TG.includes(limpiarResp(t));
const esNoTg = (t) => NO_TG.includes(limpiarResp(t));

// Pedir REIMPRIMIR la última comanda (si salió cortada, no salió, etc.)
const REIMP_TG = ['reimprimir', 'reimprimi', 'reimprimila', 'reimprimilo', 'reimprima', 'reimprimir comanda',
  'imprimi de nuevo', 'imprimir de nuevo', 'imprimila de nuevo', 'de nuevo la comanda', 'otra vez la comanda',
  'no salio', 'no salio la comanda', 'no imprimio', 'no se imprimio', 'salio cortada', 'salio cortado',
  'salio mal', 'salio fea', 'no salio nada', 'volve a imprimir', 'volves a imprimir'];
const esReimprimirTg = (t) => REIMP_TG.includes(limpiarResp(t));

// Botones tocables para confirmar/corregir el pedido (según su estado: envío sí/no)
function botonesConfirma(parsed) {
  const esEnvio = parsed && parsed.es_envio !== false;
  return {
    inline_keyboard: [
      [{ text: '✅ Confirmar e imprimir', callback_data: 'ok' }],
      [
        esEnvio ? { text: '🚫 Sin envío', callback_data: 'noenvio' } : { text: '🛵 Con envío', callback_data: 'sienvio' },
        { text: '🕒 Cambiar hora', callback_data: 'hora' },
      ],
      [{ text: '➕ Agregar / cambiar', callback_data: 'edit' }, { text: '❌ Cancelar', callback_data: 'no' }],
    ],
  };
}

// Convierte los items parseados por la IA en items reales (con precio/sector del menú)
function preparaItemsTg(parsed) {
  const items = [];
  for (const it of (parsed.items || [])) {
    const plato = db.prepare(
      'SELECT p.*, s.nombre sector FROM plato p LEFT JOIN sector_cocina s ON s.id=p.sector_id WHERE p.id=?'
    ).get(it.plato_id);
    // Precio: el que indicó la persona en el mensaje si vino; si no, el del sistema
    const precioManual = Number(it.precio_unit);
    const precioManualOk = Number.isFinite(precioManual) && precioManual > 0;
    if (!plato) {
      // RED DE SEGURIDAD: la IA eligió un plato que no existe (ID inválido). NO perdemos el ítem:
      // lo mandamos igual a la cocina como "fuera de carta" usando el nombre que devolvió la IA.
      const nombre = (it.nombre || '').trim();
      if (!nombre) continue; // sin nombre no hay nada que anotar
      items.push({
        plato_id: null, nombre, cantidad: clampCant(it.cantidad),
        precio_unit: precioManualOk ? Math.round(precioManual) : 0,
        observacion: it.observacion || null, sector_id: null, sector_nombre: null, fuera_carta: true,
      });
      continue;
    }
    items.push({
      plato_id: plato.id, nombre: plato.nombre, cantidad: clampCant(it.cantidad),
      precio_unit: precioManualOk ? Math.round(precioManual) : plato.precio, observacion: it.observacion || null,
      sector_id: plato.sector_id, sector_nombre: plato.sector,
    });
  }
  // Ítems FUERA DE CARTA: van igual a la comanda (plato_id null), con el precio que se haya dicho (o 0 = se pone en caja)
  for (const it of (parsed.items_libres || [])) {
    const nombre = (it.nombre || '').trim();
    if (!nombre) continue;
    const precioManual = Number(it.precio_unit);
    items.push({
      plato_id: null, nombre, cantidad: clampCant(it.cantidad),
      precio_unit: (Number.isFinite(precioManual) && precioManual > 0) ? Math.round(precioManual) : 0,
      observacion: null, sector_id: null, sector_nombre: null, fuera_carta: true,
    });
  }
  return items;
}

// Texto resumen del pedido (para confirmar y para el aviso final)
function resumenPedidoTg(parsed, items, mozo, envio) {
  const lineas = items.map((i) => {
    const libre = !i.plato_id; // ítem fuera de carta
    const precioTxt = (libre && !i.precio_unit) ? '  — ⚠ sin precio' : '';
    const marca = libre ? ' 📝' : '';
    return `• ${i.cantidad}x ${i.nombre}${marca}${i.observacion ? ' (' + i.observacion + ')' : ''}${precioTxt}`;
  });
  if (envio > 0) lineas.push(`• Envío: ${moneyTxt(envio)}`);
  const total = items.reduce((a, i) => a + i.cantidad * i.precio_unit, 0) + (envio > 0 ? envio : 0);
  const extra = [
    'Cliente: ' + (parsed.cliente_nombre || '—'),
    'Dirección: ' + (parsed.direccion || '⚠ falta'),
    'Hora de entrega: ' + (parsed.hora_entrega || '⚠ falta'),
    parsed.telefono && 'Tel: ' + parsed.telefono,
    mozo && 'Lo pasó: ' + mozo,
  ].filter(Boolean).join('\n');
  const avisos = [];
  const libres = items.filter((i) => !i.plato_id);
  if (libres.length) avisos.push(`📝 Fuera de carta (van igual a la cocina): ${libres.map((i) => i.nombre).join(', ')}.`);
  const sinPrecio = libres.filter((i) => !i.precio_unit);
  if (sinPrecio.length) avisos.push(`💲 Sin precio: ${sinPrecio.map((i) => i.nombre).join(', ')}. Si querés, decímelo (ej. "la tarta 8000") antes de confirmar.`);
  const noRec = (parsed.no_reconocidos || []).filter(Boolean);
  if (noRec.length) avisos.push(`⚠️ No entendí: ${noRec.join(', ')}.`);
  const falta = [!parsed.direccion && 'dirección', !parsed.hora_entrega && 'hora de entrega'].filter(Boolean);
  if (falta.length) avisos.push(`⚠️ No indicaste ${falta.join(' ni ')}.`);
  return { texto: `${extra}\n\n${lineas.join('\n')}\n\nTOTAL: ${moneyTxt(total)}`, avisos };
}

// Describe en texto el pedido pendiente (para que la IA aplique un cambio sobre él)
function describirPedidoTg(pend) {
  const L = pend.items.map((i) => `- ${i.cantidad} ${i.nombre}${i.observacion ? ' (' + i.observacion + ')' : ''}`);
  const p = pend.parsed || {};
  if (p.cliente_nombre) L.push(`Cliente: ${p.cliente_nombre}`);
  if (p.direccion) L.push(`Dirección: ${p.direccion}`);
  if (p.hora_entrega) L.push(`Hora: ${p.hora_entrega}`);
  if (p.telefono) L.push(`Teléfono: ${p.telefono}`);
  return L.join('\n');
}

// Autorizados: cada entrada puede ser "id" o "id: Nombre". Devuelve Map id -> nombre ('' si no tiene).
function autorizadosTg(cfg) {
  const map = new Map();
  for (const raw of (cfg.autorizados || [])) {
    const s = String(raw).trim();
    if (!s) continue;
    const i = s.indexOf(':');
    if (i >= 0) map.set(s.slice(0, i).trim(), s.slice(i + 1).trim());
    else map.set(s, '');
  }
  return map;
}

// Crea el pedido, lo manda a cocina, imprime y avisa por Telegram (con el resultado REAL de la impresión)
// `mozo` = quién pasó la comanda (nombre configurado o nombre de Telegram de la persona)
async function crearEImprimirTg(chatId, mozo, parsed, items, cfg) {
  const r = db.prepare(
    `INSERT INTO pedido (tipo, mozo_nombre, cliente_nombre, cliente_telefono, cliente_direccion, hora_entrega, observacion, estado)
     VALUES ('delivery', ?, ?, ?, ?, ?, ?, 'en_cocina')`
  ).run(mozo || 'Telegram', parsed.cliente_nombre || null, parsed.telefono || null, parsed.direccion || null,
        parsed.hora_entrega || null, parsed.nota || null);
  const pedidoId = r.lastInsertRowid;
  const ins = db.prepare(
    `INSERT INTO pedido_item (pedido_id, plato_id, nombre, cantidad, precio_unit, observacion, sector_id, sector_nombre)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  for (const it of items) ins.run(pedidoId, it.plato_id, it.nombre, it.cantidad, it.precio_unit, it.observacion, it.sector_id, it.sector_nombre);
  // Descontar stock (bebidas/recetas)
  for (const it of items) consumirStockVenta(pedidoId, it.plato_id, it.cantidad);
  // Cobrar envío solo si es a domicilio (no si el cliente lo retira)
  const envio = (parsed.es_envio !== false) ? costoEnvioDefault() : 0;
  if (envio > 0) {
    db.prepare(
      `INSERT INTO pedido_item (pedido_id, plato_id, nombre, cantidad, precio_unit, sector_nombre, estado)
       VALUES (?, NULL, 'Envío', 1, ?, 'Delivery', 'entregado')`
    ).run(pedidoId, envio);
  }
  recalcTotal(pedidoId);
  const p = pedidoCompleto(pedidoId);
  io.emit('pedido:nuevo', p);
  for (const it of p.items) {
    if (it.estado === 'pendiente') io.emit('item:nuevo', { ...it, pedido: p });
  }
  emitDashboard();
  const aCocina = itemsComandaCocina(p.items, p.tipo); // delivery: lleva todo (incl. bebidas)
  // Esperamos el resultado REAL de la impresión para avisar la verdad al que mandó el pedido.
  let res = { ok: true, modo: 'sin-cocina' };
  if (aCocina.length) {
    try { res = await imprimirComandaUnica(p, aCocina); }
    catch (e) { console.error('Error impresión Telegram:', e.message); res = { ok: false, modo: 'error-impresion', error: e.message }; }
    if (!res || res.ok === false) io.emit('impresion:error', { pedido_id: pedidoId, resultado: res });
  }
  // Ticket aparte de bebidas para la barra (si está activado en Ajustes). No bloquea el aviso.
  const bebidas = bebidasDeItems(p.items);
  if (bebidas.length) imprimirBebidas(p, bebidas).catch((e) => console.error('Bebidas:', e.message));

  // Guardamos la última comanda de esta persona para poder REIMPRIMIRLA desde el celular.
  ultimaComandaTg.set(String(chatId), { pedidoId, ts: Date.now() });

  const { texto, avisos } = resumenPedidoTg(parsed, items, mozo, envio);
  const aviso = avisos.length ? '\n\n' + avisos.join('\n') : '';
  let cabecera, markup;
  if (!res || res.ok === false) {
    cabecera = `⚠️ Pedido #${pedidoId} CARGADO, pero la comanda *NO se imprimió*.\nRevisá la impresora (papel / encendida) y tocá el botón para reintentar 🖨.`;
    markup = { inline_keyboard: [[{ text: '🖨 Reintentar impresión', callback_data: 'reimprimir' }]] };
  } else if (res.modo === 'impreso') {
    cabecera = `🛵 *DELIVERY* — Comanda IMPRESA ✅ (Pedido #${pedidoId})`;
  } else {
    cabecera = `🛵 *DELIVERY* — Pedido #${pedidoId} cargado (no hay impresora configurada; quedó guardado en archivo).`;
  }
  tg.enviar(chatId, `${cabecera}\n${texto}${aviso}`, markup);
}

// Reimprime la última comanda que cargó esta persona (por si no salió o salió cortada).
async function reimprimirUltimaTg(chatId) {
  const u = ultimaComandaTg.get(String(chatId));
  if (!u) { tg.enviar(chatId, '🖨 No tengo ninguna comanda reciente tuya para reimprimir. Mandame el pedido de nuevo.'); return; }
  const p = pedidoCompleto(u.pedidoId);
  if (!p) { tg.enviar(chatId, `🖨 No encontré la comanda #${u.pedidoId} para reimprimir.`); return; }
  const aCocina = itemsComandaCocina(p.items, p.tipo);
  if (!aCocina.length) { tg.enviar(chatId, `🖨 La comanda #${u.pedidoId} no tiene nada para la cocina.`); return; }
  tg.enviarAccion(chatId, 'typing');
  let res;
  try { res = await imprimirComandaUnica(p, aCocina); }
  catch (e) { res = { ok: false, error: e.message }; }
  if (res && res.ok !== false) {
    tg.enviar(chatId, `🖨 Comanda #${u.pedidoId} REIMPRESA ✅`);
  } else {
    io.emit('impresion:error', { pedido_id: u.pedidoId, resultado: res });
    tg.enviar(chatId, `⚠️ No pude reimprimir la comanda #${u.pedidoId}. Revisá la impresora (papel / encendida).`,
      { inline_keyboard: [[{ text: '🖨 Reintentar', callback_data: 'reimprimir' }]] });
  }
}

tg.setHandlers({
  onMensaje: async ({ chatId, nombre, texto, imagen, audio }) => {
    const cfg = getConfig().telegram || {};
    const key = String(chatId);
    const autor = autorizadosTg(cfg);
    if (!autor.has(key)) {
      tg.enviar(chatId, `🔒 No estás autorizado para enviar pedidos.\nTu ID de Telegram es: ${chatId}\nPedile al administrador que lo agregue en Ajustes → Telegram.`);
      return;
    }
    // Quién pasa la comanda: nombre configurado para su ID, o su nombre de Telegram
    const mozo = (autor.get(key) || '').trim() || nombre || 'Telegram';

    // NOTA DE VOZ -> la transcribimos a texto (si hay clave de voz configurada) y seguimos igual
    if (audio) {
      if (!cfg.claveVoz) {
        tg.enviar(chatId, '🎤 Por ahora no puedo escuchar audios. Mandámelo por texto, o sacale una FOTO al pedido 📷.');
        return;
      }
      tg.enviarAccion(chatId, 'typing');
      try {
        const t = await transcribirAudio(audio.base64, audio.mime, cfg.claveVoz);
        if (!t) { tg.enviar(chatId, '🎤 No entendí el audio. Probá de nuevo (más claro) o mandámelo por texto.'); return; }
        texto = t;
        tg.enviar(chatId, `🎤 Entendí: "${t}"`);
      } catch (e) {
        tg.enviar(chatId, '🎤 No pude procesar el audio: ' + e.message + '\nMandámelo por texto o foto.');
        return;
      }
    }

    // REIMPRIMIR la última comanda (si no salió / salió cortada), desde cualquier momento.
    if (esReimprimirTg(texto)) { await reimprimirUltimaTg(chatId); return; }

    // Modo confirmación: si hay un pedido esperando SÍ/NO, resolverlo primero
    let pend = pendientesTg.get(key);
    if (pend && Date.now() - pend.ts > 10 * 60000) { pendientesTg.delete(key); pend = undefined; } // venció
    if (pend) {
      if (esSiTg(texto)) {
        pendientesTg.delete(key);
        crearEImprimirTg(chatId, pend.nombre, pend.parsed, pend.items, getConfig().telegram || {})
          .catch((e) => { console.error('crearEImprimirTg:', e.message); tg.enviar(chatId, '❌ Hubo un error al cargar el pedido: ' + e.message); });
      } else if (esNoTg(texto)) {
        pendientesTg.delete(key);
        tg.enviar(chatId, '❌ Pedido cancelado. Mandame el pedido corregido cuando quieras.');
      } else {
        // No es SÍ/NO: lo tomamos como un CAMBIO sobre el pedido pendiente
        tg.enviar(chatId, '✏️ Aplicando el cambio...');
        try {
          const platos = db.prepare(
            `SELECT p.id, p.nombre, p.precio, p.alias_ia, COALESCE(c.guarnicion,0) guarnicion
             FROM plato p LEFT JOIN categoria c ON c.id=p.categoria_id WHERE p.activo=1 AND p.disponible=1`
          ).all();
          const horaActual = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
          const mensajeCambio = `PEDIDO ACTUAL:\n${describirPedidoTg(pend)}\n\nCAMBIO PEDIDO POR EL CLIENTE: ${texto}`;
          const nuevoParsed = await parsearPedidoIA(mensajeCambio, platos, cfg.claveIA, cfg.modeloIA, horaActual, cfg.guarnicionDefault || 'papas fritas', imagen);
          const nuevoItems = preparaItemsTg(nuevoParsed);
          if (!nuevoItems.length) {
            tg.enviar(chatId, '❌ No entendí el cambio (el pedido quedaría vacío). Sigue igual.\nRespondé *SÍ*/*NO* o decime el cambio de otra forma.');
            return;
          }
          const envio2 = (nuevoParsed.es_envio !== false) ? costoEnvioDefault() : 0;
          const { texto: resumen2, avisos: avisos2 } = resumenPedidoTg(nuevoParsed, nuevoItems, pend.nombre, envio2);
          const aviso2 = avisos2.length ? '\n\n' + avisos2.join('\n') : '';
          pendientesTg.set(key, { parsed: nuevoParsed, items: nuevoItems, nombre: pend.nombre, ts: Date.now() });
          tg.enviar(chatId, `📝 Pedido actualizado:\n${resumen2}${aviso2}\n\n👇 Tocá un botón (o escribí SÍ / NO).`, botonesConfirma(nuevoParsed));
        } catch (e) {
          tg.enviar(chatId, '❌ No pude aplicar el cambio: ' + e.message + '\nEl pedido sigue igual. Respondé *SÍ*/*NO*.');
        }
      }
      return;
    }

    // Anti-doble-pedido (para pedidos nuevos)
    const ahoraTg = Date.now();
    if (ahoraTg - (ultimoPedidoTg.get(key) || 0) < 8000) {
      tg.enviar(chatId, '⏳ Esperá unos segundos antes de mandar otro pedido.');
      return;
    }
    ultimoPedidoTg.set(key, ahoraTg);
    tg.enviarAccion(chatId, 'typing'); // muestra "escribiendo..." en vez de un mensaje de más
    let parsed;
    try {
      const platos = db.prepare(
        `SELECT p.id, p.nombre, p.precio, p.alias_ia, COALESCE(c.guarnicion,0) guarnicion
         FROM plato p LEFT JOIN categoria c ON c.id=p.categoria_id WHERE p.activo=1 AND p.disponible=1`
      ).all();
      const horaActual = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
      parsed = await parsearPedidoIA(texto, platos, cfg.claveIA, cfg.modeloIA, horaActual, cfg.guarnicionDefault || 'papas fritas', imagen);
    } catch (e) {
      tg.enviar(chatId, '❌ No pude interpretar el pedido: ' + e.message);
      return;
    }
    const items = preparaItemsTg(parsed);
    const noRec = (parsed.no_reconocidos || []).filter(Boolean);
    if (!items.length) {
      const detalle = noRec.length ? `\nNo encontré en la carta: ${noRec.join(', ')}.` : '';
      tg.enviar(chatId, `❌ No reconocí ningún plato del menú en tu mensaje.${detalle}\nFijate que los nombres coincidan con la carta y reenvialo.`);
      return;
    }

    // Modo confirmación activado: mostrar el pedido y esperar SÍ/NO
    if (cfg.confirmar) {
      const envio = (parsed.es_envio !== false) ? costoEnvioDefault() : 0;
      const { texto: resumen, avisos } = resumenPedidoTg(parsed, items, mozo, envio);
      const aviso = avisos.length ? '\n\n' + avisos.join('\n') : '';
      pendientesTg.set(key, { parsed, items, nombre: mozo, ts: ahoraTg });
      tg.enviar(chatId, `📝 Revisá el pedido:\n${resumen}${aviso}\n\n👇 Tocá un botón (o escribí SÍ / NO).`, botonesConfirma(parsed));
      return;
    }

    // Modo directo: imprime al toque
    crearEImprimirTg(chatId, mozo, parsed, items, cfg)
      .catch((e) => { console.error('crearEImprimirTg:', e.message); tg.enviar(chatId, '❌ Hubo un error al cargar el pedido: ' + e.message); });
  },

  // El usuario tocó uno de los botones (✅ Confirmar / ✏️ Cambiar / ❌ Cancelar)
  onCallback: async ({ chatId, nombre, data, messageId }) => {
    const cfg = getConfig().telegram || {};
    const key = String(chatId);
    const autor = autorizadosTg(cfg);
    if (!autor.has(key)) return;
    // El botón "Reintentar impresión" no depende de que haya un pedido pendiente.
    if (data === 'reimprimir') { await reimprimirUltimaTg(chatId); return; }
    let pend = pendientesTg.get(key);
    if (pend && Date.now() - pend.ts > 10 * 60000) { pendientesTg.delete(key); pend = undefined; } // venció
    if (!pend) {
      if (messageId) tg.editar(chatId, messageId, '⏳ Ese pedido ya no está pendiente. Mandámelo de nuevo cuando quieras.');
      return;
    }
    if (data === 'ok') {
      pendientesTg.delete(key);
      if (messageId) tg.editar(chatId, messageId, '✅ Confirmado. Imprimiendo la comanda...');
      crearEImprimirTg(chatId, pend.nombre, pend.parsed, pend.items, getConfig().telegram || {})
        .catch((e) => { console.error('crearEImprimirTg:', e.message); tg.enviar(chatId, '❌ Hubo un error al cargar el pedido: ' + e.message); });
    } else if (data === 'no') {
      pendientesTg.delete(key);
      if (messageId) tg.editar(chatId, messageId, '❌ Pedido cancelado. Mandame el pedido corregido cuando quieras.');
    } else if (data === 'edit') {
      pendientesTg.set(key, { ...pend, ts: Date.now() }); // reiniciar el reloj mientras escribe el cambio
      if (messageId) tg.editar(chatId, messageId, '✏️ Dale, decime el cambio.');
      tg.enviar(chatId, 'Decime qué cambiar (ej. "agregá una coca", "sacá la pizza", "cambiá la dirección a Rivadavia 100"). Después te muestro el pedido actualizado.');
    } else if (data === 'hora') {
      pendientesTg.set(key, { ...pend, ts: Date.now() }); // reiniciar el reloj mientras escribe la hora
      if (messageId) tg.editar(chatId, messageId, '🕒 Decime la hora de entrega (ej. "21:30" o "en 40 minutos").');
    } else if (data === 'noenvio' || data === 'sienvio') {
      // Toggle de envío en un toque: recalcula el total y refresca el mismo mensaje
      pend.parsed.es_envio = (data === 'sienvio');
      pendientesTg.set(key, { ...pend, ts: Date.now() });
      const envio = (pend.parsed.es_envio !== false) ? costoEnvioDefault() : 0;
      const { texto: resumen, avisos } = resumenPedidoTg(pend.parsed, pend.items, pend.nombre, envio);
      const aviso = avisos.length ? '\n\n' + avisos.join('\n') : '';
      const nuevoTexto = `📝 Revisá el pedido:\n${resumen}${aviso}\n\n👇 Tocá un botón (o escribí SÍ / NO).`;
      if (messageId) tg.editar(chatId, messageId, nuevoTexto, botonesConfirma(pend.parsed));
      else tg.enviar(chatId, nuevoTexto, botonesConfirma(pend.parsed));
    }
  },
});

app.get('/api/telegram/estado', (req, res) => res.json(tg.getEstado()));
app.post('/api/telegram/conectar', async (req, res) => { const cfg = getConfig().telegram || {}; res.json(await tg.iniciar(cfg.token)); });
app.post('/api/telegram/desconectar', (req, res) => { tg.detener(); res.json({ ok: true }); });

// ================= KDS (cocina) =================
app.get('/api/kds', (req, res) => {
  const { sector } = req.query;
  let sql = `SELECT i.*, p.mesa_id, p.tipo, p.mozo_nombre, p.hora_entrega, p.cliente_nombre, p.cliente_direccion, m.numero mesa_numero
             FROM pedido_item i
             JOIN pedido p ON p.id=i.pedido_id
             LEFT JOIN mesa m ON m.id=p.mesa_id
             WHERE i.estado IN ('pendiente','en_preparacion')`;
  const args = [];
  if (sector && sector !== 'Todos') { sql += ' AND i.sector_nombre=?'; args.push(sector); }
  sql += ' ORDER BY i.enviado_en ASC';
  res.json(db.prepare(sql).all(...args));
});

// ================= DASHBOARD =================
function dashboardData() {
  const hoy = "date('now','localtime')";
  const ventas = db.prepare(
    `SELECT COALESCE(SUM(importe),0) total, COUNT(DISTINCT pedido_id) tickets
     FROM pago WHERE date(fecha)=${hoy}`
  ).get();
  const mesasOcupadas = db.prepare("SELECT COUNT(*) c FROM mesa WHERE estado='ocupada'").get().c;
  const mesasTotal = db.prepare('SELECT COUNT(*) c FROM mesa').get().c;
  const enCocina = db.prepare(
    "SELECT COUNT(*) c FROM pedido_item WHERE estado IN ('pendiente','en_preparacion')"
  ).get().c;
  const pedidosAbiertos = db.prepare(
    "SELECT COUNT(*) c FROM pedido WHERE estado IN ('abierto','en_cocina','servido')"
  ).get().c;
  const topPlatos = db.prepare(
    `SELECT i.nombre, SUM(i.cantidad) cant
     FROM pedido_item i JOIN pedido p ON p.id=i.pedido_id
     WHERE date(p.abierto_en)=${hoy} AND i.estado<>'anulado'
     GROUP BY i.nombre ORDER BY cant DESC LIMIT 8`
  ).all();
  const porSector = db.prepare(
    `SELECT sector_nombre sector, COUNT(*) c FROM pedido_item
     WHERE estado IN ('pendiente','en_preparacion') GROUP BY sector_nombre`
  ).all();
  const ticketProm = ventas.tickets ? ventas.total / ventas.tickets : 0;
  const faltantes = insumosFaltantes();
  // Próximas entregas de delivery (abiertas, con hora), ordenadas por hora
  const entregas = db.prepare(
    `SELECT id, cliente_nombre, cliente_direccion, hora_entrega, total
     FROM pedido WHERE tipo='delivery' AND estado <> 'anulado' AND entregado_en IS NULL
     ORDER BY (hora_entrega IS NULL), hora_entrega LIMIT 12`
  ).all();
  // Deuda total de fiado (cuentas con saldo a favor del local)
  const deudaFiado = db.prepare(
    `SELECT COALESCE(SUM(s),0) total FROM (
       SELECT SUM(CASE WHEN tipo='cargo' THEN importe ELSE -importe END) s
       FROM cuenta_mov GROUP BY cuenta_id HAVING s > 0)`
  ).get().total;
  // Comandas demoradas: ítems pendientes/en preparación hace más de 15 min
  const demoradas = db.prepare(
    `SELECT COUNT(*) c FROM pedido_item
     WHERE estado IN ('pendiente','en_preparacion')
       AND (julianday('now','localtime') - julianday(enviado_en)) * 24 * 60 > 15`
  ).get().c;
  // Ventas de hoy por medio de pago
  const ventasMedio = db.prepare(
    `SELECT medio, COALESCE(SUM(importe),0) total FROM pago WHERE date(fecha)=${hoy} GROUP BY medio ORDER BY total DESC`
  ).all();
  // Aviso "cerrá la caja": horas desde la PRIMERA venta sin cerrar (null si no hay ventas pendientes de cierre)
  const sinCerrar = db.prepare(
    `SELECT (julianday('now','localtime') - julianday(MIN(fecha))) * 24 AS horas, COUNT(*) n
     FROM pago WHERE fecha > ?`
  ).get(inicioPeriodoCaja());
  const horasSinCierre = sinCerrar.n > 0 ? Math.round(sinCerrar.horas * 10) / 10 : null;
  const avisarCajaHoras = Math.max(0, Math.round(Number((getConfig().caja || {}).avisarHoras) || 0));
  const turnoSinCerrar = avisoTurnoSinCerrar();
  return {
    ventasHoy: ventas.total,
    tickets: ventas.tickets,
    ticketPromedio: ticketProm,
    mesasOcupadas,
    mesasTotal,
    enCocina,
    pedidosAbiertos,
    topPlatos,
    porSector,
    faltantes: faltantes.map((f) => ({ nombre: f.nombre, stock: f.stock, unidad: f.unidad })),
    entregas,
    deudaFiado,
    demoradas,
    ventasMedio,
    horasSinCierre,
    avisarCajaHoras,
    turnoSinCerrar,
    ts: new Date().toISOString(),
  };
}

// Detecta si la caja del SALÓN abierta mezcla dos turnos (mediodía y noche): si la primera venta
// de salón sin cerrar es de un turno distinto al actual, hay un cierre pendiente del turno anterior.
function avisoTurnoSinCerrar() {
  const desde = inicioPeriodoCaja();
  const corte = (getConfig().caja || {}).corteNoche || '17:00';
  const first = db.prepare(
    `SELECT MIN(pg.fecha) f FROM pago pg JOIN pedido o ON o.id=pg.pedido_id
     WHERE pg.fecha > ? AND o.tipo NOT IN ('vianda','delivery')`
  ).get(desde).f;
  if (!first) return null; // no hay ventas de salón en el período abierto
  const nowTs = db.prepare("SELECT datetime('now','localtime') t").get().t;
  const turno = (ts) => ({ dia: ts.slice(0, 10), parte: (ts.slice(11, 16) < corte ? 'mediodia' : 'noche') });
  const a = turno(first), b = turno(nowTs);
  if (a.dia === b.dia && a.parte === b.parte) return null; // mismo turno, todo bien
  return a.parte === 'mediodia'
    ? '⚠ Tenés el mediodía sin cerrar — cerrá la caja antes de arrancar la noche.'
    : '⚠ Tenés la noche sin cerrar — cerrá la caja antes de arrancar el mediodía.';
}

app.get('/api/dashboard', (req, res) => res.json(dashboardData()));

// ================= ASISTENTE DE REPORTES (chat en lenguaje natural sobre las ventas) =================
// Herramientas que la IA puede pedir para traer datos reales de la base (todas de solo lectura).
const HERR_ASISTENTE = [
  { name: 'ventas_totales', description: 'Total vendido, tickets, y desglose por forma de pago y por tipo de pedido, en un rango de fechas.',
    input_schema: { type: 'object', properties: { desde: { type: 'string', description: 'YYYY-MM-DD (por defecto hoy)' }, hasta: { type: 'string', description: 'YYYY-MM-DD (por defecto hoy)' } } } },
  { name: 'ventas_por_dia', description: 'Total vendido y tickets por cada día del rango.',
    input_schema: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' } } } },
  { name: 'productos_mas_vendidos', description: 'Ranking de productos por cantidad vendida en el rango.',
    input_schema: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' }, limite: { type: 'integer' }, orden: { type: 'string', description: '"mas" (por defecto) o "menos"' } } } },
  { name: 'ventas_de_producto', description: 'Cantidad y monto vendido de un producto puntual (búsqueda por nombre) en el rango.',
    input_schema: { type: 'object', properties: { nombre: { type: 'string' }, desde: { type: 'string' }, hasta: { type: 'string' } }, required: ['nombre'] } },
  { name: 'ventas_por_modulo', description: 'Total por módulo (Salón mediodía, Viandas, Delivery mediodía, Salón noche, Delivery noche) en el rango. Cuenta por fecha del pedido; delivery separado por la hora de corte.',
    input_schema: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' } } } },
  { name: 'ventas_por_hora', description: 'Total vendido y tickets por hora del día (para saber el horario pico) en el rango.',
    input_schema: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' } } } },
  { name: 'ventas_por_mozo', description: 'Total vendido, tickets y propinas por cada mozo en el rango.',
    input_schema: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' } } } },
  { name: 'viandas', description: 'Resumen de viandas: total, pedidos y ranking de menús en el rango.',
    input_schema: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' } } } },
  { name: 'deudas_fiado', description: 'Cuentas corrientes (empresas/personas) que deben plata, con su saldo.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'consultar_datos', description: 'Ejecuta una consulta SQL de SOLO LECTURA (SELECT/WITH) sobre la base, para responder CUALQUIER pregunta que las otras herramientas no cubran (promedios, filtros combinados, fiados por módulo/fecha, cafés, etc.). Devuelve las filas. Escribí SQLite válido usando el ESQUEMA del prompt e incluí un LIMIT.',
    input_schema: { type: 'object', properties: { sql: { type: 'string', description: 'Una única sentencia SELECT (o WITH ... SELECT), SQLite. Ej: SELECT ... FROM pago WHERE ... LIMIT 100' } }, required: ['sql'] } },
];

function ejecutarHerramientaAsistente(name, input = {}) {
  const hoy = db.prepare("SELECT date('now','localtime') d").get().d;
  const d = input.desde || hoy, h = input.hasta || hoy;
  if (name === 'ventas_totales') {
    const tot = db.prepare('SELECT COALESCE(SUM(importe),0) total, COUNT(DISTINCT pedido_id) tickets FROM pago WHERE date(fecha) BETWEEN ? AND ?').get(d, h);
    const porMedio = db.prepare('SELECT medio, SUM(importe) total, COUNT(*) n FROM pago WHERE date(fecha) BETWEEN ? AND ? GROUP BY medio ORDER BY total DESC').all(d, h);
    const porTipo = db.prepare("SELECT o.tipo, SUM(pg.importe) total, COUNT(DISTINCT pg.pedido_id) tickets FROM pago pg JOIN pedido o ON o.id=pg.pedido_id WHERE date(pg.fecha) BETWEEN ? AND ? GROUP BY o.tipo ORDER BY total DESC").all(d, h);
    const extra = db.prepare("SELECT COALESCE(SUM(propina),0) propinas, COALESCE(SUM(descuento),0) descuentos FROM pedido WHERE estado='cobrado' AND date(cerrado_en) BETWEEN ? AND ?").get(d, h);
    const ticketPromedio = tot.tickets ? Math.round(tot.total / tot.tickets) : 0;
    return { desde: d, hasta: h, total: tot.total, tickets: tot.tickets, ticketPromedio, propinas: extra.propinas, descuentos: extra.descuentos, porMedio, porTipo };
  }
  if (name === 'ventas_por_hora') {
    const horas = db.prepare("SELECT strftime('%H',fecha) hora, SUM(importe) total, COUNT(DISTINCT pedido_id) tickets FROM pago WHERE date(fecha) BETWEEN ? AND ? GROUP BY hora ORDER BY total DESC").all(d, h);
    return { desde: d, hasta: h, porHora: horas };
  }
  if (name === 'ventas_por_mozo') {
    const mozos = db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(o.mozo_nombre),''),'(sin mozo)') mozo, SUM(pg.importe) total, COUNT(DISTINCT pg.pedido_id) tickets
       FROM pago pg JOIN pedido o ON o.id=pg.pedido_id WHERE date(pg.fecha) BETWEEN ? AND ? GROUP BY mozo ORDER BY total DESC`
    ).all(d, h);
    const propinas = db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(mozo_nombre),''),'(sin mozo)') mozo, COALESCE(SUM(propina),0) propinas
       FROM pedido WHERE estado='cobrado' AND propina>0 AND date(cerrado_en) BETWEEN ? AND ? GROUP BY mozo`
    ).all(d, h);
    const mapProp = Object.fromEntries(propinas.map((p) => [p.mozo, p.propinas]));
    return { desde: d, hasta: h, mozos: mozos.map((m) => ({ ...m, propinas: mapProp[m.mozo] || 0 })) };
  }
  if (name === 'ventas_por_dia') {
    return { desde: d, hasta: h, dias: db.prepare('SELECT date(fecha) dia, SUM(importe) total, COUNT(DISTINCT pedido_id) tickets FROM pago WHERE date(fecha) BETWEEN ? AND ? GROUP BY dia ORDER BY dia').all(d, h) };
  }
  if (name === 'productos_mas_vendidos') {
    const limite = Math.min(50, Math.max(1, Number(input.limite) || 10));
    const orden = input.orden === 'menos' ? 'ASC' : 'DESC';
    const productos = db.prepare(
      `SELECT i.nombre, SUM(i.cantidad) cantidad, COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
       WHERE o.estado='cobrado' AND date(o.cerrado_en) BETWEEN ? AND ? AND i.estado<>'anulado' AND i.plato_id IS NOT NULL
       GROUP BY i.nombre ORDER BY cantidad ${orden} LIMIT ?`
    ).all(d, h, limite);
    return { desde: d, hasta: h, productos };
  }
  if (name === 'ventas_de_producto') {
    const q = '%' + String(input.nombre || '').trim() + '%';
    const row = db.prepare(
      `SELECT COALESCE(SUM(i.cantidad),0) cantidad, COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
       WHERE o.estado='cobrado' AND date(o.cerrado_en) BETWEEN ? AND ? AND i.estado<>'anulado' AND i.nombre LIKE ?`
    ).get(d, h, q);
    return { desde: d, hasta: h, producto: input.nombre, cantidad: row.cantidad, total: row.total };
  }
  if (name === 'ventas_por_modulo') {
    const corte = (getConfig().caja || {}).corteNoche || '17:00';
    const MOD = `CASE WHEN o.tipo='vianda' THEN 'Viandas' WHEN o.tipo='delivery' AND time(o.abierto_en) < ? THEN 'Delivery mediodia' WHEN o.tipo='delivery' THEN 'Delivery noche' WHEN time(o.abierto_en) < ? THEN 'Salon mediodia' ELSE 'Salon noche' END`;
    const modulos = db.prepare(
      `SELECT ${MOD} modulo, SUM(pg.importe) total, COUNT(DISTINCT pg.pedido_id) tickets
       FROM pago pg JOIN pedido o ON o.id=pg.pedido_id WHERE date(o.abierto_en) BETWEEN ? AND ? GROUP BY modulo ORDER BY total DESC`
    ).all(corte, corte, d, h);
    return { desde: d, hasta: h, modulos };
  }
  if (name === 'viandas') {
    const porMenu = db.prepare(
      `SELECT md.nombre, SUM(i.cantidad) cantidad, COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id JOIN menu_dia md ON md.id=i.menu_dia_id
       WHERE o.estado='cobrado' AND date(o.cerrado_en) BETWEEN ? AND ? AND i.estado<>'anulado' GROUP BY md.nombre ORDER BY cantidad DESC`
    ).all(d, h);
    const tot = db.prepare("SELECT COALESCE(SUM(total),0) total, COUNT(*) pedidos FROM pedido WHERE tipo='vianda' AND estado='cobrado' AND date(cerrado_en) BETWEEN ? AND ?").get(d, h);
    return { desde: d, hasta: h, total: tot.total, pedidos: tot.pedidos, porMenu };
  }
  if (name === 'deudas_fiado') {
    const deudores = db.prepare(
      `SELECT c.nombre, COALESCE(SUM(CASE WHEN m.tipo='cargo' THEN m.importe ELSE -m.importe END),0) saldo
       FROM cuenta c LEFT JOIN cuenta_mov m ON m.cuenta_id=c.id WHERE c.activo=1
       GROUP BY c.id HAVING saldo > 0 ORDER BY saldo DESC`
    ).all();
    return { deudores, totalPorCobrar: deudores.reduce((a, x) => a + x.saldo, 0) };
  }
  if (name === 'consultar_datos') {
    const sql = String(input.sql || '').trim();
    if (!/^\s*(select|with)\b/i.test(sql)) return { error: 'Solo se permiten consultas SELECT o WITH.' };
    if (/;\s*\S/.test(sql)) return { error: 'Escribí una sola sentencia (sin ";" en el medio).' };
    if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|reindex|vacuum|pragma)\b/i.test(sql)) return { error: 'Consulta no permitida (solo lectura).' };
    try {
      const stmt = db.prepare(sql);
      if (!stmt.reader) return { error: 'La consulta no devuelve datos.' };
      const rows = stmt.all();
      return { filas: rows.slice(0, 200), total_filas: rows.length };
    } catch (e) { return { error: 'Error en la consulta: ' + e.message }; }
  }
  return { error: 'herramienta desconocida' };
}

app.post('/api/asistente', async (req, res) => {
  const pregunta = String(req.body.pregunta || '').trim();
  if (!pregunta) return res.status(400).json({ error: 'Falta la pregunta' });
  const claveIA = (getConfig().telegram || {}).claveIA;
  if (!claveIA) return res.status(400).json({ error: 'Falta la clave de IA (Ajustes → Telegram)' });
  const hoy = db.prepare("SELECT date('now','localtime') d").get().d;
  const system = `Sos el asistente de reportes de un restaurante argentino ("Sede Social"). Respondés preguntas del DUEÑO sobre sus ventas.
HOY es ${hoy} (formato YYYY-MM-DD). Interpretá "hoy", "ayer", "esta semana" (últimos 7 días), "este mes", etc.
SIEMPRE usá las herramientas para traer datos reales ANTES de responder; nunca inventes números.
Para preguntas comunes usá las herramientas específicas. Para CUALQUIER otra cosa que no cubran (promedios por día, filtros combinados, fiados por módulo/fecha, cafés, comparaciones, etc.) usá "consultar_datos" con una consulta SQL de SOLO LECTURA sobre este ESQUEMA (SQLite):

- pedido(id, tipo, estado, abierto_en, cerrado_en, total, propina, descuento, mozo_nombre, cliente_nombre, cliente_telefono, entrega, fijo_id). tipo ∈ 'salon','mostrador','cafeteria','delivery','vianda'. Una VENTA es estado='cobrado'. abierto_en = cuándo se tomó, cerrado_en = cuándo se cobró.
- pedido_item(id, pedido_id, plato_id, menu_dia_id, nombre, cantidad, precio_unit, observacion, estado). Ítem vendido: estado<>'anulado' y el pedido cobrado.
- pago(id, pedido_id, medio, importe, fecha). fecha = cuándo se cobró. medio: 'EFECTIVO','QR / TRANSFERENCIA','TARJETA DÉBITO','TARJETA CRÉDITO','FIADO'.
- plato(id, nombre, categoria_id, precio); categoria(id, nombre, cafeteria). Los CAFÉS/cafetería son platos cuya categoría tiene cafeteria=1.
- cuenta(id, nombre, activo); cuenta_mov(id, cuenta_id, tipo, importe, pedido_id, medio, fecha). tipo='cargo' = fiado nuevo (deuda), tipo='pago' = pagó su cuenta. El pedido_id te permite unir el cargo al pedido (y ver su tipo/módulo).
- menu_dia(id, fecha, opcion, nombre, precio); un ítem de vianda tiene menu_dia_id no nulo.
- Fechas locales: usá date(columna), time(columna), strftime('%H',columna), strftime('%w',columna) (0=Dom..6=Sáb).
- PROMEDIO por día = total / cantidad de días (COUNT(DISTINCT date(...))). Incluí siempre un LIMIT.

Respondé CORTO y CLARO en español rioplatense, con montos en pesos con separador de miles (ej. $12.500).
FORMATO: TEXTO PLANO simple, SIN markdown (no tablas, no ** negrita **, no #). Para listar usá guiones o saltos de línea. Emojis con moderación.
Si la pregunta no es sobre el negocio, decilo amablemente. Si no hay datos, aclaralo.`;
  const messages = [{ role: 'user', content: pregunta }];
  try {
    for (let paso = 0; paso < 8; paso++) {
      const data = await claudeConTools({ system, messages, tools: HERR_ASISTENTE, apiKey: claveIA, modelo: 'claude-sonnet-4-6', maxTokens: 1024 });
      messages.push({ role: 'assistant', content: data.content });
      const toolUses = (data.content || []).filter((b) => b.type === 'tool_use');
      if (!toolUses.length) {
        const txt = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        return res.json({ respuesta: txt || '(sin respuesta)' });
      }
      const results = toolUses.map((tu) => {
        let out; try { out = ejecutarHerramientaAsistente(tu.name, tu.input || {}); } catch (e) { out = { error: e.message }; }
        return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) };
      });
      messages.push({ role: 'user', content: results });
    }
    res.json({ respuesta: 'No pude terminar de responder. Probá una pregunta más específica.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Estadísticas históricas (placeholder hasta migración Fase 0)
app.get('/api/stats/top-historico', (req, res) =>
  res.json(
    db.prepare(
      'SELECT nombre, ventas_historicas FROM plato ORDER BY ventas_historicas DESC LIMIT 20'
    ).all()
  )
);

// Módulo de Reportes (histórico/analítico): registra /api/reportes/*
registrarReportes(app);
// Módulo de Stock / Inventario: registra /api/insumos y /api/stock
registrarStock(app);

// Monitor de la impresora: si quedan comandas en la cola sin salir (papel/offline), avisar.
let colaPrev = 0;
let ultimoAvisoCola = 0;
setInterval(async () => {
  try {
    const { count } = await colaImpresora();
    if (count > 0 && colaPrev > 0) { // trancada 2 chequeos seguidos (~90s)
      const ahora = Date.now();
      if (ahora - ultimoAvisoCola > 10 * 60 * 1000) {
        ultimoAvisoCola = ahora;
        io.emit('impresion:trancada', { count });
        const cfg = getConfig().telegram || {};
        if (cfg.habilitado) {
          for (const chatId of autorizadosTg(cfg).keys()) tg.enviar(chatId, `⚠️ La impresora tiene ${count} comanda(s) trancada(s) sin salir. Revisá el papel o si está encendida.`);
        }
      }
    }
    colaPrev = count > 0 ? count : 0;
  } catch { /* ignorar */ }
}, 45000);

// Aviso por Telegram cuando un insumo cruza por debajo del mínimo (1 vez cada 6 hs por insumo)
const ultimaAlertaStock = new Map();
setAlertaStock((insumo) => {
  const cfg = getConfig().telegram || {};
  const autorizados = cfg.autorizados || [];
  if (!cfg.habilitado || !autorizados.length) return;
  const ahora = Date.now();
  if (ahora - (ultimaAlertaStock.get(insumo.id) || 0) < 6 * 3600 * 1000) return;
  ultimaAlertaStock.set(insumo.id, ahora);
  const msg = `⚠️ STOCK BAJO\n${insumo.nombre}: quedan ${insumo.stock} ${insumo.unidad} (mínimo ${insumo.stock_minimo}).\n🛒 Hay que comprar.`;
  for (const chatId of autorizados) tg.enviar(chatId, msg);
});

// ================= RED / CONEXIÓN / BACKUP =================
function lanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
    }
  }
  // Priorizar redes locales típicas
  ips.sort((a, b) => (b.startsWith('192.168') || b.startsWith('10.') || b.startsWith('172.') ? 1 : 0) -
                     (a.startsWith('192.168') || a.startsWith('10.') || a.startsWith('172.') ? 1 : 0));
  return ips;
}

app.get('/api/ip', (req, res) => res.json({ ips: lanIPs(), port: PORT }));
app.get('/api/backups', (req, res) => res.json(listarBackups().map((b) => b.archivo)));
app.post('/api/backup', async (req, res) => {
  try { const d = await hacerBackup(); res.json({ ok: true, archivo: path.basename(d) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Página para conectar el celular: muestra la IP actual y un QR para escanear
app.get('/conectar', async (req, res) => {
  const ips = lanIPs();
  const ip = ips[0] || 'localhost';
  const url = `http://${ip}:${PORT}/mozo`;
  let qr = '';
  try { qr = await QRCode.toDataURL(url, { width: 320, margin: 1 }); } catch { /* sin qr */ }
  res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar celular</title>
<style>body{font-family:system-ui,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;text-align:center;padding:24px;margin:0}
h1{color:#f59e0b;margin:8px 0}.url{font-size:24px;font-weight:800;margin:18px;word-break:break-all;color:#fff}
img{background:#fff;padding:14px;border-radius:16px;max-width:90%}.nota{color:#94a3b8;font-size:14px;max-width:520px;margin:10px auto}
a{color:#f59e0b}</style></head>
<body><h1>📱 Conectar el celular del mozo</h1>
<p class="nota">Escaneá este código con la cámara del celular (tiene que estar en el <b>mismo WiFi</b> que esta PC):</p>
${qr ? `<img src="${qr}" alt="QR">` : ''}
<div class="url">${url}</div>
<p class="nota">Si no abre: 1) el celu debe estar en el mismo WiFi; 2) hay que haber corrido <b>ABRIR-PUERTO.bat</b> como administrador (una vez).</p>
${ips.length > 1 ? `<p class="nota">Otras direcciones posibles: ${ips.map((i) => `http://${i}:${PORT}/mozo`).join(' &nbsp; ')}</p>` : ''}
<p class="nota">Tip: en el celu, una vez abierto, "Agregar a pantalla de inicio" para que quede como app.</p>
</body></html>`);
});

// Fallback SPA (el index.html tampoco se cachea, para que siempre cargue la última versión)
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) res.status(200).send('Backend activo. Compilá el frontend (npm run build) o usá el dev server.');
  });
});

// Red de seguridad: un error en cualquier request NO debe tumbar la caja
app.use((err, req, res, next) => {
  console.error('Error en request:', req.method, req.url, '-', err && err.message);
  if (!res.headersSent) res.status(500).json({ error: 'Error interno del servidor' });
});

// Que un error asíncrono aislado (socket, intervalo, bot, impresora) no baje el servidor
process.on('uncaughtException', (e) => console.error('uncaughtException:', e && e.stack || e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.stack || e));

io.on('connection', (socket) => {
  socket.emit('dashboard:update', dashboardData());
});

server.listen(PORT, () => {
  console.log(`\n  Sistema Restaurante — backend en http://localhost:${PORT}`);
  const ips = lanIPs();
  if (ips.length) console.log(`  Celulares (mismo WiFi): http://${ips[0]}:${PORT}/mozo  ·  QR: http://localhost:${PORT}/conectar`);
  // Backups automáticos de la base (al arrancar y cada 6 hs)
  iniciarBackups();
  // Iniciar WhatsApp (no bloquea el arranque). Si falla, el resto sigue funcionando.
  const cfg = getConfig();
  if (cfg.whatsapp?.habilitado !== false) {
    wa.iniciar().catch((e) => console.error('No se pudo iniciar WhatsApp:', e.message));
  }
  // Iniciar bot de Telegram si está habilitado y tiene token (no bloquea el arranque).
  if (cfg.telegram?.habilitado && cfg.telegram?.token) {
    tg.iniciar(cfg.telegram.token).catch((e) => console.error('No se pudo iniciar Telegram:', e.message));
  }
});
