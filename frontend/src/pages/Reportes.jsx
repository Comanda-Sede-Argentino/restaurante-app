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

// Chat en lenguaje natural sobre las ventas (la IA consulta los datos reales)
function AsistenteIA() {
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState([]);
  const [cargando, setCargando] = useState(false);
  const enviar = async (texto) => {
    const pregunta = (texto ?? q).trim();
    if (!pregunta || cargando) return;
    setMsgs((m) => [...m, { rol: 'user', texto: pregunta }]);
    setQ(''); setCargando(true);
    try { const r = await api.asistente(pregunta); setMsgs((m) => [...m, { rol: 'ia', texto: r.respuesta }]); }
    catch (e) { setMsgs((m) => [...m, { rol: 'ia', texto: '⚠ No pude responder: ' + e.message }]); }
    finally { setCargando(false); }
  };
  const ejemplos = ['¿Cuánto vendí hoy?', '¿Qué se vendió más esta semana?', '¿Cuánto vendió cada módulo ayer?', '¿Cuántas viandas vendí este mes?', '¿Quién me debe fiado?'];
  return (
    <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>🤖 Asistente — preguntá sobre tus ventas</div>
      {msgs.length > 0 && (
        <div style={{ maxHeight: 340, overflowY: 'auto', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ alignSelf: m.rol === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', padding: '8px 12px', borderRadius: 10, whiteSpace: 'pre-wrap', background: m.rol === 'user' ? 'var(--accent)' : 'var(--panel2)', color: m.rol === 'user' ? '#fff' : 'inherit' }}>
              {m.texto}
            </div>
          ))}
          {cargando && <div style={{ alignSelf: 'flex-start', color: 'var(--muted)' }}>Pensando…</div>}
        </div>
      )}
      {msgs.length === 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {ejemplos.map((e) => <button key={e} className="chip" onClick={() => enviar(e)}>{e}</button>)}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); enviar(); }} style={{ display: 'flex', gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escribí tu pregunta…" style={{ flex: 1 }} disabled={cargando} />
        <button className="btn-accent" type="submit" disabled={cargando || !q.trim()}>Preguntar</button>
      </form>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8, marginBottom: 0 }}>
        Mira tus datos reales. Podés preguntar por hoy, ayer, esta semana, este mes, un producto puntual, quién debe fiado, etc.
      </p>
    </div>
  );
}

