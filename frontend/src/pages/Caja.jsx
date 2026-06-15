import { useEffect, useState } from 'react';
import { api, socket, money } from '../api';

const MEDIOS = ['EFECTIVO', 'TARJETA DÉBITO', 'TARJETA CRÉDITO', 'QR / TRANSFERENCIA'];

export default function Caja() {
  const [pedidos, setPedidos] = useState([]);
  const [sel, setSel] = useState(null);
  const [medio, setMedio] = useState('EFECTIVO');
  const [recibido, setRecibido] = useState('');

  const cargar = () => api.pedidos().then((ps) => setPedidos(ps.filter((p) => p.total > 0)));
  useEffect(() => {
    cargar();
    const reload = () => cargar();
    socket.on('pedido:actualizado', reload);
    socket.on('pedido:nuevo', reload);
    socket.on('pedido:cobrado', reload);
    return () => {
      socket.off('pedido:actualizado', reload);
      socket.off('pedido:nuevo', reload);
      socket.off('pedido:cobrado', reload);
    };
  }, []);

  const cobrar = async () => {
    await api.pagar(sel.id, [{ medio, importe: sel.total }]);
    setSel(null); setRecibido(''); cargar();
  };
  const vuelto = medio === 'EFECTIVO' && recibido ? Number(recibido) - (sel?.total || 0) : null;

  return (
    <div>
      <h1 className="h1">Caja</h1>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div>
          <h2 className="h2">Mesas / pedidos por cobrar</h2>
          {!pedidos.length && <p style={{ color: 'var(--muted)' }}>Nada por cobrar.</p>}
          {pedidos.map((p) => (
            <div key={p.id} className="card" style={{ marginBottom: 8, cursor: 'pointer', borderColor: sel?.id === p.id ? 'var(--accent)' : '' }} onClick={() => setSel(p)}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>{p.tipo === 'salon' ? `Mesa ${p.mesa?.numero}` : 'Mostrador #' + p.id}</b>
                <b style={{ color: 'var(--accent)' }}>{money(p.total)}</b>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{p.mozo_nombre} · {p.estado} · {p.items?.length || 0} ítems</div>
            </div>
          ))}
        </div>
        <div className="card">
          {!sel && <p style={{ color: 'var(--muted)' }}>Seleccioná un pedido para cobrar.</p>}
          {sel && (
            <>
              <h2 className="h2">{sel.tipo === 'salon' ? `Mesa ${sel.mesa?.numero}` : 'Mostrador #' + sel.id}</h2>
              {sel.items?.map((i) => (
                <div key={i.id} className="cart-item">
                  <span style={{ flex: 1 }}>{i.cantidad}× {i.nombre}</span>
                  <span>{money(i.cantidad * i.precio_unit)}</span>
                </div>
              ))}
              <div className="total-row"><span>Total</span><span>{money(sel.total)}</span></div>
              <label className="h2">Medio de pago</label>
              <select value={medio} onChange={(e) => setMedio(e.target.value)} style={{ width: '100%', marginBottom: 10 }}>
                {MEDIOS.map((m) => <option key={m}>{m}</option>)}
              </select>
              {medio === 'EFECTIVO' && (
                <>
                  <input placeholder="Recibido $" value={recibido} onChange={(e) => setRecibido(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
                  {vuelto != null && vuelto >= 0 && <div style={{ marginBottom: 8 }}>Vuelto: <b>{money(vuelto)}</b></div>}
                </>
              )}
              <button className="btn-green" style={{ width: '100%', padding: 14 }} onClick={cobrar}>✅ Confirmar cobro {money(sel.total)}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
