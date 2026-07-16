import { useEffect, useState, useCallback, useRef } from 'react';
import { api, socket } from '../api';

function minutosDesde(desde) {
  if (!desde) return null;
  const t = new Date(desde.replace(' ', 'T'));
  const min = Math.floor((Date.now() - t.getTime()) / 60000);
  return isNaN(min) ? null : min;
}

function transcurrido(desde) {
  const min = minutosDesde(desde);
  if (min === null) return '';
  return min <= 0 ? 'recién' : `hace ${min} min`;
}

// Nivel de urgencia según cuánto hace que está la comanda.
function urgencia(min) {
  if (min === null) return '';
  if (min >= 15) return 'urgente';
  if (min >= 8) return 'demora';
  return '';
}

// Beep corto con Web Audio (sin archivos). Necesita un gesto previo del usuario.
function useBeep() {
  const ctxRef = useRef(null);
  const habilitar = () => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctxRef.current = new AC();
    }
    if (ctxRef.current && ctxRef.current.state === 'suspended') ctxRef.current.resume();
  };
  const beep = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const tono = (freq, inicio, dur) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + inicio;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur);
    };
    tono(880, 0, 0.18);
    tono(1175, 0.18, 0.22);
  };
  return { habilitar, beep };
}

export default function KDS() {
  const [sectores, setSectores] = useState([]);
  const [sector, setSector] = useState('Todos');
  const [items, setItems] = useState([]);
  const [sonido, setSonido] = useState(false);
  const [, force] = useState(0);
  const { habilitar, beep } = useBeep();
  const sonidoRef = useRef(false);
  sonidoRef.current = sonido;

  const [verStock, setVerStock] = useState(false);
  const [platosDisp, setPlatosDisp] = useState([]);
  const [qStock, setQStock] = useState('');

  const cargar = useCallback(() => { api.kds(sector).then(setItems); }, [sector]);
  const cargarPlatos = () => api.platos({}).then(setPlatosDisp);

  useEffect(() => {
    api.sectores().then((s) => setSectores([{ nombre: 'Todos' }, ...s]));
    cargarPlatos();
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    const reload = () => cargar();
    const nuevo = () => { if (sonidoRef.current) beep(); cargar(); };
    socket.on('item:nuevo', nuevo);
    socket.on('pedido:nuevo', nuevo);
    socket.on('item:estado', reload);
    socket.on('pedido:cobrado', reload);
    socket.on('plato:disponibilidad', cargarPlatos);
    socket.on('connect', reload);
    const tick = setInterval(() => force((x) => x + 1), 20000); // refrescar cronómetros/urgencia
    return () => {
      socket.off('item:nuevo', nuevo);
      socket.off('pedido:nuevo', nuevo);
      socket.off('item:estado', reload);
      socket.off('pedido:cobrado', reload);
      socket.off('plato:disponibilidad', cargarPlatos);
      socket.off('connect', reload);
      clearInterval(tick);
    };
  }, [cargar, beep]);

  const toggleDisp = async (p, disp) => { await api.setDisponible(p.id, disp); cargarPlatos(); };
  const sinStock = platosDisp.filter((p) => !p.disponible);
  const buscados = qStock.trim()
    ? platosDisp.filter((p) => p.nombre.toLowerCase().includes(qStock.toLowerCase())).slice(0, 30)
    : [];

  const toggleSonido = () => {
    if (!sonido) { habilitar(); beep(); } // el click habilita el audio del navegador
    setSonido((s) => !s);
  };

  const cambiar = async (id, estado) => {
    await api.estadoItem(id, estado);
    cargar();
  };

  const origen = (i) => {
    if (i.tipo === 'delivery') return '🛵 DELIVERY';
    if (i.tipo === 'salon') return `Mesa ${i.mesa_numero ?? '?'}`;
    return 'Mostrador';
  };

  // Ordenar SIEMPRE por antigüedad (lo más viejo primero) para que lo urgente quede arriba
  // y nunca se olvide un plato "abajo", sin depender del orden que devuelva el backend.
  const itemsOrdenados = [...items].sort((a, b) =>
    String(a.enviado_en || '').localeCompare(String(b.enviado_en || '')));

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <h1 className="h1" style={{ margin: 0 }}>👨‍🍳 Cocina</h1>
        <button className={sonido ? 'btn-green' : ''} onClick={toggleSonido} title="Aviso sonoro al entrar una comanda">
          {sonido ? '🔔 Sonido ON' : '🔕 Sonido OFF'}
        </button>
        <button className={sinStock.length ? 'btn-red' : ''} onClick={() => setVerStock((v) => !v)}>
          🚫 Sin stock{sinStock.length ? ` (${sinStock.length})` : ''}
        </button>
        <span className="spacer" />
        {sectores.map((s) => (
          <div key={s.nombre} className={'chip' + (sector === s.nombre ? ' active' : '')} onClick={() => setSector(s.nombre)}>
            {s.nombre}
          </div>
        ))}
      </div>

      {verStock && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--orange)' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h2 className="h2" style={{ margin: 0 }}>🚫 Platos sin stock</h2>
            <span className="spacer" />
            <button onClick={() => setVerStock(false)}>✕ cerrar</button>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            Marcá los platos que se agotaron: los mozos y el bot <b>no los van a poder vender</b> hasta que los rehabilites.
          </p>
          {/* Los que están sin stock ahora */}
          {sinStock.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <b style={{ color: 'var(--orange)' }}>Agotados ahora ({sinStock.length}):</b>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {sinStock.map((p) => (
                  <button key={p.id} className="btn-green" onClick={() => toggleDisp(p, 1)} title="Volver a habilitar">
                    ✓ {p.nombre}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Buscar un plato para marcarlo sin stock */}
          <input placeholder="🔎 Buscar plato para marcar sin stock..." value={qStock}
            onChange={(e) => setQStock(e.target.value)} style={{ width: '100%' }} />
          {buscados.map((p) => (
            <div key={p.id} className="cart-item">
              <span style={{ flex: 1, opacity: p.disponible ? 1 : 0.5 }}>{p.nombre}{!p.disponible && ' (sin stock)'}</span>
              {p.disponible
                ? <button className="btn-red" onClick={() => toggleDisp(p, 0)}>🚫 Sin stock</button>
                : <button className="btn-green" onClick={() => toggleDisp(p, 1)}>✓ Hay</button>}
            </div>
          ))}
        </div>
      )}
      {!items.length && <p style={{ color: 'var(--muted)' }}>No hay comandas pendientes. 🎉</p>}
      <div className="kds-grid">
        {itemsOrdenados.map((i) => {
          const min = minutosDesde(i.enviado_en);
          const urg = urgencia(min);
          return (
            <div key={i.id} className={`comanda ${i.estado} ${urg}`}>
              <div className="ch">
                <span>{i.cantidad}× {i.nombre}</span>
                <span className="badge warn">{i.sector_nombre}</span>
              </div>
              <div className="when">
                {origen(i)} · {i.mozo_nombre || ''} · {transcurrido(i.enviado_en)}
              </div>
              {i.tipo === 'delivery' && i.hora_entrega && (
                <div className="entrega">⏰ Entregar: {i.hora_entrega}{i.cliente_nombre ? ' · ' + i.cliente_nombre : ''}</div>
              )}
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
          );
        })}
      </div>
    </div>
  );
}
