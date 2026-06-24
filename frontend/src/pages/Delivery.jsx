import { useEffect, useState } from 'react';
import { api, socket, money } from '../api';
import OrderTaker from '../components/OrderTaker.jsx';

export default function Delivery() {
  const [pedido, setPedido] = useState(null);
  const [cli, setCli] = useState({ cliente_nombre: '', cliente_telefono: '', cliente_direccion: '', hora_entrega: '' });
  const [activos, setActivos] = useState([]);

  const cargarActivos = () =>
    api.pedidos().then((ps) => setActivos(ps.filter((p) => p.tipo === 'delivery')));

  useEffect(() => {
    cargarActivos();
    const reload = () => cargarActivos();
    socket.on('pedido:nuevo', reload);
    socket.on('pedido:actualizado', reload);
    socket.on('pedido:cobrado', reload);
    return () => {
      socket.off('pedido:nuevo', reload);
      socket.off('pedido:actualizado', reload);
      socket.off('pedido:cobrado', reload);
    };
  }, []);

  const crear = async () => {
    if (!cli.cliente_nombre.trim()) return alert('Ingresá al menos el nombre del cliente.');
    const p = await api.crearPedido({ tipo: 'delivery', mozo_nombre: 'Delivery', ...cli });
    setPedido(await api.pedido(p.id));
  };

  const abrir = async (id) => setPedido(await api.pedido(id));
  const refrescar = async () => { if (pedido) setPedido(await api.pedido(pedido.id)); cargarActivos(); };
  const setHora = async (hora) => {
    setPedido((p) => ({ ...p, hora_entrega: hora }));
    await api.actualizarPedido(pedido.id, { hora_entrega: hora });
  };

  const cobrar = async () => {
    const p = await api.pedido(pedido.id);
    await api.pagar(p.id, [{ medio: 'EFECTIVO', importe: p.total }]);
    setPedido(null);
    setCli({ cliente_nombre: '', cliente_telefono: '', cliente_direccion: '' });
    cargarActivos();
  };

  if (pedido) {
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={() => { setPedido(null); cargarActivos(); }}>← Delivery</button>
          <h1 className="h1" style={{ margin: 0 }}>🛵 {pedido.cliente_nombre || 'Delivery'} #{pedido.id}</h1>
          <span className="spacer" />
          {pedido.total > 0 && <button className="btn-green" onClick={cobrar}>💵 Cobrar {money(pedido.total)}</button>}
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 10 }}>
            📞 {pedido.cliente_telefono || '—'} &nbsp;·&nbsp; 📍 {pedido.cliente_direccion || '—'}
          </div>
          <label>🕒 Hora de entrega: </label>
          <input type="time" value={pedido.hora_entrega || ''} onChange={(e) => setHora(e.target.value)} />
        </div>
        {pedido.items?.length > 0 && (
          <div className="card" style={{ marginBottom: 12 }}>
            {pedido.items.map((i) => (
              <div key={i.id} className="cart-item">
                <span style={{ flex: 1 }}>{i.cantidad}× {i.nombre} {i.observacion ? `(${i.observacion})` : ''}</span>
                <span className="badge warn">{i.estado}</span>
                <span>{money(i.cantidad * i.precio_unit)}</span>
              </div>
            ))}
          </div>
        )}
        <OrderTaker pedido={pedido} onEnviado={refrescar} />
      </div>
    );
  }

  return (
    <div>
      <h1 className="h1">Delivery</h1>
      <div className="grid" style={{ gridTemplateColumns: '360px 1fr', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <h2 className="h2">Nuevo pedido de delivery</h2>
          <div className="grid" style={{ gap: 10 }}>
            <input placeholder="Nombre del cliente *" value={cli.cliente_nombre}
              onChange={(e) => setCli({ ...cli, cliente_nombre: e.target.value })} />
            <input placeholder="Teléfono" value={cli.cliente_telefono}
              onChange={(e) => setCli({ ...cli, cliente_telefono: e.target.value })} />
            <input placeholder="Dirección de entrega" value={cli.cliente_direccion}
              onChange={(e) => setCli({ ...cli, cliente_direccion: e.target.value })} />
            <label style={{ color: 'var(--muted)', fontSize: 13 }}>🕒 Hora de entrega
              <input type="time" value={cli.hora_entrega}
                onChange={(e) => setCli({ ...cli, hora_entrega: e.target.value })}
                style={{ display: 'block', width: '100%', marginTop: 4 }} />
            </label>
            <button className="btn-accent" style={{ padding: 13 }} onClick={crear}>+ Crear pedido</button>
          </div>
        </div>
        <div>
          <h2 className="h2">Pedidos de delivery activos</h2>
          {!activos.length && <p style={{ color: 'var(--muted)' }}>No hay pedidos de delivery abiertos.</p>}
          <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>
            {activos.map((p) => (
              <div key={p.id} className="card" style={{ cursor: 'pointer' }} onClick={() => abrir(p.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <b>{p.cliente_nombre || 'Cliente'}</b>
                  <b style={{ color: 'var(--accent)' }}>{money(p.total)}</b>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>📍 {p.cliente_direccion || '—'}</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>📞 {p.cliente_telefono || '—'} · {p.estado}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
