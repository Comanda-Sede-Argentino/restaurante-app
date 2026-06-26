import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import {
  imprimirComandaUnica, imprimirCuenta, listarImpresoras, listarPuertosCom, getConfig, setConfig,
} from './printer.js';
import * as wa from './whatsapp.js';
import os from 'os';
import QRCode from 'qrcode';
import { iniciarBackups, listarBackups, hacerBackup } from './backup.js';

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
  // Imprimir UNA comanda con todo lo enviado. No bloquea la respuesta.
  imprimirComandaUnica(p, nuevos)
    .then((r) => io.emit('impresion', { pedido_id: pedidoId, resultado: r }))
    .catch((e) => console.error('Error impresión:', e.message));
  res.json(p);
});

// ================= IMPRESIÓN =================
app.get('/api/impresoras', async (req, res) => res.json(await listarImpresoras()));
app.get('/api/puertos-com', async (req, res) => res.json(await listarPuertosCom()));
app.get('/api/config', (req, res) => res.json(getConfig()));
app.put('/api/config', (req, res) => res.json(setConfig(req.body)));

// Reimprimir la comanda de un pedido (todos sus items vigentes)
app.post('/api/pedidos/:id/reimprimir', async (req, res) => {
  const p = pedidoCompleto(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const items = (p.items || []).filter((i) => i.estado !== 'anulado');
  const r = await imprimirComandaUnica(p, items);
  res.json({ ok: true, resultado: r });
});

// Imprimir la CUENTA del cliente (total). NO cierra la mesa.
app.post('/api/pedidos/:id/cuenta', async (req, res) => {
  const p = pedidoCompleto(req.params.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const items = (p.items || []).filter((i) => i.estado !== 'anulado');
  if (!items.length) return res.status(400).json({ error: 'El pedido no tiene platos' });
  const r = await imprimirCuenta(p, items);
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

wa.setHandlers({
  emitEstado: (st) => io.emit('wa:estado', st),
  onMensaje: ({ jid, telefono, nombre, texto }) => {
    const r = db.prepare(
      'INSERT INTO wa_inbox (wa_jid, telefono, nombre, texto) VALUES (?,?,?,?)'
    ).run(jid, telefono, nombre, texto);
    const row = db.prepare('SELECT * FROM wa_inbox WHERE id=?').get(r.lastInsertRowid);
    io.emit('wa:nuevo', row);

    // Auto-respuesta inteligente: distinta según tipo de mensaje y sin repetir
    const cfg = getConfig();
    const w = cfg.whatsapp || {};
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

    const txt = tipo === 'pedido'
      ? (w.textoRecepcion || '¡Hola! Recibimos tu pedido. En breve te confirmamos. ¡Gracias!')
      : (w.textoConsulta || '¡Hola! Gracias por escribir. En breve te respondemos.');
    wa.enviarMensaje(jid, txt);
    ultimaRespuestaWa.set(jid, { tipo, ts: ahora });
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
  const ips = lanIPs();
  if (ips.length) console.log(`  Celulares (mismo WiFi): http://${ips[0]}:${PORT}/mozo  ·  QR: http://localhost:${PORT}/conectar`);
  // Backups automáticos de la base (al arrancar y cada 6 hs)
  iniciarBackups();
  // Iniciar WhatsApp (no bloquea el arranque). Si falla, el resto sigue funcionando.
  const cfg = getConfig();
  if (cfg.whatsapp?.habilitado !== false) {
    wa.iniciar().catch((e) => console.error('No se pudo iniciar WhatsApp:', e.message));
  }
});
