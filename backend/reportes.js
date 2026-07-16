// Módulo de Reportes (histórico/analítico). Autocontenido: registra sus rutas /api/reportes/*.
// Se basa en datos reales de la operación (tabla `pago` para ventas, `pedido`/`pedido_item`
// para productos). NO incluye datos del sistema viejo (MRC); solo desde que corre este sistema.
import db from './db.js';

// Expresión SQL para agrupar por día / semana / mes (sobre pago.fecha, ya en hora local).
const periodoExpr = (group) =>
  group === 'mes' ? "strftime('%Y-%m', p.fecha)"
    : group === 'semana' ? "strftime('%Y-S%W', p.fecha)"
      : "strftime('%Y-%m-%d', p.fecha)";

const fmtFecha = (d) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

export function registrarReportes(app) {
  app.get('/api/reportes/general', (req, res) => {
    const hoy = new Date();
    // Por defecto: desde el 1° del mes actual hasta hoy.
    const desde = req.query.desde || fmtFecha(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    const hasta = req.query.hasta || fmtFecha(hoy);
    const group = ['dia', 'semana', 'mes'].includes(req.query.group) ? req.query.group : 'dia';
    const rango = [desde, hasta]; // siempre como parámetros (seguro ante inyección)

    // ---- Ventas: basadas en pagos reales (incluye FIADO como venta del momento) ----
    const wPago = 'WHERE date(p.fecha) BETWEEN ? AND ?';

    const totales = db.prepare(
      `SELECT COALESCE(SUM(p.importe),0) total, COUNT(DISTINCT p.pedido_id) tickets
       FROM pago p ${wPago}`
    ).get(...rango);
    totales.ticketPromedio = totales.tickets ? totales.total / totales.tickets : 0;

    const serie = db.prepare(
      `SELECT ${periodoExpr(group)} periodo, COALESCE(SUM(p.importe),0) total, COUNT(DISTINCT p.pedido_id) tickets
       FROM pago p ${wPago} GROUP BY periodo ORDER BY periodo`
    ).all(...rango);

    const porMedio = db.prepare(
      `SELECT p.medio, COALESCE(SUM(p.importe),0) total, COUNT(*) n
       FROM pago p ${wPago} GROUP BY p.medio ORDER BY total DESC`
    ).all(...rango);

    const porTipo = db.prepare(
      `SELECT COALESCE(o.tipo,'?') tipo, COALESCE(SUM(p.importe),0) total, COUNT(DISTINCT p.pedido_id) tickets
       FROM pago p JOIN pedido o ON o.id=p.pedido_id ${wPago} GROUP BY o.tipo ORDER BY total DESC`
    ).all(...rango);

    const porMozo = db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(o.mozo_nombre),''),'(sin mozo)') mozo,
              COALESCE(SUM(p.importe),0) total, COUNT(DISTINCT p.pedido_id) tickets
       FROM pago p JOIN pedido o ON o.id=p.pedido_id ${wPago} GROUP BY mozo ORDER BY total DESC`
    ).all(...rango);

    // Propinas por mozo (para repartir)
    const propinasMozo = db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(mozo_nombre),''),'(sin mozo)') mozo, COALESCE(SUM(propina),0) total
       FROM pedido WHERE estado='cobrado' AND propina > 0 AND date(cerrado_en) BETWEEN ? AND ?
       GROUP BY mozo ORDER BY total DESC`
    ).all(...rango);

    const porHora = db.prepare(
      `SELECT strftime('%H', p.fecha) hora, COALESCE(SUM(p.importe),0) total, COUNT(DISTINCT p.pedido_id) tickets
       FROM pago p ${wPago} GROUP BY hora ORDER BY hora`
    ).all(...rango);

    const porDiaSemana = db.prepare(
      `SELECT strftime('%w', p.fecha) dow, COALESCE(SUM(p.importe),0) total, COUNT(DISTINCT p.pedido_id) tickets
       FROM pago p ${wPago} GROUP BY dow ORDER BY dow`
    ).all(...rango);

    // ---- Productos: pedidos cobrados en el rango (por cerrado_en), sin anulados ni la línea "Envío" ----
    const wProd = "WHERE o.estado='cobrado' AND date(o.cerrado_en) BETWEEN ? AND ? AND i.estado<>'anulado' AND i.plato_id IS NOT NULL";

    const productosTop = db.prepare(
      `SELECT i.nombre, SUM(i.cantidad) cant, COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id ${wProd}
       GROUP BY i.nombre ORDER BY cant DESC LIMIT 20`
    ).all(...rango);

    const productosBottom = db.prepare(
      `SELECT i.nombre, SUM(i.cantidad) cant, COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id ${wProd}
       GROUP BY i.nombre ORDER BY cant ASC, total ASC LIMIT 15`
    ).all(...rango);

    const porCategoria = db.prepare(
      `SELECT COALESCE(c.nombre,'(sin categoría)') categoria, SUM(i.cantidad) cant,
              COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
       LEFT JOIN plato pl ON pl.id=i.plato_id LEFT JOIN categoria c ON c.id=pl.categoria_id
       ${wProd} GROUP BY categoria ORDER BY total DESC`
    ).all(...rango);

    // ---- Anulaciones en el rango (control de pérdidas) ----
    const anulaciones = db.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
       WHERE i.estado='anulado' AND date(o.abierto_en) BETWEEN ? AND ?`
    ).get(...rango);

    // ---- Cobros de fiado recibidos en el rango (NO es venta nueva; informativo de caja) ----
    const fiadoCobrado = db.prepare(
      `SELECT COALESCE(SUM(importe),0) total, COUNT(*) n
       FROM cuenta_mov WHERE tipo='pago' AND date(fecha) BETWEEN ? AND ?`
    ).get(...rango);

    res.json({
      desde, hasta, group,
      totales, serie, porMedio, porTipo, porMozo, propinasMozo, porHora, porDiaSemana,
      productosTop, productosBottom, porCategoria, anulaciones, fiadoCobrado,
    });
  });
}
