import { useEffect, useState, useCallback } from 'react';
import { api, socket } from '../api';

function transcurrido(desde) {
  if (!desde) return '';
  const t = new Date(desde.replace(' ', 'T'));
  const min = Math.floor((Date.now() - t.getTime()) / 60000);
  if (isNaN(min)) return '';
  return min <= 0 ? 'recién' : `hace ${min} min`;
}

export default function KDS() {
  const [sectores, setSectores] = useState([]);
  const [sector, setSector] = useState('Todos');
  const [items, setItems] = useState([]);
  const [, force] = useState(0);

  const cargar = useCallback(() => { api.kds(sector).then(setItems); }, [sector]);

  useEffect(() => {
    api.sectores().then((s) => setSectores([{ nombre: 'Todos' }, ...s]));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    const reload = () => cargar();
    socket.on('item:nuevo', reload);
    socket.on('item:estado', reload);
    socket.on('pedido:cobrado', reload);
    const tick = setInterval(() => force((x) => x + 1), 30000); // refrescar cronómetros
    return () => {
      socket.off('item:nuevo', reload);
      socket.off('item:estado', reload);
      socket.off('pedido:cobrado', reload);
      clearInterval(tick);
    };
  }, [cargar]);

  const cambiar = async (id, estado) => {
    await api.estadoItem(id, estado);
    cargar();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <h1 className="h1" style={{ margin: 0 }}>👨‍🍳 Cocina</h1>
        <span className="spacer" />
        {sectores.map((s) => (
          <div key={s.nombre} className={'chip' + (sector === s.nombre ? ' active' : '')} onClick={() => setSector(s.nombre)}>
            {s.nombre}
          </div>
        ))}
      </div>
      {!items.length && <p style={{ color: 'var(--muted)' }}>No hay comandas pendientes. 🎉</p>}
      <div className="kds-grid">
        {items.map((i) => (
          <div key={i.id} className={'comanda ' + i.estado}>
            <div className="ch">
              <span>{i.cantidad}× {i.nombre}</span>
              <span className="badge warn">{i.sector_nombre}</span>
            </div>
            <div className="when">
              {i.tipo === 'salon' ? `Mesa ${i.mesa_numero ?? '?'}` : 'Mostrador'} · {i.mozo_nombre || ''} · {transcurrido(i.enviado_en)}
            </div>
            {i.observacion && <div className="obs">⚠ {i.observacion}</div>}
            <div className="comanda-actions">
              {i.estado === 'pendiente' && (
                <button className="btn-blue" style={{ flex: 1 }} onClick={() => cambiar(i.id, 'en_preparacion')}>▶ Preparar</button>
              )}
              {i.estado === 'en_preparacion' && (
                <button className="btn-green" style={{ flex: 1 }} onClick={() => cambiar(i.id, 'listo')}>✓ Listo</button>
              )}
              <button title="Reimprimir comanda" onClick={() => api.reimprimir(i.pedido_id)}>🖨</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
