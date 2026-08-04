// Módulo de Reportes (histórico/analítico). Autocontenido: registra sus rutas /api/reportes/*.
// Se basa en datos reales de la operación (tabla `pago` para ventas, `pedido`/`pedido_item`
// para productos). NO incluye datos del sistema viejo (MRC); solo desde que corre este sistema.
import db from './db.js';
import { getConfig } from './printer.js';

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

    // Ventas agrupadas en Comida / Bebidas / Cafetería (según el grupo de cada categoría)
    const porGrupo = db.prepare(
      `SELECT COALESCE(c.grupo,'comida') grupo, SUM(i.cantidad) cant,
              COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
       LEFT JOIN plato pl ON pl.id=i.plato_id LEFT JOIN categoria c ON c.id=pl.categoria_id
       ${wProd} GROUP BY grupo ORDER BY total DESC`
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
      productosTop, productosBottom, porCategoria, porGrupo, anulaciones, fiadoCobrado,
    });
  });

  // ---- Reporte específico de VIANDAS (menús del mediodía) ----
  app.get('/api/reportes/viandas', (req, res) => {
    const hoy = new Date();
    const desde = req.query.desde || fmtFecha(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    const hasta = req.query.hasta || fmtFecha(hoy);
    const rango = [desde, hasta];
    // Base: pedidos de vianda COBRADOS en el rango (por cerrado_en), sin ítems anulados.
    const W = "WHERE o.tipo='vianda' AND o.estado='cobrado' AND date(o.cerrado_en) BETWEEN ? AND ? AND i.estado<>'anulado'";
    // Cuenta de viandas = ítems que son menú del día (menu_dia_id no nulo). Total $ = todos los ítems.
    const VIANDA = 'CASE WHEN i.menu_dia_id IS NOT NULL THEN i.cantidad ELSE 0 END';

    const totales = db.prepare(
      `SELECT COUNT(DISTINCT o.id) pedidos,
              COALESCE(SUM(${VIANDA}),0) viandas,
              COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido o JOIN pedido_item i ON i.pedido_id=o.id ${W}`
    ).get(...rango);
    totales.ticketPromedio = totales.pedidos ? totales.total / totales.pedidos : 0;

    // Serie por día: cuántas viandas y cuánto se vendió
    const serie = db.prepare(
      `SELECT date(o.cerrado_en) dia, COALESCE(SUM(${VIANDA}),0) viandas,
              COALESCE(SUM(i.cantidad*i.precio_unit),0) total, COUNT(DISTINCT o.id) pedidos
       FROM pedido o JOIN pedido_item i ON i.pedido_id=o.id ${W} GROUP BY dia ORDER BY dia`
    ).all(...rango);

    // Ranking histórico de menús (cuál se pide más) — clave para planificar
    const porMenu = db.prepare(
      `SELECT md.nombre, SUM(i.cantidad) cantidad, COALESCE(SUM(i.cantidad*i.precio_unit),0) total,
              COUNT(DISTINCT md.fecha) dias
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id JOIN menu_dia md ON md.id=i.menu_dia_id
       WHERE o.estado='cobrado' AND date(o.cerrado_en) BETWEEN ? AND ? AND i.estado<>'anulado'
       GROUP BY md.nombre ORDER BY cantidad DESC LIMIT 40`
    ).all(...rango);

    // Domicilio vs retiro
    const porEntrega = db.prepare(
      `SELECT COALESCE(NULLIF(o.entrega,''),'domicilio') entrega, COUNT(DISTINCT o.id) pedidos,
              COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido o JOIN pedido_item i ON i.pedido_id=o.id ${W} GROUP BY entrega ORDER BY pedidos DESC`
    ).all(...rango);

    // Clientes que más compran (recurrencia)
    const clientes = db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(o.cliente_nombre),''), o.cliente_telefono, '(sin nombre)') cliente,
              o.cliente_telefono telefono, COUNT(DISTINCT o.id) pedidos,
              COALESCE(SUM(i.cantidad*i.precio_unit),0) total, MAX(date(o.cerrado_en)) ultima
       FROM pedido o JOIN pedido_item i ON i.pedido_id=o.id ${W}
       GROUP BY COALESCE(o.cliente_telefono, CAST(o.id AS TEXT))
       ORDER BY pedidos DESC, total DESC LIMIT 40`
    ).all(...rango);

    // Por día de la semana (qué días se vende más)
    const porDiaSemana = db.prepare(
      `SELECT strftime('%w', o.cerrado_en) dow, COALESCE(SUM(${VIANDA}),0) viandas,
              COALESCE(SUM(i.cantidad*i.precio_unit),0) total, COUNT(DISTINCT o.id) pedidos
       FROM pedido o JOIN pedido_item i ON i.pedido_id=o.id ${W} GROUP BY dow ORDER BY dow`
    ).all(...rango);

    res.json({ desde, hasta, totales, serie, porMenu, porEntrega, clientes, porDiaSemana });
  });

  // ---- Ventas por MÓDULO (Salón mediodía / Viandas / Salón noche / Delivery noche) ----
  app.get('/api/reportes/modulos', (req, res) => {
    const hoy = new Date();
    const desde = req.query.desde || fmtFecha(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    const hasta = req.query.hasta || fmtFecha(hoy);
    let corte = req.query.corte;
    try { if (!corte) corte = (getConfig().caja || {}).corteNoche; } catch { /* nada */ }
    corte = corte || '17:00';
    const rango = [desde, hasta];
    // Clasificación de cada venta en un módulo. Se usa la fecha/hora en que se TOMÓ el pedido
    // (abierto_en), NO cuándo se cobró: así un delivery del mediodía cobrado a la noche igual cuenta
    // en el turno que corresponde. El salón y el delivery se parten por la hora de corte.
    // (Viandas es su propio módulo; el delivery se separa en mediodía/noche por el corte.)
    const MOD = `CASE
      WHEN o.tipo='vianda' THEN 'Viandas'
      WHEN o.tipo='delivery' AND time(o.abierto_en) < ? THEN 'Delivery mediodía'
      WHEN o.tipo='delivery' THEN 'Delivery noche'
      WHEN time(o.abierto_en) < ? THEN 'Salón mediodía'
      ELSE 'Salón noche' END`;
    const totMod = db.prepare(
      `SELECT ${MOD} modulo, COALESCE(SUM(pg.importe),0) total, COUNT(DISTINCT pg.pedido_id) tickets
       FROM pago pg JOIN pedido o ON o.id=pg.pedido_id
       WHERE date(o.abierto_en) BETWEEN ? AND ? GROUP BY modulo ORDER BY total DESC`
    ).all(corte, corte, ...rango);
    const filas = db.prepare(
      `SELECT ${MOD} modulo, pg.medio, COALESCE(SUM(pg.importe),0) total, COUNT(*) n
       FROM pago pg JOIN pedido o ON o.id=pg.pedido_id
       WHERE date(o.abierto_en) BETWEEN ? AND ? GROUP BY modulo, pg.medio`
    ).all(corte, corte, ...rango);
    const porDia = db.prepare(
      `SELECT date(o.abierto_en) dia, ${MOD} modulo, COALESCE(SUM(pg.importe),0) total
       FROM pago pg JOIN pedido o ON o.id=pg.pedido_id
       WHERE date(o.abierto_en) BETWEEN ? AND ? GROUP BY dia, modulo ORDER BY dia`
    ).all(corte, corte, ...rango);
    const totalGeneral = totMod.reduce((a, m) => a + m.total, 0);
    res.json({ desde, hasta, corte, totMod, filas, porDia, totalGeneral });
  });
}
