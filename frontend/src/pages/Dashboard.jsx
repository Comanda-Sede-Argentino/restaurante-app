import { useEffect, useState } from 'react';
import { api, socket, money } from '../api';

export default function Dashboard() {
  const [d, setD] = useState(null);

  useEffect(() => {
    api.dashboard().then(setD);
    const on = (data) => setD(data);
    const reload = () => api.dashboard().then(setD);
    socket.on('dashboard:update', on);
    socket.on('connect', reload);
    const tick = setInterval(reload, 15000);
    return () => { socket.off('dashboard:update', on); socket.off('connect', reload); clearInterval(tick); };
  }, []);

  if (!d) return <p>Cargando...</p>;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 className="h1" style={{ margin: 0 }}>Monitoreo en tiempo real</h1>
        <span className="dot" /> <span style={{ color: 'var(--muted)', fontSize: 13 }}>en vivo</span>
      </div>
      {d.faltantes?.length > 0 && (
        <div className="card" style={{ marginTop: 14, borderColor: 'var(--orange)' }}>
          <b style={{ color: 'var(--orange)' }}>🛒 Faltan insumos ({d.faltantes.length}):</b>{' '}
          {d.faltantes.map((f) => `${f.nombre} (${f.stock} ${f.unidad})`).join(' · ')}
        </div>
      )}
      {d.demoradas > 0 && (
        <div className="card" style={{ marginTop: 14, borderColor: '#e5484d' }}>
          <b style={{ color: '#e5484d' }}>⏱ {d.demoradas} comanda(s) demorada(s)</b>
          <span style={{ color: 'var(--muted)' }}> — esperando hace más de 15 min en cocina.</span>
        </div>
      )}
      <div className="kpis" style={{ marginTop: 14 }}>
        <div className="kpi"><div className="v">{money(d.ventasHoy)}</div><div className="l">Ventas de hoy</div></div>
        <div className="kpi"><div className="v">{d.tickets}</div><div className="l">Tickets</div></div>
        <div className="kpi"><div className="v">{money(d.ticketPromedio)}</div><div className="l">Ticket promedio</div></div>
        <div className="kpi"><div className="v">{d.mesasOcupadas}/{d.mesasTotal}</div><div className="l">Mesas ocupadas</div></div>
        <div className="kpi"><div className="v">{d.enCocina}</div><div className="l">Ítems en cocina</div></div>
        <div className="kpi"><div className="v">{d.pedidosAbiertos}</div><div className="l">Pedidos abiertos</div></div>
        {d.deudaFiado > 0 && (
          <div className="kpi"><div className="v" style={{ color: 'var(--orange)' }}>{money(d.deudaFiado)}</div><div className="l">Deuda de fiado</div></div>
        )}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h2 className="h2">🛵 Próximas entregas (delivery)</h2>
          {!d.entregas?.length && <p style={{ color: 'var(--muted)' }}>No hay deliveries en curso.</p>}
          <table>
            <tbody>
              {d.entregas?.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontWeight: 700, color: e.hora_entrega ? 'var(--accent)' : 'var(--muted)' }}>{e.hora_entrega || '—'}</td>
                  <td>{e.cliente_nombre || 'Cliente'}<div style={{ color: 'var(--muted)', fontSize: 12 }}>{e.cliente_direccion || ''}</div></td>
                  <td style={{ textAlign: 'right' }}>{money(e.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="h2">💳 Ventas de hoy por medio</h2>
          {!d.ventasMedio?.length && <p style={{ color: 'var(--muted)' }}>Sin cobros hoy.</p>}
          <table>
            <tbody>
              {d.ventasMedio?.map((m) => (
                <tr key={m.medio}><td>{m.medio}</td><td style={{ textAlign: 'right' }}><b>{money(m.total)}</b></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start', marginTop: 16 }}>
        <div className="card">
          <h2 className="h2">Más vendidos hoy</h2>
          {!d.topPlatos.length && <p style={{ color: 'var(--muted)' }}>Sin ventas aún.</p>}
          <table>
            <tbody>
              {d.topPlatos.map((p, i) => (
                <tr key={i}><td>{p.nombre}</td><td style={{ textAlign: 'right' }}><b>{p.cant}</b></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="h2">Carga por sector de cocina</h2>
          {!d.porSector.length && <p style={{ color: 'var(--muted)' }}>Cocina al día. 🎉</p>}
          <table>
            <tbody>
              {d.porSector.map((s, i) => (
                <tr key={i}><td>{s.sector || '—'}</td><td style={{ textAlign: 'right' }}><span className="badge warn">{s.c} ítems</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
