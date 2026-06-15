import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import {
  imprimirPorSectores, imprimirComanda, listarImpresoras, getConfig, setConfig,
} from './printer.js';
import * as wa from './whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Servir el frontend compilado si existe (modo producción / local)
const dist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(dist));

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
  let sql = `SELECT p.*, c.nombre categoria, s.nombre sector
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
  const { nombre, categoria_id, sector_id, precio, activo } = req.body;
  const r = db
    .prepare(
      `INSERT INTO plato (nombre, categoria_id, sector_id, precio, activo, revisar_precio)
       VALUES (?,?,?,?,?,0)`
    )
    .run(nombre, categoria_id, sector_id, precio || 0, activo ?? 1);
  res.json(db.prepare('SELECT * FROM plato WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/platos/:id', (req, res) => {
  const { nombre, categoria_id, sector_id, precio, activo } = req.body;
  db.prepare(
    `UPDATE plato SET nombre=COALESCE(?,nombre), categoria_id=COALESCE(?,categoria_id),
       sector_id=COALESCE(?,sector_id), precio=COALESCE(?,precio), activo=COALESCE(?,activo),
       revisar_precio=0 WHERE id=?`
  ).run(nombre, categoria_id, sector_id, precio, activo, req.params.id);
  res.json(db.prepare('SELECT * FROM plato WHERE id=?').get(req.params.id));
});

app.delete('/api/platos/:id', (req, res) => {
  db.prepare('UPDATE plato SET activo=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/categorias/:id', (req, res) =>
  res.json(db.prepare('SELECT * FROM categoria WHERE id=?').get(req.params.id))
);
app.post('/api/categorias', (req, res) => {
  const r = db.prepare('INSERT INTO categoria (nombre, orden) VALUES (?,?)')
    .run(req.body.nombre, req.body.orden || 0);
  res.json(db.prepare('SELECT * FROM categoria WHERE id=?').get(r.lastInsertRowid));
});

// ================= USUARIOS / MESAS =================
app.get('/api/usuarios', (req, res) =>
  res.json(db.prepare('SELECT id,nombre,rol FROM usuario ORDER BY rol,nombre').all())
);

app.get('/api/mesas', (req, res) => {
  const mesas = db.prepare('SELECT * FROM mesa ORDER BY numero').all();
  for (const m of mesas) {
    const ped = db.prepare(
      `SELECT id,total,abierto_en,mozo_nombre FROM pedido
       WHERE mesa_id=? AND estado IN ('abierto','en_cocina','servido')
       ORDER BY id DESC LIMIT 1`
    ).get(m.id);
    m.pedido = ped || null;
  }
  res.json(mesas);
});

// ================= PEDIDOS =================
app.get('/api/pedidos', (req, res) => {
  const { estado } = req.query;
  let sql = 'SELECT * FROM pedido';
  const args = [];
  if (estado) { sql += ' WHERE estado=?'; args.push(estado); }
  else sql += " WHERE estado IN ('abierto','en_cocina','servido')";
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...args).map((p) => pedidoCompleto(p.id)));
});

app.get('/api/pedidos/:id', (req, res) => {
  const p = pedidoCompleto(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  res.json(p);
});

app.post('/api/pedidos', (req, res) => {
  const {
    tipo = 'salon', mesa_id, mozo_id, mozo_nombre, cubiertos = 1,
    cliente_nombre, cliente_telefono, cliente_direccion,
  } = req.body;
  // Reutilizar pedido abierto de la mesa si existe
  if (mesa_id) {
    const ex = db.prepare(
      "SELECT id FROM pedido WHERE mesa_id=? AND estado IN ('abierto','en_cocina','servido') ORDER BY id DESC LIMIT 1"
    ).get(mesa_id);
    if (ex) return res.json(pedidoCompleto(ex.id));
  }
  const r = db.prepare(
    `INSERT INTO pedido (tipo, mesa_id, mozo_id, mozo_nombre, cubiertos, cliente_nombre, cliente_telefono, cliente_direccion)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(tipo, mesa_id || null, mozo_id || null, mozo_nombre || null, cubiertos,
        cliente_nombre || null, cliente_telefono || null, cliente_direccion || null);
  if (mesa_id) db.prepare("UPDATE mesa SET estado='ocupada' WHERE id=?").run(mesa_id);
  const p = pedidoCompleto(r.lastInsertRowid);
  io.emit('pedido:nuevo', p);
  emitDashboard();
  res.json(p);
});

