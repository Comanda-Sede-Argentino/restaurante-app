// Módulo de Stock / Inventario. Autocontenido: registra sus rutas /api/insumos y /api/stock,
// y exporta helpers para descontar/devolver stock desde las ventas.
import db from './db.js';

// Callback que se dispara cuando un insumo cruza por debajo del mínimo (para avisar por Telegram)
let alertaStock = null;
export function setAlertaStock(fn) { alertaStock = fn; }

// Descuenta del stock los insumos que consume un plato vendido (según su receta).
// Para bebidas/envasados la receta tiene 1 fila (el propio producto, cantidad 1).
export function consumirStockVenta(pedidoId, platoId, cantidad) {
  if (!platoId) return;
  const rec = db.prepare('SELECT insumo_id, cantidad FROM receta WHERE plato_id=?').all(platoId);
  for (const r of rec) {
    const usado = cantidad * r.cantidad;
    db.prepare('UPDATE insumo SET stock = stock - ? WHERE id=?').run(usado, r.insumo_id);
    db.prepare("INSERT INTO stock_mov (insumo_id, tipo, cantidad, pedido_id, detalle) VALUES (?, 'venta', ?, ?, ?)")
      .run(r.insumo_id, -usado, pedidoId, null);
    // ¿Esta venta hizo que el insumo cruce por debajo del mínimo? Avisar (una sola vez al cruzar).
    if (alertaStock) {
      const i = db.prepare('SELECT * FROM insumo WHERE id=?').get(r.insumo_id);
      if (i && i.stock_minimo > 0 && i.stock <= i.stock_minimo && (i.stock + usado) > i.stock_minimo) {
        try { alertaStock(i); } catch { /* no romper la venta por una alerta */ }
      }
    }
  }
}

// Devuelve al stock lo consumido por un ítem anulado (una sola vez, marca stock_devuelto).
export function devolverStockItem(item) {
  if (!item || item.stock_devuelto || !item.plato_id) return;
  const rec = db.prepare('SELECT insumo_id, cantidad FROM receta WHERE plato_id=?').all(item.plato_id);
  for (const r of rec) {
    const dev = item.cantidad * r.cantidad;
    db.prepare('UPDATE insumo SET stock = stock + ? WHERE id=?').run(dev, r.insumo_id);
    db.prepare("INSERT INTO stock_mov (insumo_id, tipo, cantidad, pedido_id, detalle) VALUES (?, 'devolucion', ?, ?, ?)")
      .run(r.insumo_id, dev, item.pedido_id, 'anulación');
  }
  db.prepare('UPDATE pedido_item SET stock_devuelto=1 WHERE id=?').run(item.id);
}

// Devuelve el stock de todos los ítems vigentes de un pedido (al anular el pedido completo).
export function devolverStockPedido(pedidoId) {
  const items = db.prepare("SELECT * FROM pedido_item WHERE pedido_id=? AND stock_devuelto=0 AND plato_id IS NOT NULL").all(pedidoId);
  for (const it of items) devolverStockItem(it);
}

// Insumos por debajo (o igual) del mínimo: la lista "para comprar".
export function insumosFaltantes() {
  return db.prepare(
    'SELECT * FROM insumo WHERE activo=1 AND stock_minimo > 0 AND stock <= stock_minimo ORDER BY (stock_minimo - stock) DESC'
  ).all();
}

