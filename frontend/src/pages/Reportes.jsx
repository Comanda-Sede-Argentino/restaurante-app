import { useEffect, useState } from 'react';
import { api, money } from '../api';
import { toast } from '../ui.jsx';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Fecha local -> 'YYYY-MM-DD'
const fmt = (d) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

// Presets de rango de fechas
function rangoPreset(p) {
  const hoy = new Date();
  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (p === 'hoy') return [fmt(ini), fmt(ini)];
  if (p === 'ayer') { const a = new Date(ini); a.setDate(a.getDate() - 1); return [fmt(a), fmt(a)]; }
  if (p === 'ult7') { const a = new Date(ini); a.setDate(a.getDate() - 6); return [fmt(a), fmt(ini)]; }
  if (p === 'ult30') { const a = new Date(ini); a.setDate(a.getDate() - 29); return [fmt(a), fmt(ini)]; }
  if (p === 'mes') return [fmt(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), fmt(ini)];
  if (p === 'mespasado') {
    const d1 = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const d2 = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    return [fmt(d1), fmt(d2)];
  }
  return [fmt(ini), fmt(ini)];
}

// Descarga un CSV (separador ; y BOM para que Excel en español respete acentos)
function descargarCSV(nombre, filas) {
  const csv = filas.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}

// Barras horizontales simples, sin librerías
function Barras({ datos, label, valor, fmtVal }) {
  const max = Math.max(1, ...datos.map(valor));
  if (!datos.length) return <p style={{ color: 'var(--muted)' }}>Sin datos en el período.</p>;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {datos.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 90, fontSize: 13, textAlign: 'right', color: 'var(--muted)' }}>{label(d)}</span>
          <div style={{ flex: 1, background: 'var(--bg, #1e293b)', borderRadius: 6, overflow: 'hidden', height: 22 }}>
            <div style={{ width: Math.round((valor(d) / max) * 100) + '%', minWidth: valor(d) > 0 ? 2 : 0, background: 'var(--accent)', height: '100%' }} />
          </div>
          <span style={{ width: 110, fontSize: 13, textAlign: 'right', fontWeight: 700 }}>{fmtVal(d)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Reportes() {
  const [preset, setPreset] = useState('mes');
  const [[desde, hasta], setRango] = useState(rangoPreset('mes'));
  const [group, setGroup] = useState('dia');
  const [d, setD] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [cierres, setCierres] = useState([]);
  const [cierreAbierto, setCierreAbierto] = useState(null);

  useEffect(() => { api.cajaCierres().then(setCierres).catch(() => {}); }, []);
  const reimprimirCierre = async (c) => {
    try { await api.cajaCierreImprimir(c.id); toast('Cierre #' + c.id + ' enviado a la impresora.'); }
    catch (e) { toast('No se pudo reimprimir: ' + e.message, 'error'); }
  };

  const aplicarPreset = (p) => { setPreset(p); if (p !== 'custom') setRango(rangoPreset(p)); };

  useEffect(() => {
    if (desde > hasta) { setError('La fecha "desde" es posterior a "hasta".'); return; }
    setError(''); setCargando(true);
    api.reportes(desde, hasta, group)
      .then(setD)
      .catch((e) => setError('No se pudieron cargar los reportes: ' + e.message))
      .finally(() => setCargando(false));
  }, [desde, hasta, group]);

  const PRESETS = [
    ['hoy', 'Hoy'], ['ayer', 'Ayer'], ['ult7', 'Últimos 7'],
    ['ult30', 'Últimos 30'], ['mes', 'Este mes'], ['mespasado', 'Mes pasado'],
  ];

  return (
    <div>
      <h1 className="h1">📊 Reportes</h1>

      {/* Controles de período */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {PRESETS.map(([k, t]) => (
            <div key={k} className={'chip' + (preset === k ? ' active' : '')} onClick={() => aplicarPreset(k)}>{t}</div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ color: 'var(--muted)', fontSize: 13 }}>Desde
            <input type="date" value={desde} max={hasta}
              onChange={(e) => { setPreset('custom'); setRango([e.target.value, hasta]); }}
              style={{ display: 'block', marginTop: 4 }} />
          </label>
          <label style={{ color: 'var(--muted)', fontSize: 13 }}>Hasta
            <input type="date" value={hasta} min={desde}
              onChange={(e) => { setPreset('custom'); setRango([desde, e.target.value]); }}
              style={{ display: 'block', marginTop: 4 }} />
          </label>
          <label style={{ color: 'var(--muted)', fontSize: 13 }}>Agrupar ventas por
            <select value={group} onChange={(e) => setGroup(e.target.value)} style={{ display: 'block', marginTop: 4 }}>
              <option value="dia">Día</option>
              <option value="semana">Semana</option>
              <option value="mes">Mes</option>
            </select>
          </label>
          {cargando && <span style={{ color: 'var(--muted)' }}>Cargando…</span>}
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--orange)', color: 'var(--orange)', marginBottom: 14 }}>{error}</div>}

      {d && (
        <>
          {/* KPIs */}
          <div className="kpis" style={{ marginBottom: 14 }}>
            <div className="kpi"><div className="v">{money(d.totales.total)}</div><div className="l">Ventas del período</div></div>
            <div className="kpi"><div className="v">{d.totales.tickets}</div><div className="l">Tickets</div></div>
            <div className="kpi"><div className="v">{money(d.totales.ticketPromedio)}</div><div className="l">Ticket promedio</div></div>
            {d.fiadoCobrado?.total > 0 && (
              <div className="kpi"><div className="v">{money(d.fiadoCobrado.total)}</div><div className="l">Cobros de fiado ({d.fiadoCobrado.n})</div></div>
            )}
            {d.anulaciones?.n > 0 && (
              <div className="kpi"><div className="v" style={{ color: 'var(--orange)' }}>{money(d.anulaciones.total)}</div><div className="l">Anulado ({d.anulaciones.n} ítems)</div></div>
            )}
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            {/* Ventas en el tiempo */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <h2 className="h2" style={{ margin: 0 }}>Ventas por {group === 'dia' ? 'día' : group}</h2>
                <span className="spacer" />
                <button onClick={() => descargarCSV(`ventas_${desde}_a_${hasta}.csv`,
                  [['Período', 'Total', 'Tickets'], ...d.serie.map((s) => [s.periodo, s.total, s.tickets])])}>⬇ CSV</button>
              </div>
              <Barras datos={d.serie} label={(s) => s.periodo} valor={(s) => s.total} fmtVal={(s) => money(s.total)} />
            </div>

            {/* Medios de pago */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <h2 className="h2" style={{ margin: 0 }}>Por medio de pago</h2>
                <span className="spacer" />
                <button onClick={() => descargarCSV(`medios_pago_${desde}_a_${hasta}.csv`,
                  [['Medio', 'Total', 'Operaciones'], ...d.porMedio.map((m) => [m.medio, m.total, m.n])])}>⬇ CSV</button>
              </div>
              {!d.porMedio.length && <p style={{ color: 'var(--muted)' }}>Sin cobros en el período.</p>}
              {d.porMedio.map((m) => (
                <div key={m.medio} className="cart-item">
                  <span style={{ flex: 1 }}>{m.medio} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({m.n})</span></span>
                  <span style={{ color: 'var(--muted)', fontSize: 12, marginRight: 8 }}>
                    {d.totales.total ? Math.round((m.total / d.totales.total) * 100) : 0}%
                  </span>
                  <b>{money(m.total)}</b>
                </div>
              ))}
            </div>

            {/* Por tipo */}
            <div className="card">
              <h2 className="h2">Por tipo de pedido</h2>
              {!d.porTipo.length && <p style={{ color: 'var(--muted)' }}>Sin datos.</p>}
              {d.porTipo.map((t) => (
                <div key={t.tipo} className="cart-item">
                  <span style={{ flex: 1, textTransform: 'capitalize' }}>{t.tipo} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({t.tickets})</span></span>
                  <b>{money(t.total)}</b>
                </div>
              ))}
            </div>

            {/* Por mozo */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <h2 className="h2" style={{ margin: 0 }}>Ventas por mozo</h2>
                <span className="spacer" />
                <button onClick={() => descargarCSV(`por_mozo_${desde}_a_${hasta}.csv`,
                  [['Mozo', 'Total', 'Tickets'], ...d.porMozo.map((m) => [m.mozo, m.total, m.tickets])])}>⬇ CSV</button>
              </div>
              {!d.porMozo.length && <p style={{ color: 'var(--muted)' }}>Sin datos.</p>}
              {d.porMozo.map((m) => (
                <div key={m.mozo} className="cart-item">
                  <span style={{ flex: 1 }}>{m.mozo} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({m.tickets})</span></span>
                  <b>{money(m.total)}</b>
                </div>
              ))}
            </div>

            {/* Propinas por mozo */}
            <div className="card">
              <h2 className="h2">💵 Propinas por mozo</h2>
              {!d.propinasMozo?.length && <p style={{ color: 'var(--muted)' }}>Sin propinas registradas en el período.</p>}
              {d.propinasMozo?.map((m) => (
                <div key={m.mozo} className="cart-item">
                  <span style={{ flex: 1 }}>{m.mozo}</span>
                  <b style={{ color: 'var(--green)' }}>{money(m.total)}</b>
                </div>
              ))}
              {d.propinasMozo?.length > 0 && (
                <div className="total-row"><span>Total propinas</span><span>{money(d.propinasMozo.reduce((a, m) => a + m.total, 0))}</span></div>
              )}
            </div>

            {/* Top productos */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <h2 className="h2" style={{ margin: 0 }}>Más vendidos</h2>
                <span className="spacer" />
                <button onClick={() => descargarCSV(`top_productos_${desde}_a_${hasta}.csv`,
                  [['Producto', 'Cantidad', 'Total'], ...d.productosTop.map((p) => [p.nombre, p.cant, p.total])])}>⬇ CSV</button>
              </div>
              {!d.productosTop.length && <p style={{ color: 'var(--muted)' }}>Sin ventas de productos en el período.</p>}
              <table style={{ width: '100%' }}>
                <tbody>
                  {d.productosTop.map((p, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--muted)', width: 24 }}>{i + 1}</td>
                      <td>{p.nombre}</td>
                      <td style={{ textAlign: 'right' }}><b>{p.cant}</b></td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{money(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Productos que menos salen */}
            <div className="card">
              <h2 className="h2">Los que menos salen</h2>
              {!d.productosBottom.length && <p style={{ color: 'var(--muted)' }}>Sin datos.</p>}
              <table style={{ width: '100%' }}>
                <tbody>
                  {d.productosBottom.map((p, i) => (
                    <tr key={i}>
                      <td>{p.nombre}</td>
                      <td style={{ textAlign: 'right' }}><b>{p.cant}</b></td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{money(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Por categoría */}
            <div className="card">
              <h2 className="h2">Por categoría</h2>
              {!d.porCategoria.length && <p style={{ color: 'var(--muted)' }}>Sin datos.</p>}
              <Barras datos={d.porCategoria} label={(c) => c.categoria} valor={(c) => c.total} fmtVal={(c) => money(c.total)} />
            </div>

            {/* Por día de la semana */}
            <div className="card">
              <h2 className="h2">Por día de la semana</h2>
              <Barras
                datos={d.porDiaSemana}
                label={(x) => DIAS[Number(x.dow)]?.slice(0, 3) || x.dow}
                valor={(x) => x.total}
                fmtVal={(x) => money(x.total)}
              />
            </div>

            {/* Por horario (ancho completo) */}
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <h2 className="h2">Por horario del día</h2>
              <Barras
                datos={d.porHora}
                label={(x) => x.hora + ':00'}
                valor={(x) => x.total}
                fmtVal={(x) => money(x.total)}
              />
            </div>
          </div>
        </>
      )}

      {/* Cierres de caja anteriores */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="h2">🔒 Cierres de caja anteriores</h2>
        {!cierres.length && <p style={{ color: 'var(--muted)' }}>Todavía no hay cierres registrados.</p>}
        {cierres.map((c) => {
          let det = {}; try { det = JSON.parse(c.detalle || '{}'); } catch { /* nada */ }
          const abierto = cierreAbierto === c.id;
          return (
            <div key={c.id} style={{ borderBottom: '1px solid var(--panel2)', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b>Cierre #{c.id}</b>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{c.hasta}</span>
                <span className="spacer" />
                <span>Total: <b>{money(c.total)}</b></span>
                {c.diferencia != null && c.diferencia !== 0 && (
                  <span style={{ color: c.diferencia > 0 ? 'var(--accent)' : '#e5484d' }}>
                    {c.diferencia > 0 ? `sobró ${money(c.diferencia)}` : `faltó ${money(-c.diferencia)}`}
                  </span>
                )}
                <button onClick={() => setCierreAbierto(abierto ? null : c.id)}>{abierto ? 'Ocultar' : 'Detalle'}</button>
                <button className="btn-blue" onClick={() => reimprimirCierre(c)}>🖨 Reimprimir</button>
              </div>
              {abierto && (
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  <div style={{ color: 'var(--muted)' }}>Período: {c.desde} → {c.hasta}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 6 }}>
                    {(det.ventas || []).map((m) => (
                      <div key={m.medio} className="cart-item"><span style={{ flex: 1 }}>{m.medio}</span><b>{money(m.total)}</b></div>
                    ))}
                  </div>
                  <div className="cart-item"><span style={{ flex: 1 }}>Fondo</span><b>{money(c.fondo)}</b></div>
                  <div className="cart-item"><span style={{ flex: 1 }}>Egresos</span><b>{money(c.egresos)}</b></div>
                  <div className="cart-item"><span style={{ flex: 1 }}>Efectivo esperado</span><b>{money(c.esperado)}</b></div>
                  {c.contado != null && <div className="cart-item"><span style={{ flex: 1 }}>Contado</span><b>{money(c.contado)}</b></div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
