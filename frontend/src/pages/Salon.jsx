import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, socket, money } from '../api';

export default function Salon() {
  const [mesas, setMesas] = useState([]);
  const nav = useNavigate();
  const cargar = () => api.mesas().then(setMesas);

  useEffect(() => {
    cargar();
    const reload = () => cargar();
    socket.on('pedido:nuevo', reload);
    socket.on('pedido:actualizado', reload);
    socket.on('pedido:cobrado', reload);
    return () => {
      socket.off('pedido:nuevo', reload);
      socket.off('pedido:actualizado', reload);
      socket.off('pedido:cobrado', reload);
    };
  }, []);

  const ocupadas = mesas.filter((m) => m.estado === 'ocupada').length;
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <h1 className="h1" style={{ margin: 0 }}>Salón</h1>
        <span className="badge warn">{ocupadas} ocupadas / {mesas.length}</span>
      </div>
      <div className="mesas">
        {mesas.map((m) => (
          <div key={m.id} className={'mesa ' + m.estado} onClick={() => nav('/mozo/' + m.id)}>
            <div className="num">{m.numero}</div>
            <div className="est">{m.sala}</div>
            {m.pedido
              ? <><div className="tot">{money(m.pedido.total)}</div><div className="est">{m.pedido.mozo_nombre || ''}</div></>
              : <div className="est">libre</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
