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

    // ---- Productos: pedidos cobrados en el rango (por cerrado_en), sin anulados.
    // Incluye los FUERA DE CARTA (varios) para que NO se escapen del ranking; solo excluye la
    // línea de "Envío" (que no es un producto, se informa aparte). ----
    const wProd = "WHERE o.estado='cobrado' AND date(o.cerrado_en) BETWEEN ? AND ? AND i.estado<>'anulado' AND NOT (i.plato_id IS NULL AND i.nombre='Envío')";
    // Grupo: el de la categoría; si es un plato sin grupo -> comida; si es fuera de carta (sin plato) -> otros.
    const GRUPO = "COALESCE(c.grupo, CASE WHEN i.plato_id IS NULL THEN 'otros' ELSE 'comida' END)";
    const CAT = "COALESCE(c.nombre, CASE WHEN i.plato_id IS NULL THEN '(fuera de carta)' ELSE '(sin categoría)' END)";

    // Todos los productos vendidos con su GRUPO. El front arma "más/menos vendidos" y filtra por grupo.
    const productos = db.prepare(
      `SELECT i.nombre, ${GRUPO} grupo,
              SUM(i.cantidad) cant, COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
       LEFT JOIN plato pl ON pl.id=i.plato_id LEFT JOIN categoria c ON c.id=pl.categoria_id
       ${wProd} GROUP BY i.nombre, grupo ORDER BY cant DESC`
    ).all(...rango);

    const porCategoria = db.prepare(
      `SELECT ${CAT} categoria, SUM(i.cantidad) cant,
              COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
       LEFT JOIN plato pl ON pl.id=i.plato_id LEFT JOIN categoria c ON c.id=pl.categoria_id
       ${wProd} GROUP BY categoria ORDER BY total DESC`
    ).all(...rango);

    // Ventas agrupadas en Comida / Bebidas / Cafetería / Fuera de carta
    const porGrupo = db.prepare(
      `SELECT ${GRUPO} grupo, SUM(i.cantidad) cant,
              COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
       LEFT JOIN plato pl ON pl.id=i.plato_id LEFT JOIN categoria c ON c.id=pl.categoria_id
       ${wProd} GROUP BY grupo ORDER BY total DESC`
    ).all(...rango);

    // Envío cobrado (informativo, no es un producto)
    const envio = db.prepare(
      `SELECT COALESCE(SUM(i.cantidad*i.precio_unit),0) t
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
       WHERE o.estado='cobrado' AND date(o.cerrado_en) BETWEEN ? AND ? AND i.estado<>'anulado'
         AND i.plato_id IS NULL AND i.nombre='Envío'`
    ).get(...rango).t;

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

    // ---- Descuentos y propinas del período (sobre pedidos cobrados) ----
    const extra = db.prepare(
      `SELECT COALESCE(SUM(descuento),0) descuentos, COALESCE(SUM(propina),0) propinas
       FROM pedido WHERE estado='cobrado' AND date(cerrado_en) BETWEEN ? AND ?`
    ).get(...rango);

    // ---- Comparación con el período ANTERIOR de igual duración (para ver si subís o bajás) ----
    const ms = 86400000;
    const d1 = new Date(desde + 'T00:00:00'), d2 = new Date(hasta + 'T00:00:00');
    const dias = Math.max(1, Math.round((d2 - d1) / ms) + 1);
    const prevHasta = fmtFecha(new Date(d1.getTime() - ms));
    const prevDesde = fmtFecha(new Date(d1.getTime() - dias * ms));
    const prev = db.prepare(
      `SELECT COALESCE(SUM(p.importe),0) total, COUNT(DISTINCT p.pedido_id) tickets
       FROM pago p WHERE date(p.fecha) BETWEEN ? AND ?`
    ).get(prevDesde, prevHasta);
    const comparativa = { desde: prevDesde, hasta: prevHasta, dias, total: prev.total, tickets: prev.tickets };

    res.json({
      desde, hasta, group,
      totales, serie, porMedio, porTipo, porMozo, propinasMozo, porHora, porDiaSemana,
      productos, porCategoria, porGrupo, anulaciones, fiadoCobrado, envio,
      descuentos: extra.descuentos, propinas: extra.propinas, comparativa,
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

    // Viandas que quedaron SIN COBRAR en el período (por fecha en que se tomaron)
    const sinCobrar = db.prepare(
      `SELECT COUNT(*) pedidos, COALESCE(SUM(total),0) total
       FROM pedido WHERE tipo='vianda' AND estado<>'cobrado' AND estado<>'anulado'
         AND date(abierto_en) BETWEEN ? AND ?`
    ).get(...rango);

    res.json({ desde, hasta, totales, serie, porMenu, porEntrega, clientes, porDiaSemana, sinCobrar });
  });

  // ---- Ventas por MÓDULO (Salón mediodía / Viandas / Salón noche / Delivery noche) ----
  app.get('/api/reportes/modulos', (req, res) => {
    const hoy = new Date();
    const desde = req.query.desde || fmtFecha(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    const hasta = req.query.hasta || fmtFecha(hoy);
    let corte = req.query.corte;
    let apertura;
    try { const caja = getConfig().caja || {}; if (!corte) corte = caja.corteNoche; apertura = caja.aperturaMediodia; } catch { /* nada */ }
    corte = corte || '17:00';
    apertura = apertura || '07:00';
    const rango = [desde, hasta];
    // Clasificación de cada venta en un módulo. Se usa la fecha/hora en que se TOMÓ el pedido
    // (abierto_en), NO cuándo se cobró: así un delivery del mediodía cobrado a la noche igual cuenta
    // en el turno que corresponde. El salón y el delivery se parten por la hora de corte.
    // (Viandas es su propio módulo; el delivery se separa en mediodía/noche por el corte.)
    // mediodía SOLO entre apertura (7:00) y corte (17:00); la madrugada (00:00–apertura) es NOCHE.
    const MOD = `CASE
      WHEN o.tipo='vianda' THEN 'Viandas'
      WHEN o.tipo='delivery' AND time(o.abierto_en) >= ? AND time(o.abierto_en) < ? THEN 'Delivery mediodía'
      WHEN o.tipo='delivery' THEN 'Delivery noche'
      WHEN time(o.abierto_en) >= ? AND time(o.abierto_en) < ? THEN 'Salón mediodía'
      ELSE 'Salón noche' END`;
    const totMod = db.prepare(
      `SELECT ${MOD} modulo, COALESCE(SUM(pg.importe),0) total, COUNT(DISTINCT pg.pedido_id) tickets
       FROM pago pg JOIN pedido o ON o.id=pg.pedido_id
       WHERE date(o.abierto_en) BETWEEN ? AND ? GROUP BY modulo ORDER BY total DESC`
    ).all(apertura, corte, apertura, corte, ...rango);
    const filas = db.prepare(
      `SELECT ${MOD} modulo, pg.medio, COALESCE(SUM(pg.importe),0) total, COUNT(*) n
       FROM pago pg JOIN pedido o ON o.id=pg.pedido_id
       WHERE date(o.abierto_en) BETWEEN ? AND ? GROUP BY modulo, pg.medio`
    ).all(apertura, corte, apertura, corte, ...rango);
    const porDia = db.prepare(
      `SELECT date(o.abierto_en) dia, ${MOD} modulo, COALESCE(SUM(pg.importe),0) total
       FROM pago pg JOIN pedido o ON o.id=pg.pedido_id
       WHERE date(o.abierto_en) BETWEEN ? AND ? GROUP BY dia, modulo ORDER BY dia`
    ).all(apertura, corte, apertura, corte, ...rango);
    const totalGeneral = totMod.reduce((a, m) => a + m.total, 0);
    res.json({ desde, hasta, corte, totMod, filas, porDia, totalGeneral });
  });

  // ---- Ranking de mozos del SALÓN (para el premio): total neto + control de anulaciones/descuentos ----
  app.get('/api/reportes/mozos', (req, res) => {
    const hoy = new Date();
    const desde = req.query.desde || fmtFecha(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    const hasta = req.query.hasta || fmtFecha(hoy);
    const rango = [desde, hasta];
    const NOM = "COALESCE(NULLIF(TRIM(o.mozo_nombre),''),'(sin mozo)')";
    // Ventas del salón por mozo (por pago.fecha). El total ya es NETO: si se reabre, se borran los pagos.
    const ventas = db.prepare(
      `SELECT ${NOM} mozo, COALESCE(SUM(pg.importe),0) total, COUNT(DISTINCT pg.pedido_id) tickets
       FROM pago pg JOIN pedido o ON o.id=pg.pedido_id
       WHERE o.tipo='salon' AND date(pg.fecha) BETWEEN ? AND ? GROUP BY mozo`
    ).all(...rango);
    // Propinas y descuentos por mozo (pedidos de salón cobrados)
    const extra = db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(mozo_nombre),''),'(sin mozo)') mozo,
              COALESCE(SUM(propina),0) propinas, COALESCE(SUM(descuento),0) descuentos
       FROM pedido WHERE tipo='salon' AND estado='cobrado' AND date(cerrado_en) BETWEEN ? AND ? GROUP BY mozo`
    ).all(...rango);
    // Anulaciones por mozo (ítems anulados en pedidos de salón) — control anti-trampa
    const anul = db.prepare(
      `SELECT ${NOM} mozo, COUNT(*) n, COALESCE(SUM(i.cantidad*i.precio_unit),0) total
       FROM pedido_item i JOIN pedido o ON o.id=i.pedido_id
       WHERE o.tipo='salon' AND i.estado='anulado' AND date(o.abierto_en) BETWEEN ? AND ? GROUP BY mozo`
    ).all(...rango);
    const mapV = Object.fromEntries(ventas.map((x) => [x.mozo, x]));
    const mapE = Object.fromEntries(extra.map((x) => [x.mozo, x]));
    const mapA = Object.fromEntries(anul.map((x) => [x.mozo, x]));
    const mozos = [...new Set([...ventas.map((v) => v.mozo), ...anul.map((a) => a.mozo)])];
    const ranking = mozos.map((m) => ({
      mozo: m,
      total: mapV[m]?.total || 0,
      tickets: mapV[m]?.tickets || 0,
      propinas: mapE[m]?.propinas || 0,
      descuentos: mapE[m]?.descuentos || 0,
      anulados: mapA[m]?.n || 0,
      anuladoTotal: mapA[m]?.total || 0,
    })).sort((a, b) => b.total - a.total);
    res.json({ desde, hasta, ranking });
  });
}