export function registrarStock(app) {
  // ---- Insumos ----
  app.get('/api/insumos', (req, res) => {
    const rows = db.prepare('SELECT * FROM insumo WHERE activo=1 ORDER BY nombre').all();
    for (const r of rows) r.falta = r.stock_minimo > 0 && r.stock <= r.stock_minimo;
    res.json(rows);
  });

  app.get('/api/insumos/:id', (req, res) => {
    const i = db.prepare('SELECT * FROM insumo WHERE id=?').get(req.params.id);
    if (!i) return res.status(404).json({ error: 'No existe' });
    i.movimientos = db.prepare('SELECT * FROM stock_mov WHERE insumo_id=? ORDER BY id DESC LIMIT 200').all(i.id);
    res.json(i);
  });

  app.post('/api/insumos', (req, res) => {
    const { nombre, unidad, stock, stock_minimo, costo, proveedor } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre' });
    const r = db.prepare(
      'INSERT INTO insumo (nombre, unidad, stock, stock_minimo, costo, proveedor) VALUES (?,?,?,?,?,?)'
    ).run(nombre.trim(), unidad || 'unidad', Number(stock) || 0, Number(stock_minimo) || 0, Number(costo) || 0, proveedor || null);
    const ins = db.prepare('SELECT * FROM insumo WHERE id=?').get(r.lastInsertRowid);
    if ((Number(stock) || 0) !== 0) {
      db.prepare("INSERT INTO stock_mov (insumo_id, tipo, cantidad, detalle) VALUES (?, 'ajuste', ?, 'carga inicial')")
        .run(ins.id, Number(stock) || 0);
    }
    res.json(ins);
  });

  app.put('/api/insumos/:id', (req, res) => {
    const { nombre, unidad, stock_minimo, costo, proveedor, activo } = req.body;
    db.prepare(
      `UPDATE insumo SET nombre=COALESCE(?,nombre), unidad=COALESCE(?,unidad),
         stock_minimo=COALESCE(?,stock_minimo), costo=COALESCE(?,costo),
         proveedor=COALESCE(?,proveedor), activo=COALESCE(?,activo) WHERE id=?`
    ).run(nombre ?? null, unidad ?? null, stock_minimo ?? null, costo ?? null,
          proveedor ?? null, activo ?? null, req.params.id);
    res.json(db.prepare('SELECT * FROM insumo WHERE id=?').get(req.params.id));
  });

  app.delete('/api/insumos/:id', (req, res) => {
    db.prepare('UPDATE insumo SET activo=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- Compra: suma stock ----
  app.post('/api/insumos/:id/compra', (req, res) => {
    const cant = Number(req.body.cantidad);
    if (!(cant > 0)) return res.status(400).json({ error: 'Cantidad inválida' });
    const i = db.prepare('SELECT * FROM insumo WHERE id=?').get(req.params.id);
    if (!i) return res.status(404).json({ error: 'No existe' });
    db.prepare('UPDATE insumo SET stock = stock + ? WHERE id=?').run(cant, i.id);
    if (req.body.costo != null && Number(req.body.costo) >= 0) {
      db.prepare('UPDATE insumo SET costo=? WHERE id=?').run(Number(req.body.costo), i.id);
    }
    db.prepare("INSERT INTO stock_mov (insumo_id, tipo, cantidad, detalle) VALUES (?, 'compra', ?, ?)")
      .run(i.id, cant, req.body.detalle || null);
    res.json(db.prepare('SELECT * FROM insumo WHERE id=?').get(i.id));
  });

  // ---- Ajuste / recuento físico: fija el stock real ----
  app.post('/api/insumos/:id/ajuste', (req, res) => {
    const real = Number(req.body.stock_real);
    if (isNaN(real)) return res.status(400).json({ error: 'Stock inválido' });
    const i = db.prepare('SELECT * FROM insumo WHERE id=?').get(req.params.id);
    if (!i) return res.status(404).json({ error: 'No existe' });
    const dif = real - i.stock;
    db.prepare('UPDATE insumo SET stock=? WHERE id=?').run(real, i.id);
    db.prepare("INSERT INTO stock_mov (insumo_id, tipo, cantidad, detalle) VALUES (?, 'ajuste', ?, ?)")
      .run(i.id, dif, req.body.detalle || 'recuento físico');
    res.json(db.prepare('SELECT * FROM insumo WHERE id=?').get(i.id));
  });

  // ---- Lista "para comprar" ----
  app.get('/api/stock/comprar', (req, res) => res.json(insumosFaltantes()));

  // ---- Receta de un plato (qué insumos descuenta) ----
  app.get('/api/platos/:id/receta', (req, res) => {
    res.json(db.prepare(
      `SELECT r.id, r.insumo_id, r.cantidad, i.nombre, i.unidad
       FROM receta r JOIN insumo i ON i.id=r.insumo_id WHERE r.plato_id=?`
    ).all(req.params.id));
  });

  // Reemplaza la receta del plato por las filas enviadas [{insumo_id, cantidad}]
  app.put('/api/platos/:id/receta', (req, res) => {
    const filas = (req.body.receta || []).filter((f) => f.insumo_id && Number(f.cantidad) > 0);
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM receta WHERE plato_id=?').run(req.params.id);
      const ins = db.prepare('INSERT INTO receta (plato_id, insumo_id, cantidad) VALUES (?,?,?)');
      for (const f of filas) ins.run(req.params.id, f.insumo_id, Number(f.cantidad));
    });
    tx();
    res.json({ ok: true });
  });
}