// Agregar items y enviarlos a cocina
app.post('/api/pedidos/:id/items', (req, res) => {
  const pedidoId = req.params.id;
  const ped = db.prepare('SELECT * FROM pedido WHERE id=?').get(pedidoId);
  if (!ped) return res.status(404).json({ error: 'Pedido inexistente' });
  const items = req.body.items || [];
  const ins = db.prepare(
    `INSERT INTO pedido_item (pedido_id, plato_id, nombre, cantidad, precio_unit, observacion, sector_id, sector_nombre)
     VALUES (@pedido_id,@plato_id,@nombre,@cantidad,@precio_unit,@observacion,@sector_id,@sector_nombre)`
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
      });
      nuevos.push(db.prepare('SELECT * FROM pedido_item WHERE id=?').get(r.lastInsertRowid));
    }
    db.prepare("UPDATE pedido SET estado='en_cocina' WHERE id=?").run(pedidoId);
    recalcTotal(pedidoId);
  });
  tx();
  // Emitir cada item nuevo a la cocina (KDS) por sector
  for (const it of nuevos) {
    io.emit('item:nuevo', { ...it, pedido: pedidoCompleto(pedidoId) });
  }
  const p = pedidoCompleto(pedidoId);
  io.emit('pedido:actualizado', p);
  emitDashboard();
  // Imprimir comandas en térmica (una por sector). No bloquea la respuesta.
  imprimirPorSectores(p, nuevos)
    .then((r) => io.emit('impresion', { pedido_id: pedidoId, resultado: r }))
    .catch((e) => console.error('Error impresión:', e.message));
  res.json(p);
});

// ================= IMPRESIÓN =================
app.get('/api/impresoras', async (req, res) => res.json(await listarImpresoras()));
app.get('/api/config', (req, res) => res.json(getConfig()));
app.put('/api/config', (req, res) => res.json(setConfig(req.body)));

