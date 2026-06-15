import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, money } from '../api';
import OrderTaker from '../components/OrderTaker.jsx';

export default function Mozo() {
  const { mesaId } = useParams();
  const nav = useNavigate();
  const [mesas, setMesas] = useState([]);
  const [mozos, setMozos] = useState([]);
  const [mozo, setMozo] = useState(localStorage.getItem('mozo') || '');
  const [pedido, setPedido] = useState(null);

  const cargarMesas = () => api.mesas().then(setMesas);
  useEffect(() => {
    cargarMesas();
    api.usuarios().then((u) => setMozos(u.filter((x) => x.rol === 'mozo' || x.rol === 'admin')));
  }, []);

  useEffect(() => {
    if (mesaId) abrirMesa(Number(mesaId));
  }, [mesaId]);

  const abrirMesa = async (id) => {
    const m = mesas.find((x) => x.id === id) || { id };
    const p = await api.crearPedido({ tipo: 'salon', mesa_id: id, mozo_nombre: mozo || 'Mozo' });
    const full = await api.pedido(p.id);
    setPedido(full);
  };

  const refrescarPedido = async () => {
    if (pedido) setPedido(await api.pedido(pedido.id));
    cargarMesas();
  };

  if (pedido) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button onClick={() => { setPedido(null); nav('/mozo'); cargarMesas(); }}>← Mesas</button>
          <h1 className="h1" style={{ margin: 0 }}>
            Mesa {pedido.mesa?.numero} · {money(pedido.total)}
          </h1>
          <span className="spacer" />
          <span className="badge warn">{pedido.estado}</span>
        </div>
        {pedido.items?.length > 0 && (
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 className="h2">Ya pedido</h2>
            {pedido.items.map((i) => (
              <div key={i.id} className="cart-item">
                <span style={{ flex: 1 }}>{i.cantidad}× {i.nombre} {i.observacion ? `(${i.observacion})` : ''}</span>
                <span className="badge warn">{i.estado}</span>
                <span>{money(i.cantidad * i.precio_unit)}</span>
              </div>
            ))}
          </div>
        )}
        <OrderTaker pedido={pedido} onEnviado={refrescarPedido} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <h1 className="h1" style={{ margin: 0 }}>Elegí una mesa</h1>
        <span className="spacer" />
        <label style={{ color: 'var(--muted)' }}>Mozo:</label>
        <select value={mozo} onChange={(e) => { setMozo(e.target.value); localStorage.setItem('mozo', e.target.value); }}>
          <option value="">—</option>
          {mozos.map((m) => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
        </select>
      </div>
      <div className="mesas">
        {mesas.map((m) => (
          <div key={m.id} className={'mesa ' + m.estado} onClick={() => abrirMesa(m.id)}>
            <div className="num">{m.numero}</div>
            <div className="est">{m.sala}</div>
            {m.pedido ? <div className="tot">{money(m.pedido.total)}</div> : <div className="est">libre</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
