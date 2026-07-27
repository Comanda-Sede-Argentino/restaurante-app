import { useEffect, useState } from 'react';
import { api, socket, money } from '../api';
import OrderTaker from '../components/OrderTaker.jsx';
import { toast, confirmar, preguntar } from '../ui.jsx';

const MEDIOS = ['EFECTIVO', 'TARJETA DÉBITO', 'TARJETA CRÉDITO', 'QR / TRANSFERENCIA', 'FIADO (cuenta corriente)'];
const esFiadoMedio = (m) => /FIADO/i.test(m);

export default function Delivery() {
  const [pedido, setPedido] = useState(null);
  const [cli, setCli] = useState({ cliente_nombre: '', cliente_telefono: '', cliente_direccion: '', hora_entrega: '' });
  const [activos, setActivos] = useState([]);
  const [medio, setMedio] = useState('EFECTIVO');
  const [cuentas, setCuentas] = useState([]);
  const [cuentaId, setCuentaId] = useState('');
  const [detalleFiado, setDetalleFiado] = useState('');

  const cargarActivos = () =>
    api.deliveryPendientes().then(setActivos); // delivery que falta cobrar O entregar
  const cargarCuentas = () => api.cuentas().then(setCuentas);

  useEffect(() => {
    cargarActivos(); cargarCuentas();
    const reload = () => cargarActivos();
    socket.on('pedido:nuevo', reload);
    socket.on('pedido:actualizado', reload);
    socket.on('pedido:cobrado', reload);
    socket.on('connect', reload);
    return () => {
      socket.off('pedido:nuevo', reload);
      socket.off('pedido:actualizado', reload);
      socket.off('pedido:cobrado', reload);
      socket.off('connect', reload);
    };
  }, []);

  const crear = async () => {
    if (!cli.cliente_nombre.trim()) return toast('Ingresá al menos el nombre del cliente.', 'error');
    const p = await api.crearPedido({ tipo: 'delivery', mozo_nombre: 'Delivery', ...cli });
    await api.envio(p.id, { cobrar: true }); // envío por defecto ($3.000); se puede sacar si retira
    setPedido(await api.pedido(p.id));
  };

  const abrir = async (id) => setPedido(await api.pedido(id));
  const refrescar = async () => { if (pedido) setPedido(await api.pedido(pedido.id)); cargarActivos(); };
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

  const cancelarPedido = async () => {
    if (!(await confirmar('¿Cancelar este pedido de delivery? Se devuelve el stock. No se cobra nada.', { peligro: true, ok: 'Cancelar', cancelar: 'Volver' }))) return;
    const motivo = (await preguntar('Motivo de la cancelación (opcional):')) || '';
    try {
      await api.anular(pedido.id, motivo);
      setPedido(null);
      setCli({ cliente_nombre: '', cliente_telefono: '', cliente_direccion: '', hora_entrega: '' });
      cargarActivos();
      toast('Pedido cancelado.');
    } catch (e) {
      toast('No se pudo cancelar: ' + e.message, 'error');
    }
  };

  const marcarEntregado = async (e, id) => {
    if (e) e.stopPropagation();
    try { await api.entregar(id, true); cargarActivos(); toast('📦 Pedido marcado como entregado.'); }
    catch (err) { toast('No se pudo marcar entregado: ' + err.message, 'error'); }
  };

  // Cierre de delivery: marcar TODOS los que faltan como entregados
  const entregarTodos = async () => {
    const faltan = activos.filter((p) => !p.entregado_en);
    if (!faltan.length) { toast('No hay pedidos sin entregar.'); return; }
    if (!(await confirmar(`¿Marcar como ENTREGADOS los ${faltan.length} pedido(s) que faltan?`, { ok: 'Marcar entregados' }))) return;
    try { const r = await api.deliveryEntregarTodos(); cargarActivos(); toast(`📦 ${r.n} marcado(s) como entregado(s).`); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };

  // Imprime el ticket de cierre del turno de delivery (total vendido + cuánto en efectivo)
  const imprimirCierreDelivery = async () => {
    try {
      const r = await api.deliveryCierreImprimir();
      const m = r.resultado?.modo;
      toast(m === 'impreso'
        ? `🖨 Cierre impreso. Total ${money(r.totalVendido)} · efectivo ${money(r.efectivo)}`
        : `Cierre: ${r.n} pedido(s), total ${money(r.totalVendido)}.`);
    } catch (e) { toast('No se pudo imprimir el cierre: ' + e.message, 'error'); }
  };

  // Cierre de delivery: cobrar en EFECTIVO todos los ENTREGADOS que faltan cobrar
  const cobrarTodosEntregados = async () => {
    const cobrables = activos.filter((p) => p.estado !== 'cobrado' && p.entregado_en);
    if (!cobrables.length) { toast('No hay pedidos entregados sin cobrar. (Marcá "entregados" primero.)'); return; }
    const total = cobrables.reduce((a, p) => a + (p.total || 0), 0);
    if (!(await confirmar(`¿Cobrar en EFECTIVO los ${cobrables.length} pedido(s) ENTREGADO(s) sin cobrar?\n\nTotal: ${money(total)}\n\nOJO: los que se pagaron con tarjeta/transferencia/fiado, cobralos aparte ANTES.`, { ok: 'Cobrar todos (efectivo)' }))) return;
    try { const r = await api.deliveryCobrarEntregados(); cargarActivos(); cargarCuentas(); toast(`✅ ${r.n} cobrado(s) en efectivo (${money(r.total)}).`); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };

  // Cobro rápido en EFECTIVO desde la lista (1 toque). Para tarjeta/transferencia/fiado, abrir el pedido.
  const cobrarRapido = async (e, p) => {
    if (e) e.stopPropagation();
    if (!(await confirmar(`¿Cobrar ${money(p.total)} de ${p.cliente_nombre || 'delivery'} en EFECTIVO?`, { ok: 'Cobrar efectivo' }))) return;
    try {
      await api.pagar(p.id, [{ medio: 'EFECTIVO', importe: p.total }], {});
      cargarActivos(); cargarCuentas();
      toast('✅ Cobrado en efectivo.');
    } catch (err) {
      toast(err.message.includes('409') ? 'Ese pedido ya estaba cobrado.' : 'No se pudo cobrar: ' + err.message, 'error');
      cargarActivos();
    }
  };

  const nuevaCuentaRapida = async () => {
    const nombre = await preguntar('Nombre de la cuenta (empresa o persona) para el fiado:', pedido?.cliente_nombre || '');
    if (!nombre || !nombre.trim()) return;
    const c = await api.crearCuenta({ nombre: nombre.trim() });
    await cargarCuentas();
    setCuentaId(String(c.id));
  };

  const cobrar = async () => {
    const p = await api.pedido(pedido.id);
    const esFiado = esFiadoMedio(medio);
    if (esFiado && !cuentaId) { toast('Elegí a qué cuenta corriente va el fiado.', 'error'); return; }
    const quien = esFiado ? (cuentas.find((c) => String(c.id) === String(cuentaId))?.nombre || '') : '';
    if (!(await confirmar(esFiado ? `¿Cargar ${money(p.total)} al fiado de ${quien}?` : `¿Cobrar ${money(p.total)} en ${medio}?`, { ok: esFiado ? 'Cargar' : 'Cobrar' }))) return;
    try {
      await api.pagar(p.id, [{ medio: esFiado ? 'FIADO' : medio, importe: p.total }],
        esFiado ? { cuenta_id: Number(cuentaId), detalle: detalleFiado || null } : {});
      // Fiado: imprimir el ticket con espacio de FIRMA como comprobante de la deuda (best-effort).
      if (esFiado) { try { await api.imprimirCuenta(p.id, { firma: true }); } catch { /* ignorar */ } }
      setPedido(null);
      setCli({ cliente_nombre: '', cliente_telefono: '', cliente_direccion: '', hora_entrega: '' });
      setMedio('EFECTIVO'); setCuentaId(''); setDetalleFiado('');
      cargarActivos(); cargarCuentas();
      toast(esFiado ? '✅ Cargado al fiado. Ticket impreso.' : '✅ Cobrado.');
    } catch (e) {
      toast(e.message.includes('409') ? 'Ese pedido ya fue cobrado.' : 'No se pudo cobrar: ' + e.message, 'error');
      cargarActivos();
    }
  };

  if (pedido) {
    const envioItem = pedido.items?.find((i) => i.plato_id == null && i.nombre === 'Envío');
    const cobrandoEnvio = !!envioItem;
    const envioMonto = envioItem ? envioItem.cantidad * envioItem.precio_unit : 3000;
    const toggleEnvio = async (cobrar) => {
      try { await api.envio(pedido.id, { cobrar }); await refrescar(); }
      catch (e) { toast('No se pudo cambiar el envío: ' + e.message, 'error'); }
    };
    return (
      <div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={() => { setPedido(null); cargarActivos(); }}>← Delivery</button>
          <h1 className="h1" style={{ margin: 0 }}>🛵 {pedido.cliente_nombre || 'Delivery'} #{pedido.id}</h1>
          <span className="spacer" />
          {pedido.total > 0 && pedido.estado !== 'cobrado' && (
            <>
              <select value={medio} onChange={(e) => setMedio(e.target.value)}>
                {MEDIOS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <button className="btn-green" onClick={cobrar}>💵 Cobrar {money(pedido.total)}</button>
            </>
          )}
          {pedido.estado === 'cobrado' && !pedido.entregado_en && (
            <button className="btn-green" onClick={async () => { await marcarEntregado(null, pedido.id); setPedido(null); }}>📦 Marcar entregado</button>
          )}
          {pedido.estado !== 'cobrado' && (
            <button className="btn-red" onClick={cancelarPedido}>✖ Cancelar</button>
          )}
        </div>
        {pedido.total > 0 && esFiadoMedio(medio) && (
          <div className="card" style={{ marginBottom: 12, borderColor: 'var(--accent)' }}>
            <label className="h2" style={{ display: 'block', marginBottom: 6 }}>📒 Fiado — ¿a qué cuenta se carga?</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
                <option value="">— elegir cuenta —</option>
                {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} (debe {money(c.saldo)})</option>)}
              </select>
              <button onClick={nuevaCuentaRapida}>+ Nueva cuenta</button>
            </div>
            <input placeholder="A nombre de (opcional)" value={detalleFiado} onChange={(e) => setDetalleFiado(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
          </div>
        )}
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 10 }}>
            📞 {pedido.cliente_telefono || '—'} &nbsp;·&nbsp; 📍 {pedido.cliente_direccion || '—'}
          </div>
          <label>🕒 Hora de entrega: </label>
          <input type="time" value={pedido.hora_entrega || ''} onChange={(e) => setHora(e.target.value)} />
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={cobrandoEnvio} onChange={(e) => toggleEnvio(e.target.checked)} />
              <b>🛵 Cobrar envío</b> <span style={{ color: 'var(--accent)' }}>{money(envioMonto)}</span>
            </label>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>— destildá si el cliente lo retira</span>
          </div>
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
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
            Cuando el cadete vuelve con la plata, tocá <b>💵 Cobrar</b> (efectivo). Para tarjeta/transferencia/fiado, tocá la tarjeta y abrí el detalle.
            Un pedido se va de acá recién cuando está <b>pagado Y entregado</b>.
          </p>
          {(() => {
            const sinCobrar = activos.filter((p) => p.estado !== 'cobrado');
            const totalPend = sinCobrar.reduce((a, p) => a + (p.total || 0), 0);
            return sinCobrar.length > 0 ? (
              <div className="card" style={{ marginBottom: 10, borderColor: 'var(--orange)' }}>
                <b style={{ color: 'var(--orange)' }}>🕒 Sin cobrar: {sinCobrar.length} pedido(s) · {money(totalPend)}</b>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>Estos NO están en la caja ni en las estadísticas hasta que los cobres.</div>
              </div>
            ) : null;
          })()}
          {activos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <button onClick={entregarTodos}>📦 Marcar todos entregados</button>
              <button className="btn-green" onClick={cobrarTodosEntregados}>💵 Cobrar todos los entregados (efectivo)</button>
              <button onClick={imprimirCierreDelivery}>🖨 Cierre de delivery</button>
            </div>
          )}
          {!activos.length && <p style={{ color: 'var(--muted)' }}>No hay pedidos de delivery abiertos.</p>}
          <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))' }}>
            {activos.map((p) => {
              const pagado = p.estado === 'cobrado';
              const entregado = !!p.entregado_en;
              return (
              <div key={p.id} className="card" style={{ cursor: 'pointer' }} onClick={() => abrir(p.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <b>{p.cliente_nombre || 'Cliente'}</b>
                  <b style={{ color: 'var(--accent)' }}>{money(p.total)}</b>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>📍 {p.cliente_direccion || '—'}</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>📞 {p.cliente_telefono || '—'}{p.hora_entrega ? ' · ⏰ ' + p.hora_entrega : ''}</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: pagado ? 'var(--green)' : 'var(--orange)' }}>{pagado ? '✅ Pagado' : '🕒 A cobrar'}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: entregado ? 'var(--green)' : 'var(--muted)' }}>{entregado ? '📦 Entregado' : '🛵 Sin entregar'}</span>
                  <span className="spacer" />
                  {!pagado && (
                    <button className="btn-green" style={{ padding: '6px 10px' }} onClick={(e) => cobrarRapido(e, p)}>💵 Cobrar</button>
                  )}
                  {!entregado && (
                    <button style={{ padding: '6px 10px' }} onClick={(e) => marcarEntregado(e, p.id)}>📦 Entregado</button>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