export default function Reportes() {
  const [preset, setPreset] = useState('mes');
  const [[desde, hasta], setRango] = useState(rangoPreset('mes'));
  const [group, setGroup] = useState('dia');
  const [d, setD] = useState(null);
  const [vi, setVi] = useState(null);
  const [mod, setMod] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [cierres, setCierres] = useState([]);
  const [cierreAbierto, setCierreAbierto] = useState(null);
  const [grupoProd, setGrupoProd] = useState(''); // filtro de "más/menos vendidos" por grupo ('' = todos)

  const [cierresMod, setCierresMod] = useState([]);   // cierres guardados de delivery/viandas
  const [cmAbierto, setCmAbierto] = useState(null);   // id del cierre de módulo expandido
  const [cmLineas, setCmLineas] = useState({});       // id -> líneas del ticket (desglose)
  useEffect(() => { api.cajaCierres().then(setCierres).catch(() => {}); }, []);
  useEffect(() => { api.cierresModulo().then(setCierresMod).catch(() => {}); }, []);
  const reimprimirCierre = async (c) => {
    try { await api.cajaCierreImprimir(c.id); toast('Cierre #' + c.id + ' enviado a la impresora.'); }
    catch (e) { toast('No se pudo reimprimir: ' + e.message, 'error'); }
  };
  const verDetalleMod = async (c) => {
    if (cmAbierto === c.id) { setCmAbierto(null); return; }
    setCmAbierto(c.id);
    if (!cmLineas[c.id]) {
      try { const r = await api.cierreModulo(c.id); setCmLineas((m) => ({ ...m, [c.id]: r.lineas || [] })); }
      catch { /* nada */ }
    }
  };
  const reimprimirCierreMod = async (c) => {
    try { await api.cierreModuloImprimir(c.id); toast('Cierre enviado a la impresora.'); }
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
    api.reportesViandas(desde, hasta).then(setVi).catch(() => setVi(null));
    api.reportesModulos(desde, hasta).then(setMod).catch(() => setMod(null));
  }, [desde, hasta, group]);

  const PRESETS = [
    ['hoy', 'Hoy'], ['ayer', 'Ayer'], ['ult7', 'Últimos 7'],
    ['ult30', 'Últimos 30'], ['mes', 'Este mes'], ['mespasado', 'Mes pasado'],
  ];
  const GRUPOS = [['', 'Todos'], ['comida', '🍽 Comida'], ['bebidas', '🥤 Bebidas'], ['cafeteria', '☕ Cafetería'], ['otros', '🍴 Fuera de carta']];

  // "Más/menos vendidos" derivados de la lista completa de productos, filtrando por grupo (sin mezclar)
  const prodsFiltrados = ((d && d.productos) || []).filter((p) => !grupoProd || p.grupo === grupoProd);
  const prodTop = [...prodsFiltrados].sort((a, b) => b.cant - a.cant).slice(0, 20);
  const prodBottom = [...prodsFiltrados].sort((a, b) => a.cant - b.cant || a.total - b.total).slice(0, 15);

  return (
    <div>
      <h1 className="h1">📊 Reportes</h1>

      <AsistenteIA />

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

      {/* ---- Ventas por MÓDULO ---- */}
      {mod && mod.totMod?.length > 0 && (() => {
        const ORDER = ['Salón mediodía', 'Viandas', 'Delivery mediodía', 'Salón noche', 'Delivery noche'];
        const nombres = ORDER.filter((n) => mod.totMod.some((m) => m.modulo === n))
          .concat(mod.totMod.map((m) => m.modulo).filter((n) => !ORDER.includes(n)));
        const dias = [...new Set(mod.porDia.map((x) => x.dia))];
        const val = (dia, name) => mod.porDia.find((x) => x.dia === dia && x.modulo === name)?.total || 0;
        const totDe = (name) => mod.totMod.find((m) => m.modulo === name)?.total || 0;
        const medioDe = (name) => mod.filas.filter((f) => f.modulo === name).sort((a, b) => b.total - a.total);
        return (
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <h2 className="h2" style={{ margin: 0 }}>🧩 Ventas por módulo</h2>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>corte salón mediodía/noche: {mod.corte}</span>
              <span className="spacer" />
              <button onClick={() => descargarCSV(`modulos_${desde}_a_${hasta}.csv`,
                [['Día', ...nombres, 'Total'], ...dias.map((dia) => [dia, ...nombres.map((n) => val(dia, n)), nombres.reduce((a, n) => a + val(dia, n), 0)])])}>⬇ CSV</button>
            </div>
            <div className="kpis" style={{ marginBottom: 10 }}>
              {nombres.map((n) => (
                <div className="kpi" key={n}><div className="v">{money(totDe(n))}</div><div className="l">{n}</div></div>
              ))}
              <div className="kpi" style={{ borderColor: 'var(--green)' }}><div className="v">{money(mod.totalGeneral)}</div><div className="l">TOTAL</div></div>
            </div>

            {/* Desglose por forma de pago dentro de cada módulo */}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10, marginBottom: 10 }}>
              {nombres.map((n) => (
                <div key={n} style={{ background: 'var(--panel2)', borderRadius: 6, padding: 8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{n}</div>
                  {medioDe(n).map((f) => (
                    <div key={f.medio} className="cart-item" style={{ fontSize: 13 }}>
                      <span style={{ flex: 1 }}>{f.medio} ({f.n})</span><b>{money(f.total)}</b>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Por día */}
            {dias.length > 1 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', color: 'var(--muted)' }}>Día</th>
                      {nombres.map((n) => <th key={n} style={{ textAlign: 'right', color: 'var(--muted)' }}>{n}</th>)}
                      <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dias.map((dia) => (
                      <tr key={dia}>
                        <td>{dia}</td>
                        {nombres.map((n) => <td key={n} style={{ textAlign: 'right' }}>{val(dia, n) ? money(val(dia, n)) : '—'}</td>)}
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(nombres.reduce((a, n) => a + val(dia, n), 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {d && (
        <>
          {/* KPIs */}
          {(() => {
            const prev = d.comparativa?.total || 0;
            const delta = prev > 0 ? Math.round((d.totales.total - prev) / prev * 100) : null;
            return (
              <div className="kpis" style={{ marginBottom: 14 }}>
                <div className="kpi">
                  <div className="v">{money(d.totales.total)}</div>
                  <div className="l">Ventas del período</div>
                  {delta != null && (
                    <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3, color: delta >= 0 ? 'var(--green)' : '#e5484d' }}>
                      {delta >= 0 ? '▲ +' : '▼ '}{delta}% vs período anterior
                    </div>
                  )}
                </div>
                <div className="kpi"><div className="v">{d.totales.tickets}</div><div className="l">Tickets</div></div>
                <div className="kpi"><div className="v">{money(d.totales.ticketPromedio)}</div><div className="l">Ticket promedio</div></div>
                {d.propinas > 0 && <div className="kpi"><div className="v">{money(d.propinas)}</div><div className="l">Propinas</div></div>}
                {d.descuentos > 0 && <div className="kpi"><div className="v" style={{ color: 'var(--orange)' }}>{money(d.descuentos)}</div><div className="l">Descuentos</div></div>}
                {d.fiadoCobrado?.total > 0 && (
                  <div className="kpi"><div className="v">{money(d.fiadoCobrado.total)}</div><div className="l">Cobros de fiado ({d.fiadoCobrado.n})</div></div>
                )}
                {d.anulaciones?.n > 0 && (
                  <div className="kpi"><div className="v" style={{ color: 'var(--orange)' }}>{money(d.anulaciones.total)}</div><div className="l">Anulado ({d.anulaciones.n} ítems)</div></div>
                )}
              </div>
            );
          })()}

          {/* Resumen inteligente */}
          {(() => {
            const fdia = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s.slice(8, 10) + '/' + s.slice(5, 7) : s;
            const serie = d.serie || [];
            const mejor = serie.reduce((a, x) => (x.total > (a?.total || 0) ? x : a), null);
            const dowTop = (d.porDiaSemana || []).reduce((a, x) => (x.total > (a?.total || 0) ? x : a), null);
            const horaTop = (d.porHora || []).reduce((a, x) => (x.total > (a?.total || 0) ? x : a), null);
            const efectivo = (d.porMedio || []).find((m) => /EFECTIVO/i.test(m.medio));
            const pctEfvo = d.totales.total ? Math.round((efectivo?.total || 0) / d.totales.total * 100) : 0;
            if (!serie.length) return null;
            const items = [];
            if (mejor) items.push(['📈 Mejor día', fdia(mejor.periodo) + ' · ' + money(mejor.total)]);
            if (dowTop) items.push(['📅 Día más fuerte', DIAS[Number(dowTop.dow)] + ' · ' + money(dowTop.total)]);
            if (horaTop) items.push(['🕐 Hora pico', horaTop.hora + ':00 · ' + money(horaTop.total)]);
            items.push(['💵 En efectivo', pctEfvo + '%']);
            return (
              <div className="card" style={{ marginBottom: 14 }}>
                <h2 className="h2" style={{ marginTop: 0 }}>💡 Resumen del período</h2>
                <div className="kpis" style={{ marginBottom: 0 }}>
                  {items.map(([l, v]) => (
                    <div className="kpi" key={l}><div className="v" style={{ fontSize: 19 }}>{v}</div><div className="l">{l}</div></div>
                  ))}
                </div>
              </div>
            );
          })()}

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

            {/* Filtro de grupo para las listas de productos (para que no se mezclen) */}
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ color: 'var(--muted)' }}>Más/menos vendidos —</b>
                {GRUPOS.map(([k, l]) => (
                  <span key={k} className={'chip' + (grupoProd === k ? ' active' : '')} onClick={() => setGrupoProd(k)}>{l}</span>
                ))}
              </div>
            </div>

            {/* Top productos */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <h2 className="h2" style={{ margin: 0 }}>Más vendidos{grupoProd ? ' · ' + (GRUPOS.find(([k]) => k === grupoProd)?.[1] || '') : ''}</h2>
                <span className="spacer" />
                <button onClick={() => descargarCSV(`top_productos_${grupoProd || 'todos'}_${desde}_a_${hasta}.csv`,
                  [['Producto', 'Grupo', 'Cantidad', 'Total'], ...prodTop.map((p) => [p.nombre, p.grupo, p.cant, p.total])])}>⬇ CSV</button>
              </div>
              {!prodTop.length && <p style={{ color: 'var(--muted)' }}>Sin ventas de productos en el período.</p>}
              <table style={{ width: '100%' }}>
                <tbody>
                  {prodTop.map((p, i) => (
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
              <h2 className="h2">Los que menos salen{grupoProd ? ' · ' + (GRUPOS.find(([k]) => k === grupoProd)?.[1] || '') : ''}</h2>
              {!prodBottom.length && <p style={{ color: 'var(--muted)' }}>Sin datos.</p>}
              <table style={{ width: '100%' }}>
                <tbody>
                  {prodBottom.map((p, i) => (
                    <tr key={i}>
                      <td>{p.nombre}</td>
                      <td style={{ textAlign: 'right' }}><b>{p.cant}</b></td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{money(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Por grupo: Comida / Bebidas / Cafetería */}
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <h2 className="h2">🍽 Comida · 🥤 Bebidas · ☕ Cafetería</h2>
              {(() => {
                const GR = [{ k: 'comida', l: '🍽 Comida' }, { k: 'bebidas', l: '🥤 Bebidas' }, { k: 'cafeteria', l: '☕ Cafetería' }];
                const find = (k) => (d.porGrupo || []).find((g) => g.grupo === k) || { total: 0, cant: 0 };
                const otros = find('otros');
                const lista = otros.total > 0 ? [...GR, { k: 'otros', l: '🍴 Fuera de carta' }] : GR;
                return (
                  <div className="kpis" style={{ marginBottom: 0 }}>
                    {lista.map((g) => { const x = find(g.k); return (
                      <div className="kpi" key={g.k}><div className="v">{money(x.total)}</div><div className="l">{g.l} · {x.cant || 0} u.</div></div>
                    ); })}
                    {d.envio > 0 && <div className="kpi"><div className="v">{money(d.envio)}</div><div className="l">🛵 Envíos</div></div>}
                  </div>
                );
              })()}
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

      {/* ---- Reporte de VIANDAS (solo si hubo viandas en el período) ---- */}
      {vi && vi.totales?.pedidos > 0 && (
        <div style={{ marginTop: 18 }}>
          <h2 className="h2" style={{ marginBottom: 10 }}>🍱 Viandas del mediodía</h2>
          <div className="kpis" style={{ marginBottom: 14 }}>
            <div className="kpi"><div className="v">{vi.totales.viandas}</div><div className="l">Viandas vendidas</div></div>
            <div className="kpi"><div className="v">{vi.totales.pedidos}</div><div className="l">Pedidos</div></div>
            <div className="kpi"><div className="v">{money(vi.totales.total)}</div><div className="l">Total vendido</div></div>
            <div className="kpi"><div className="v">{money(vi.totales.ticketPromedio)}</div><div className="l">Ticket promedio</div></div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            {/* Ranking de menús */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <h2 className="h2" style={{ margin: 0 }}>Menús más pedidos</h2>
                <span className="spacer" />
                <button onClick={() => descargarCSV(`viandas_menus_${desde}_a_${hasta}.csv`,
                  [['Menú', 'Cantidad', 'Total', 'Días'], ...vi.porMenu.map((m) => [m.nombre, m.cantidad, m.total, m.dias])])}>⬇ CSV</button>
              </div>
              {!vi.porMenu.length && <p style={{ color: 'var(--muted)' }}>Sin datos.</p>}
              <table style={{ width: '100%' }}>
                <tbody>
                  {vi.porMenu.map((m, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--muted)', width: 24 }}>{i + 1}</td>
                      <td>{m.nombre} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({m.dias} día{m.dias !== 1 ? 's' : ''})</span></td>
                      <td style={{ textAlign: 'right' }}><b>{m.cantidad}</b></td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{money(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Viandas por día */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <h2 className="h2" style={{ margin: 0 }}>Viandas por día</h2>
                <span className="spacer" />
                <button onClick={() => descargarCSV(`viandas_por_dia_${desde}_a_${hasta}.csv`,
                  [['Día', 'Viandas', 'Pedidos', 'Total'], ...vi.serie.map((s) => [s.dia, s.viandas, s.pedidos, s.total])])}>⬇ CSV</button>
              </div>
              <Barras datos={vi.serie} label={(s) => s.dia?.slice(5)} valor={(s) => s.viandas} fmtVal={(s) => s.viandas + ' · ' + money(s.total)} />
            </div>

            {/* Domicilio vs retiro */}
            <div className="card">
              <h2 className="h2">Domicilio vs retiro</h2>
              {vi.porEntrega.map((e) => (
                <div key={e.entrega} className="cart-item">
                  <span style={{ flex: 1, textTransform: 'capitalize' }}>{e.entrega === 'retiro' ? '🏪 Retira' : '🛵 A domicilio'} <span style={{ color: 'var(--muted)', fontSize: 12 }}>({e.pedidos})</span></span>
                  <b>{money(e.total)}</b>
                </div>
              ))}
            </div>

            {/* Por día de la semana */}
            <div className="card">
              <h2 className="h2">Por día de la semana</h2>
              <Barras datos={vi.porDiaSemana} label={(x) => DIAS[Number(x.dow)]?.slice(0, 3) || x.dow} valor={(x) => x.viandas} fmtVal={(x) => x.viandas + ' · ' + money(x.total)} />
            </div>

            {/* Clientes que más compran */}
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <h2 className="h2" style={{ margin: 0 }}>Clientes que más compran</h2>
                <span className="spacer" />
                <button onClick={() => descargarCSV(`viandas_clientes_${desde}_a_${hasta}.csv`,
                  [['Cliente', 'Teléfono', 'Pedidos', 'Total', 'Última'], ...vi.clientes.map((c) => [c.cliente, c.telefono, c.pedidos, c.total, c.ultima])])}>⬇ CSV</button>
              </div>
              {!vi.clientes.length && <p style={{ color: 'var(--muted)' }}>Sin datos.</p>}
              <table style={{ width: '100%' }}>
                <tbody>
                  {vi.clientes.map((c, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--muted)', width: 24 }}>{i + 1}</td>
                      <td>{c.cliente}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{c.telefono || ''}</td>
                      <td style={{ textAlign: 'right' }}><b>{c.pedidos}</b> ped.</td>
                      <td style={{ textAlign: 'right' }}>{money(c.total)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--muted)', fontSize: 12 }}>{c.ultima}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
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

      {/* Cierres de delivery y viandas anteriores */}
      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="h2">🛵🍱 Cierres de delivery y viandas</h2>
        {!cierresMod.length && <p style={{ color: 'var(--muted)' }}>Todavía no hay cierres de delivery/viandas guardados.</p>}
        {cierresMod.map((c) => {
          const abierto = cmAbierto === c.id;
          const icono = c.modulo === 'vianda' ? '🍱 Viandas' : '🛵 Delivery';
          return (
            <div key={c.id} style={{ borderBottom: '1px solid var(--panel2)', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <b>{icono}</b>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{c.fecha}</span>
                <span className="spacer" />
                <span>Total: <b>{money(c.total)}</b></span>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{c.tickets} ticket(s)</span>
                <button onClick={() => verDetalleMod(c)}>{abierto ? 'Ocultar' : 'Ver desglose'}</button>
                <button className="btn-blue" onClick={() => reimprimirCierreMod(c)}>🖨 Reimprimir</button>
              </div>
              {abierto && (
                <pre style={{ marginTop: 8, fontSize: 12, color: 'var(--text)', background: 'var(--panel2)', padding: 10, borderRadius: 8, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                  {(cmLineas[c.id] || []).map((l) => (typeof l === 'object' ? (l.t ?? '') : l)).join('\n') || 'Cargando…'}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
