import { useEffect, useState } from 'react';
import { api, socket, money } from '../api';
import OrderTaker from '../components/OrderTaker.jsx';
import { toast } from '../ui.jsx';

export default function WhatsApp() {
  const [estado, setEstado] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [pedido, setPedido] = useState(null);   // pedido en edición tras convertir
  const [msgRef, setMsgRef] = useState(null);   // texto original del cliente

  const cargarInbox = () => api.waInbox('pendiente').then(setInbox);
  const cargarEstado = () => api.waEstado().then(setEstado);

  useEffect(() => {
    cargarEstado();
    cargarInbox();
    const onEstado = (st) => setEstado(st);
    const onNuevo = () => cargarInbox();
    socket.on('wa:estado', onEstado);
    socket.on('wa:nuevo', onNuevo);
    socket.on('wa:actualizado', onNuevo);
    const tick = setInterval(cargarEstado, 8000); // refrescar QR/estado
    return () => {
      socket.off('wa:estado', onEstado);
      socket.off('wa:nuevo', onNuevo);
      socket.off('wa:actualizado', onNuevo);
      clearInterval(tick);
    };
  }, []);

  const convertir = async (m) => {
    const p = await api.waConvertir(m.id);
    setMsgRef(m);
    setPedido(await api.pedido(p.id));
    cargarInbox();
  };
  const refrescar = async () => { if (pedido) setPedido(await api.pedido(pedido.id)); };
  const setHora = async (hora) => {
    if (!pedido) return;
    const prev = pedido.hora_entrega;
    setPedido((p) => ({ ...p, hora_entrega: hora }));
    try {
      await api.actualizarPedido(pedido.id, { hora_entrega: hora });
    } catch {
      setPedido((p) => ({ ...p, hora_entrega: prev }));
      toast('No se pudo guardar la hora de entrega.', 'error');
    }
  };

  // Vista de carga de pedido (tras convertir un mensaje)
  if (pedido) {
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={() => { setPedido(null); setMsgRef(null); cargarInbox(); }}>← Bandeja</button>
          <h1 className="h1" style={{ margin: 0 }}>🟢 {pedido.cliente_nombre} · {pedido.cliente_telefono}</h1>
          <span className="spacer" />
          {pedido.total > 0 && <span className="badge warn">Total {money(pedido.total)}</span>}
        </div>
        {msgRef && (
          <div className="card" style={{ marginBottom: 12, borderColor: '#25D366' }}>
            <div className="h2" style={{ marginBottom: 6 }}>Mensaje del cliente</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{msgRef.texto}</div>
          </div>
        )}
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 10 }}>
            📍 {pedido.cliente_direccion || '— (cargar dirección)'}
          </div>
          <label>🕒 Hora de entrega: </label>
          <input type="time" value={pedido.hora_entrega || ''} onChange={(e) => setHora(e.target.value)} />
        </div>
        {pedido.items?.length > 0 && (
          <div className="card" style={{ marginBottom: 12 }}>
            {pedido.items.map((i) => (
              <div key={i.id} className="cart-item">
                <span style={{ flex: 1 }}>{i.cantidad}× {i.nombre}</span>
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
      <h1 className="h1">Pedidos por WhatsApp</h1>
      <div className="grid" style={{ gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Conexión */}
        <div className="card">
          <h2 className="h2">Conexión</h2>
          {!estado && <p>Cargando...</p>}
          {estado && estado.conectado && (
            <>
              <p style={{ color: 'var(--green)', fontWeight: 700 }}>🟢 Conectado</p>
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>Número: {estado.numero || '—'}</p>
              <button className="btn-red" onClick={() => api.waDesconectar().then(cargarEstado)}>Desconectar</button>
            </>
          )}
          {estado && !estado.conectado && (
            <>
              {estado.qr ? (
                <>
                  <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                    Escaneá este código desde <b>WhatsApp → Dispositivos vinculados → Vincular dispositivo</b>:
                  </p>
                  <img src={estado.qr} alt="QR WhatsApp" style={{ width: '100%', borderRadius: 8, background: '#fff', padding: 8 }} />
                </>
              ) : (
                <>
                  <p style={{ color: 'var(--orange)' }}>🔴 Desconectado</p>
                  {estado.error && <p style={{ color: 'var(--muted)', fontSize: 13 }}>{estado.error}</p>}
                  <button className="btn-green" onClick={() => api.waConectar().then(cargarEstado)}>
                    {estado.iniciando ? 'Generando QR...' : 'Conectar / Generar QR'}
                  </button>
                </>
              )}
            </>
          )}
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 12 }}>
            Usá un número <b>dedicado a pedidos</b> (no el personal). La sesión queda guardada;
            solo hace falta escanear una vez.
          </p>
        </div>

        {/* Bandeja */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 className="h2" style={{ margin: 0 }}>Bandeja de entrada</h2>
            <span className="badge warn">{inbox.length} sin procesar</span>
          </div>
          {!inbox.length && <p style={{ color: 'var(--muted)' }}>No hay mensajes pendientes.</p>}
          <div className="grid" style={{ gap: 10, marginTop: 10 }}>
            {inbox.map((m) => (
              <div key={m.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>📱 {m.nombre}</b>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{m.telefono} · {m.fecha}</span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{m.texto}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-green" onClick={() => convertir(m)}>✓ Crear pedido</button>
                  <button className="btn-red" onClick={() => api.waDescartar(m.id).then(cargarInbox)}>Descartar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
