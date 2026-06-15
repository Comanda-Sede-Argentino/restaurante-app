import { useEffect, useState } from 'react';
import { api, socket, money } from '../api';

export default function Dashboard() {
  const [d, setD] = useState(null);

  useEffect(() => {
    api.dashboard().then(setD);
    const on = (data) => setD(data);
    socket.on('dashboard:update', on);
    const tick = setInterval(() => api.dashboard().then(setD), 15000);
    return () => { socket.off('dashboard:update', on); clearInterval(tick); };
  }, []);

  if (!d) return <p>Cargando...</p>;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 className="h1" style={{ margin: 0 }}>Monitoreo en tiempo real</h1>
        <span className="dot" /> <span style={{ color: 'var(--muted)', fontSize: 13 }}>en vivo</span>
      </div>
      <div className="kpis" style={{ marginTop: 14 }}>
        <div className="kpi"><div className="v">{money(d.ventasHoy)}</div><div className="l">Ventas de hoy</div></div>
        <div className="kpi"><div className="v">{d.tickets}</div><div className="l">Tickets</div></div>
        <div className="kpi"><div className="v">{money(d.ticketPromedio)}</div><div className="l">Ticket promedio</div></div>
        <div className="kpi"><div className="v">{d.mesasOcupadas}/{d.mesasTotal}</div><div className="l">Mesas ocupadas</div></div>
        <div className="kpi"><div className="v">{d.enCocina}</div><div className="l">Ítems en cocina</div></div>
        <div className="kpi"><div className="v">{d.pedidosAbiertos}</div><div className="l">Pedidos abiertos</div></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
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
