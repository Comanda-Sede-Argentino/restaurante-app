import { useEffect, useState } from 'react';
import { api, socket, money } from '../api';
import OrderTaker from '../components/OrderTaker.jsx';
import { toast, confirmar } from '../ui.jsx';

export default function WhatsApp() {
  const [estado, setEstado] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [pedido, setPedido] = useState(null);   // pedido en edición tras convertir
  const [msgRef, setMsgRef] = useState(null);   // texto original del cliente
  const [draft, setDraft] = useState(null);     // { m, prop } borrador armado con IA
  const [armandoId, setArmandoId] = useState(null); // id que se está interpretando
  const [confirmando, setConfirmando] = useState(false);

  const cargarInbox = () => api.waInbox('pendiente').then(setInbox);
  const cargarEstado = () => api.waEstado().then(setEstado);

  // Desvincular de verdad: borra la sesión guardada y genera un QR nuevo para OTRO número
  const desvincular = async () => {
    if (!(await confirmar(
      '¿Desvincular el WhatsApp actual para conectar OTRO número?\n\nSe cierra la sesión guardada y vas a tener que escanear un QR nuevo con el celular del otro número.',
      { peligro: true, ok: 'Sí, desvincular', cancelar: 'Volver' }
    ))) return;
    try {
      await api.waDesvincular();
      toast('Desvinculado. En unos segundos aparece el QR nuevo: escanealo con el OTRO número.');
      cargarEstado();
      setTimeout(cargarEstado, 1500);
      setTimeout(cargarEstado, 3500);
    } catch (e) { toast('No se pudo desvincular: ' + e.message, 'error'); }
  };

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

  const descartarTodos = async () => {
    if (!inbox.length) return;
    if (!(await confirmar(`¿Descartar los ${inbox.length} mensajes de la bandeja? (no borra los pedidos ya creados)`, { peligro: true, ok: 'Descartar todos', cancelar: 'Volver' }))) return;
    try { const r = await api.waDescartarTodos(); toast(`🗑 ${r.n} mensaje(s) descartado(s).`); cargarInbox(); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };

  const convertir = async (m) => {
    const p = await api.waConvertir(m.id);
    setMsgRef(m);
    setPedido(await api.pedido(p.id));
    cargarInbox();
  };

  // 🤖 Interpreta el mensaje con IA y abre el borrador editable
  const armarPedido = async (m) => {
    setArmandoId(m.id);
    try {
      const r = await api.waArmarPedido(m.id);
      setDraft({ m, prop: r.propuesta });
    } catch (e) {
      toast('No se pudo armar el pedido: ' + e.message, 'error');
    } finally { setArmandoId(null); }
  };

  // Ediciones sobre el borrador
  const setCampo = (campo, val) => setDraft((d) => ({ ...d, prop: { ...d.prop, [campo]: val } }));
  const patchItem = (idx, patch) => setDraft((d) => {
    const items = d.prop.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    return { ...d, prop: { ...d.prop, items } };
  });
  const incItem = (idx, delta) => setDraft((d) => {
    const items = d.prop.items.map((it, i) => (i === idx ? { ...it, cantidad: Math.max(1, (Number(it.cantidad) || 1) + delta) } : it));
    return { ...d, prop: { ...d.prop, items } };
  });
  const delItem = (idx) => setDraft((d) => ({ ...d, prop: { ...d.prop, items: d.prop.items.filter((_, i) => i !== idx) } }));

  const confirmarDraft = async () => {
    if (!draft) return;
    const items = draft.prop.items || [];
    if (!items.length) { toast('El pedido no tiene items.', 'error'); return; }
    const sinPrecio = items.filter((i) => !i.plato_id && !(Number(i.precio_unit) > 0));
    if (sinPrecio.length && !(await confirmar(
      `Hay ${sinPrecio.length} ítem(s) fuera de carta SIN precio (${sinPrecio.map((i) => i.nombre).join(', ')}). Van igual a la cocina y el precio se pone en la caja. ¿Confirmar así?`,
      { ok: 'Sí, confirmar', cancelar: 'Volver a revisar' }
    ))) return;
    setConfirmando(true);
    try {
      const r = await api.waConfirmarPedido(draft.m.id, draft.prop);
      const imp = r.impresion || {};
      if (imp.ok === false) toast(`Pedido #${r.pedido.id} cargado, pero la comanda NO se imprimió. Revisá la impresora.`, 'error');
      else toast(`✅ Pedido #${r.pedido.id} enviado a la cocina. Se le avisó al cliente.`);
      setDraft(null);
      cargarInbox();
    } catch (e) {
      toast('No se pudo confirmar: ' + e.message, 'error');
    } finally { setConfirmando(false); }
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

  // Vista del BORRADOR armado con IA (revisar → confirmar → cocina)
  if (draft) {
    const prop = draft.prop;
    const items = prop.items || [];
    const subtotal = items.reduce((a, i) => a + (Number(i.cantidad) || 0) * (Number(i.precio_unit) || 0), 0);
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setDraft(null)}>← Bandeja</button>
          <h1 className="h1" style={{ margin: 0 }}>🤖 Revisá el pedido</h1>
          <span className="spacer" />
          <span className="badge warn">Subtotal {money(subtotal)}{prop.es_envio ? ' + envío' : ''}</span>
        </div>

        <div className="card" style={{ marginBottom: 12, borderColor: '#25D366' }}>
          <div className="h2" style={{ marginBottom: 6 }}>📱 Mensaje del cliente</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{draft.m.texto}</div>
        </div>

        {prop.no_reconocidos?.length > 0 && (
          <div className="card" style={{ marginBottom: 12, borderColor: 'var(--orange)' }}>
            ⚠️ No entendí: <b>{prop.no_reconocidos.join(', ')}</b>. Si es comida, agregala a mano después.
          </div>
        )}

        {/* Datos del cliente */}
        <div className="card" style={{ marginBottom: 12, display: 'grid', gap: 10 }}>
          <div>
            <label>👤 Cliente</label>
            <input value={prop.cliente_nombre || ''} onChange={(e) => setCampo('cliente_nombre', e.target.value)} placeholder="Nombre" style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={prop.es_envio ? 'btn-green' : ''} onClick={() => setCampo('es_envio', true)}>🛵 Envío a domicilio</button>
            <button className={!prop.es_envio ? 'btn-green' : ''} onClick={() => setCampo('es_envio', false)}>🏠 Retira</button>
          </div>
          {prop.es_envio && (
            <div>
              <label>📍 Dirección</label>
              <input value={prop.cliente_direccion || ''} onChange={(e) => setCampo('cliente_direccion', e.target.value)} placeholder="Dirección de entrega" style={{ width: '100%' }} />
            </div>
          )}
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            🕒 La hora se le avisa después por WhatsApp (depende de la cocina). Tel: {prop.cliente_telefono}
          </div>
        </div>

        {/* Items */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="h2" style={{ marginBottom: 8 }}>🍽 Items</div>
          {!items.length && <p style={{ color: 'var(--muted)' }}>Sin items. Cancelá y cargalo a mano.</p>}
          {items.map((it, idx) => (
            <div key={idx} className="cart-item" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => incItem(idx, -1)} style={{ minWidth: 34 }}>−</button>
                <b style={{ minWidth: 24, textAlign: 'center' }}>{it.cantidad}</b>
                <button onClick={() => incItem(idx, +1)} style={{ minWidth: 34 }}>+</button>
              </div>
              <span style={{ flex: 1, minWidth: 120 }}>
                {it.nombre}{!it.plato_id && <span title="Fuera de carta" style={{ color: 'var(--orange)' }}> 📝</span>}
                {it.observacion ? <span style={{ color: 'var(--muted)' }}> ({it.observacion})</span> : null}
              </span>
              {!it.plato_id ? (
                <input type="number" value={it.precio_unit || ''} onChange={(e) => patchItem(idx, { precio_unit: Number(e.target.value) || 0 })}
                  placeholder="precio" style={{ width: 90 }} />
              ) : (
                <span style={{ minWidth: 80, textAlign: 'right' }}>{money(it.cantidad * it.precio_unit)}</span>
              )}
              <button className="btn-red" onClick={() => delItem(idx)} style={{ minWidth: 34 }}>🗑</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-green" onClick={confirmarDraft} disabled={confirmando || !items.length} style={{ fontSize: 17, padding: '12px 20px' }}>
            {confirmando ? 'Enviando…' : '✅ Confirmar y mandar a cocina'}
          </button>
          <button onClick={() => setDraft(null)}>Cancelar</button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
          Al confirmar: sale la comanda a la cocina y le llega al cliente un "¡Gracias! En breve te avisamos el horario".
        </p>
      </div>
    );
  }

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
          {estado && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--panel2)', paddingTop: 10 }}>
              <button onClick={desvincular} title="Cierra la sesión guardada y genera un QR nuevo">
                🔄 Usar otro número (desvincular)
              </button>
              <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
                Usalo si querés cambiar el número: borra la vinculación actual y te muestra un QR nuevo para escanear con el otro celular.
              </p>
            </div>
          )}
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 12 }}>
            Usá un número <b>dedicado a pedidos</b> (no el personal). La sesión queda guardada;
            solo hace falta escanear una vez.
          </p>
        </div>

        {/* Bandeja */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 className="h2" style={{ margin: 0 }}>Bandeja de entrada</h2>
            <span className="badge warn">{inbox.length} sin procesar</span>
            {inbox.length > 0 && <button className="btn-red" onClick={descartarTodos}>🗑 Descartar todos</button>}
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
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn-green" onClick={() => armarPedido(m)} disabled={armandoId === m.id}>
                    {armandoId === m.id ? '🤖 Interpretando…' : '🤖 Armar pedido'}
                  </button>
                  <button onClick={() => convertir(m)} title="Crear el pedido vacío y cargar los items a mano">✍ Cargar a mano</button>
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
