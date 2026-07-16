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
import { parsearPedidoIA } from './ia.js';
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
  let sql = `SELECT p.*, c.nombre categoria, COALESCE(c.guarnicion,0) cat_guarnicion,
                    COALESCE(c.en_comanda,1) cat_en_comanda, s.nombre sector
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
  const { nombre, categoria_id, sector_id, precio, activo, alias_ia, punto } = req.body;
  const r = db
    .prepare(
      `INSERT INTO plato (nombre, categoria_id, sector_id, precio, activo, alias_ia, punto, revisar_precio)
       VALUES (?,?,?,?,?,?,?,0)`
    )
    .run(nombre, categoria_id, sector_id, precio || 0, activo ?? 1, alias_ia || null, punto ? 1 : 0);
  res.json(db.prepare('SELECT * FROM plato WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/platos/:id', (req, res) => {
  const { nombre, categoria_id, sector_id, precio, activo, alias_ia, punto, favorito, disponible } = req.body;
  db.prepare(
    `UPDATE plato SET nombre=COALESCE(?,nombre), categoria_id=COALESCE(?,categoria_id),
       sector_id=COALESCE(?,sector_id), precio=COALESCE(?,precio), activo=COALESCE(?,activo),
       alias_ia=COALESCE(?,alias_ia), punto=COALESCE(?,punto), favorito=COALESCE(?,favorito),
       disponible=COALESCE(?,disponible), revisar_precio=0 WHERE id=?`
  ).run(nombre, categoria_id, sector_id, precio, activo, alias_ia ?? null,
        punto == null ? null : (punto ? 1 : 0),
        favorito == null ? null : (favorito ? 1 : 0),
        disponible == null ? null : (disponible ? 1 : 0), req.params.id);
  res.json(db.prepare('SELECT * FROM plato WHERE id=?').get(req.params.id));
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
            COALESCE(c.en_comanda,1) cat_en_comanda, s.nombre sector,
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

app.get('/api/categorias/:id', (req, res) =>
  res.json(db.prepare('SELECT * FROM categoria WHERE id=?').get(req.params.id))
);
app.post('/api/categorias', (req, res) => {
  const r = db.prepare('INSERT INTO categoria (nombre, orden) VALUES (?,?)')
    .run(req.body.nombre, req.body.orden || 0);
  res.json(db.prepare('SELECT * FROM categoria WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/categorias/:id', (req, res) => {
  const { nombre, orden, guarnicion, en_comanda } = req.body;
  db.prepare(
    `UPDATE categoria SET nombre=COALESCE(?,nombre), orden=COALESCE(?,orden),
       guarnicion=COALESCE(?,guarnicion), en_comanda=COALESCE(?,en_comanda) WHERE id=?`
  ).run(nombre ?? null, orden ?? null,
        guarnicion == null ? null : (guarnicion ? 1 : 0),
        en_comanda == null ? null : (en_comanda ? 1 : 0),
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
  // Bloquear platos marcados "sin stock" por la cocina
  const sinStock = items
    .map((it) => db.prepare('SELECT nombre FROM plato WHERE id=? AND disponible=0').get(it.plato_id))
    .filter(Boolean).map((p) => p.nombre);
  if (sinStock.length) return res.status(409).json({ error: 'Sin stock: ' + [...new Set(sinStock)].join(', ') });
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
  // Descontar stock de cada plato vendido (según receta; bebidas = 1:1)
  for (const it of nuevos) consumirStockVenta(pedidoId, it.plato_id, it.cantidad);
  // Emitir cada item nuevo a la cocina (KDS) por sector
  for (const it of nuevos) {
    io.emit('item:nuevo', { ...it, pedido: pedidoCompleto(pedidoId) });
  }
  const p = pedidoCompleto(pedidoId);
  io.emit('pedido:actualizado', p);
  emitDashboard();
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

app.get('/api/cuentas', (req, res) => {
  res.json(db.prepare(`SELECT c.*, ${saldoSql} saldo FROM cuenta c WHERE c.activo=1 ORDER BY c.nombre`).all());
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
  c.saldo = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN tipo='cargo' THEN importe ELSE -importe END),0) s FROM cuenta_mov WHERE cuenta_id=?"
  ).get(c.id).s;
  res.json(c);
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
  const ventas = db.prepare(
    `SELECT medio, COALESCE(SUM(importe),0) total, COUNT(*) n
     FROM pago WHERE fecha > ? GROUP BY medio ORDER BY total DESC`
  ).all(desde);
  const tot = db.prepare(
    'SELECT COALESCE(SUM(importe),0) total, COUNT(DISTINCT pedido_id) tickets FROM pago WHERE fecha > ?'
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
  const propinas = db.prepare("SELECT COALESCE(SUM(propina),0) t FROM pedido WHERE estado='cobrado' AND cerrado_en > ?").get(desde).t;
  const descuentos = db.prepare("SELECT COALESCE(SUM(descuento),0) t FROM pedido WHERE estado='cobrado' AND cerrado_en > ?").get(desde).t;
  const sum = (arr, f = () => true) => arr.filter(f).reduce((a, m) => a + m.total, 0);
  const esEfectivo = (m) => /EFECTIVO/i.test(m.medio);
  const esFiado = (m) => /FIADO/i.test(m.medio);
  const ventaEfectivo = sum(ventas, esEfectivo);
  const ventaFiado = sum(ventas, esFiado);
  const fiadoCobradoEfectivo = sum(cobrosFiado, esEfectivo);
  const esperado = fondo + ventaEfectivo + fiadoCobradoEfectivo + ingresos - egresos;
  return {
    desde, ventas, totalVentas: tot.total, tickets: tot.tickets,
    ventaEfectivo, ventaFiado, ventaOtros: tot.total - ventaEfectivo - ventaFiado,
    cobrosFiado, fiadoCobradoTotal: sum(cobrosFiado), fiadoCobradoEfectivo,
    fondo, egresos, ingresos, propinas, descuentos, movimientos,
    esperado, efectivoEnCaja: esperado,
  };
}

async function imprimirCierre(cierre, r) {
  const L = [];
  L.push('Cierre #' + cierre.id);
  L.push('  desde ' + cierre.desde);
  L.push('  hasta ' + cierre.hasta);
  L.push('------------------------');
  L.push('VENTAS POR MEDIO');
  for (const m of r.ventas) L.push(' ' + m.medio + ': ' + moneyTxt(m.total) + ' (' + m.n + ')');
  L.push('Tickets: ' + r.tickets);
  L.push('TOTAL VENTAS: ' + moneyTxt(r.totalVentas));
  if (r.descuentos > 0) L.push('Descuentos: ' + moneyTxt(r.descuentos));
  if (r.propinas > 0) L.push('Propinas: ' + moneyTxt(r.propinas));
  if (r.fiadoCobradoTotal > 0) {
    L.push('------------------------');
    L.push('COBROS DE FIADO');
    for (const m of r.cobrosFiado) L.push(' ' + m.medio + ': ' + moneyTxt(m.total));
  }
  if (r.ventaFiado > 0) L.push('Fiado nuevo (a cobrar): ' + moneyTxt(r.ventaFiado));
  L.push('------------------------');
  L.push('ARQUEO DE EFECTIVO');
  L.push(' Fondo inicial: ' + moneyTxt(r.fondo));
  L.push(' Ventas efectivo: ' + moneyTxt(r.ventaEfectivo));
  if (r.fiadoCobradoEfectivo > 0) L.push(' Fiado cobrado efvo: ' + moneyTxt(r.fiadoCobradoEfectivo));
  if (r.ingresos > 0) L.push(' Ingresos: ' + moneyTxt(r.ingresos));
  if (r.egresos > 0) L.push(' Egresos: -' + moneyTxt(r.egresos));
  L.push(' ESPERADO: ' + moneyTxt(r.esperado));
  if (cierre.contado != null) {
    L.push(' Contado: ' + moneyTxt(cierre.contado));
    const d = cierre.diferencia;
    L.push(' DIFERENCIA: ' + (d === 0 ? 'OK' : (d > 0 ? 'SOBRA ' + moneyTxt(d) : 'FALTA ' + moneyTxt(-d))));
  }
  return imprimirTextoPlano('CIERRE DE CAJA', L);
}

// Registrar un movimiento de caja: apertura (fondo) | egreso (retiro/pago) | ingreso (extra)
app.post('/api/caja/movimiento', (req, res) => {
  const tipo = req.body.tipo;
  const importe = Math.round(Number(req.body.importe) || 0);
  if (!['apertura', 'egreso', 'ingreso'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  if (!(importe > 0)) return res.status(400).json({ error: 'Importe inválido' });
  db.prepare('INSERT INTO caja_mov (tipo, importe, detalle) VALUES (?,?,?)').run(tipo, importe, req.body.detalle || null);
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

// Fallback SPA
app.get('*', (req, res) => {
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