// Reimprimir la comanda de un pedido (todos sus items vigentes), o por sector
app.post('/api/pedidos/:id/reimprimir', async (req, res) => {
  const p = pedidoCompleto(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const items = (p.items || []).filter((i) => i.estado !== 'anulado');
  const r = await imprimirPorSectores(p, items);
  res.json({ ok: true, resultado: r });
});

// Probar impresora
app.post('/api/impresoras/test', async (req, res) => {
  const { impresora } = req.body;
  const fake = { id: 0, tipo: 'salon', mesa: { numero: '—' }, mozo_nombre: 'PRUEBA' };
  const r = await imprimirComanda(
    fake,
    [{ cantidad: 1, nombre: 'PRUEBA DE IMPRESION', observacion: 'ticket de test' }],
    'PRUEBA',
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

// Cobrar / cerrar pedido
app.post('/api/pedidos/:id/pagar', (req, res) => {
  const pedidoId = req.params.id;
  const pagos = req.body.pagos || [{ medio: 'EFECTIVO', importe: req.body.total }];
  const insPago = db.prepare('INSERT INTO pago (pedido_id, medio, importe) VALUES (?,?,?)');
  const tx = db.transaction(() => {
    for (const pg of pagos) insPago.run(pedidoId, pg.medio || 'EFECTIVO', pg.importe);
    db.prepare("UPDATE pedido SET estado='cobrado', cerrado_en=datetime('now','localtime') WHERE id=?").run(pedidoId);
    const ped = db.prepare('SELECT mesa_id FROM pedido WHERE id=?').get(pedidoId);
    if (ped.mesa_id) db.prepare("UPDATE mesa SET estado='libre' WHERE id=?").run(ped.mesa_id);
  });
  tx();
  const p = pedidoCompleto(pedidoId);
  io.emit('pedido:cobrado', p);
  emitDashboard();
  res.json(p);
});

app.post('/api/pedidos/:id/anular', (req, res) => {
  const pedidoId = req.params.id;
  db.prepare("UPDATE pedido SET estado='anulado', cerrado_en=datetime('now','localtime') WHERE id=?").run(pedidoId);
  const ped = db.prepare('SELECT mesa_id FROM pedido WHERE id=?').get(pedidoId);
  if (ped.mesa_id) db.prepare("UPDATE mesa SET estado='libre' WHERE id=?").run(ped.mesa_id);
  io.emit('pedido:actualizado', pedidoCompleto(pedidoId));
  emitDashboard();
  res.json({ ok: true });
});

// ================= WHATSAPP =================
wa.setHandlers({
  emitEstado: (st) => io.emit('wa:estado', st),
  onMensaje: ({ jid, telefono, nombre, texto }) => {
    const r = db.prepare(
      'INSERT INTO wa_inbox (wa_jid, telefono, nombre, texto) VALUES (?,?,?,?)'
    ).run(jid, telefono, nombre, texto);
    const row = db.prepare('SELECT * FROM wa_inbox WHERE id=?').get(r.lastInsertRowid);
    io.emit('wa:nuevo', row);
    // Auto-respuesta de recepción (configurable)
    const cfg = getConfig();
    if (cfg.whatsapp?.autoRespuesta !== false) {
      const txt = cfg.whatsapp?.textoRecepcion ||
        '¡Hola! 👋 Recibimos tu mensaje en Sede Social. En breve confirmamos tu pedido. ¡Gracias!';
      wa.enviarMensaje(jid, txt);
    }
  },
});

app.get('/api/whatsapp/estado', (req, res) => res.json(wa.getEstado()));
app.post('/api/whatsapp/conectar', async (req, res) => res.json(await wa.iniciar()));
app.post('/api/whatsapp/desconectar', async (req, res) => { await wa.desconectar(); res.json({ ok: true }); });

app.get('/api/whatsapp/inbox', (req, res) => {
  const estado = req.query.estado || 'pendiente';
  res.json(db.prepare('SELECT * FROM wa_inbox WHERE estado=? ORDER BY id DESC LIMIT 200').all(estado));
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

app.post('/api/whatsapp/responder', async (req, res) => {
  const { destino, texto } = req.body;
  const ok = await wa.enviarMensaje(destino, texto);
  res.json({ ok });
});

// ================= KDS (cocina) =================
app.get('/api/kds', (req, res) => {
  const { sector } = req.query;
  let sql = `SELECT i.*, p.mesa_id, p.tipo, p.mozo_nombre, m.numero mesa_numero
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
    ts: new Date().toISOString(),
  };
}
app.get('/api/dashboard', (req, res) => res.json(dashboardData()));

// Estadísticas históricas (placeholder hasta migración Fase 0)
app.get('/api/stats/top-historico', (req, res) =>
  res.json(
    db.prepare(
      'SELECT nombre, ventas_historicas FROM plato ORDER BY ventas_historicas DESC LIMIT 20'
    ).all()
  )
);

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) res.status(200).send('Backend activo. Compilá el frontend (npm run build) o usá el dev server.');
  });
});

io.on('connection', (socket) => {
  socket.emit('dashboard:update', dashboardData());
});

server.listen(PORT, () => {
  console.log(`\n  Sistema Restaurante — backend en http://localhost:${PORT}`);
  console.log(`  API:    http://localhost:${PORT}/api/dashboard`);
  // Iniciar WhatsApp (no bloquea el arranque). Si falla, el resto sigue funcionando.
  const cfg = getConfig();
  if (cfg.whatsapp?.habilitado !== false) {
    wa.iniciar().catch((e) => console.error('No se pudo iniciar WhatsApp:', e.message));
  }
});
