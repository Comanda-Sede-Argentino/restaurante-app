import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, money } from '../api';
import OrderTaker from '../components/OrderTaker.jsx';
import { toast, confirmar, preguntar } from '../ui.jsx';

export default function Mozo() {
  const { mesaId } = useParams();
  const nav = useNavigate();
  const [mesas, setMesas] = useState([]);
  const [mozos, setMozos] = useState([]);
  const [mozo, setMozo] = useState(localStorage.getItem('mozo') || '');
  const [pedido, setPedido] = useState(null);
  const [accionMesa, setAccionMesa] = useState(null); // 'mover' | 'unir'
  const [mesaDestino, setMesaDestino] = useState('');
  const [cobrando, setCobrando] = useState(false);    // muestra el cartel de forma de pago
  const [recibido, setRecibido] = useState('');        // con cuánto paga (efectivo) para el vuelto
  const [modoFiado, setModoFiado] = useState(false);   // sub-pantalla para elegir empresa (fiado)
  const [cuentas, setCuentas] = useState([]);          // empresas / cuentas corrientes
  const [cuentaId, setCuentaId] = useState('');        // empresa elegida para el fiado

  const cargarMesas = () => api.mesas().then(setMesas);
  const cargarCuentas = () => api.cuentas().then(setCuentas).catch(() => {});
  useEffect(() => {
    cargarMesas();
    cargarCuentas();
    api.usuarios().then((u) => setMozos(u.filter((x) => x.rol === 'mozo' || x.rol === 'admin')));
  }, []);

  useEffect(() => {
    if (mesaId && mesas.length) abrirMesa(Number(mesaId));
  }, [mesaId, mesas.length]);

  const abrirMesa = async (id) => {
    const m = mesas.find((x) => x.id === id);
    // Para ABRIR una mesa nueva es obligatorio elegir el mozo (si no, la comanda sale anónima
    // y se rompen los reportes y las propinas). Una mesa ya abierta se puede ver igual.
    if (!m?.pedido && !mozo) {
      toast('Elegí tu nombre (arriba) antes de abrir una mesa nueva.', 'error');
      return;
    }
    try {
      let p;
      if (m?.pedido) {
        p = await api.pedido(m.pedido.id);            // reusar el pedido abierto de la mesa
      } else {
        const nuevo = await api.crearPedido({ tipo: 'salon', mesa_id: id, mozo_nombre: mozo });
        p = await api.pedido(nuevo.id);
      }
      setPedido(p);
    } catch (e) {
      toast('No se pudo abrir la mesa: ' + e.message, 'error');
    }
  };

  const refrescarPedido = async () => {
    if (pedido) setPedido(await api.pedido(pedido.id));
    cargarMesas();
  };

  const quitarItem = async (id) => {
    if (!(await confirmar('¿Quitar este plato del pedido?', { peligro: true, ok: 'Quitar' }))) return;
    await api.estadoItem(id, 'anulado');
    refrescarPedido();
  };

  // Imprime la cuenta, registra el cobro en la caja (con la forma de pago elegida) y libera la mesa.
  const cobrarMesa = async (medio) => {
    const total = pedido.total;
    let extra = '';
    if (medio === 'EFECTIVO') {
      const rec = Number(String(recibido).replace(/[^\d]/g, '')) || 0;
      if (rec > 0) extra = `\nPaga con ${money(rec)} → vuelto ${money(Math.max(0, rec - total))}`;
    }
    if (!(await confirmar(`¿Cobrar ${money(total)} en ${medio}?${extra}\n\nSe imprime la cuenta y la mesa queda libre.`, { ok: 'Cobrar e imprimir' }))) return;
    try {
      await api.imprimirCuenta(pedido.id).catch(() => {}); // imprimir es best-effort: no frena el cobro
      await api.pagar(pedido.id, [{ medio, importe: total }], {}); // registra la venta y libera la mesa
      setCobrando(false); setRecibido('');
      setPedido(null); nav('/mozo'); cargarMesas();
      toast('✅ Cobrado e impreso. Mesa liberada.');
    } catch (e) {
      toast(e.message.includes('409') ? 'Ese pedido ya fue cobrado.' : 'No se pudo cobrar: ' + e.message, 'error');
    }
  };

  // Crear una empresa al vuelo desde la mesa (para el fiado)
  const nuevaEmpresaMesa = async () => {
    const nombre = await preguntar('Nombre de la empresa (o persona) para el fiado:');
    if (!nombre || !nombre.trim()) return;
    try {
      const c = await api.crearCuenta({ nombre: nombre.trim() });
      await cargarCuentas();
      setCuentaId(String(c.id));
      toast('Empresa creada.');
    } catch (e) { toast('No se pudo crear la empresa: ' + e.message, 'error'); }
  };

  // Cargar el pedido de la mesa al fiado de una empresa: imprime el ticket con firma y libera la mesa.
  const cobrarFiadoMesa = async () => {
    if (!cuentaId) { toast('Elegí la empresa (o creá una nueva).', 'error'); return; }
    const total = pedido.total;
    const emp = cuentas.find((c) => String(c.id) === String(cuentaId));
    if (!(await confirmar(`¿Cargar ${money(total)} al fiado de ${emp?.nombre || 'la empresa'}?\n\nSe imprime el ticket para firmar y la mesa queda libre.`, { ok: 'Cargar e imprimir' }))) return;
    try {
      await api.pagar(pedido.id, [{ medio: 'FIADO', importe: total }], { cuenta_id: Number(cuentaId) });
      try { await api.imprimirCuenta(pedido.id, { firma: true }); } catch { /* impresión best-effort */ }
      setCobrando(false); setModoFiado(false); setCuentaId('');
      setPedido(null); nav('/mozo'); cargarMesas();
      toast('✅ Cargado al fiado. Ticket impreso. Mesa liberada.');
    } catch (e) {
      toast(e.message.includes('409') ? 'Ese pedido ya fue cobrado.' : 'No se pudo cargar: ' + e.message, 'error');
    }
  };

  const cancelarPedido = async () => {
    if (!(await confirmar('¿Cancelar TODO el pedido? La mesa queda libre y se devuelve el stock. No se cobra nada.', { peligro: true, ok: 'Cancelar pedido', cancelar: 'Volver' }))) return;
    const motivo = (await preguntar('Motivo de la cancelación (opcional):')) || '';
    try {
      await api.anular(pedido.id, motivo);
      setPedido(null); nav('/mozo'); cargarMesas();
      toast('Pedido cancelado.');
    } catch (e) {
      toast('No se pudo cancelar: ' + e.message, 'error');
    }
  };

  const mesasLibres = mesas.filter((m) => !m.pedido);
  const mesasOcupadas = mesas.filter((m) => m.pedido && m.pedido.id !== pedido?.id);
  const abrirAccion = (a) => { setAccionMesa(a); setMesaDestino(''); };

  const mover = async () => {
    if (!mesaDestino) return;
    try {
      await api.moverPedido(pedido.id, Number(mesaDestino));
      setAccionMesa(null); setPedido(await api.pedido(pedido.id)); cargarMesas();
      toast('Pedido movido de mesa.');
    } catch (e) { toast('No se pudo mover: ' + e.message, 'error'); }
  };
  const unir = async () => {
    const destino = mesas.find((m) => String(m.id) === String(mesaDestino));
    if (!destino?.pedido) return;
    if (!(await confirmar(`¿Unir esta mesa con la Mesa ${destino.numero}? Todos los platos pasan a esa mesa y esta queda libre.`, { ok: 'Unir' }))) return;
    try {
      await api.unirPedido(pedido.id, destino.pedido.id);
      setAccionMesa(null); setPedido(null); nav('/mozo'); cargarMesas();
      toast('Mesas unidas.');
    } catch (e) { toast('No se pudo unir: ' + e.message, 'error'); }
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
          {pedido.total > 0 && (
            <button className="btn-green" onClick={() => { setCobrando(true); setRecibido(''); setModoFiado(false); setCuentaId(''); cargarCuentas(); }}>🧾 Imprimir y cobrar</button>
          )}
          {pedido.mesa && <button onClick={() => abrirAccion('mover')}>🔀 Mover</button>}
          {pedido.mesa && mesasOcupadas.length > 0 && <button onClick={() => abrirAccion('unir')}>🔗 Unir</button>}
          <button className="btn-red" onClick={cancelarPedido}>✖ Cancelar pedido</button>
          <span className="badge warn">{pedido.estado}</span>
        </div>
        {cobrando && (() => {
          const recNum = Number(String(recibido).replace(/[^\d]/g, '')) || 0;
          const vuelto = recNum > 0 ? Math.max(0, recNum - pedido.total) : null;
          return (
            <div className="card" style={{ marginBottom: 12, borderColor: 'var(--green)' }}>
              <h2 className="h2" style={{ marginTop: 0 }}>💵 Cobrar {money(pedido.total)} — {modoFiado ? '¿a qué empresa?' : '¿cómo paga?'}</h2>
              {!modoFiado ? (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <button className="btn-green" onClick={() => cobrarMesa('EFECTIVO')}>💵 Efectivo</button>
                    <button className="btn-blue" onClick={() => cobrarMesa('TARJETA DÉBITO')}>💳 Débito</button>
                    <button className="btn-blue" onClick={() => cobrarMesa('TARJETA CRÉDITO')}>💳 Crédito</button>
                    <button className="btn-blue" onClick={() => cobrarMesa('QR / TRANSFERENCIA')}>📱 QR / Transf.</button>
                    <button className="btn-blue" onClick={() => setModoFiado(true)}>📒 Fiado (empresa)</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ color: 'var(--muted)', fontSize: 13 }}>Efectivo — ¿con cuánto paga? (para el vuelto):</label>
                    <input inputMode="numeric" value={recibido} onChange={(e) => setRecibido(e.target.value)} placeholder="$" style={{ width: 130 }} />
                    {vuelto != null && <b style={{ color: 'var(--green)' }}>Vuelto: {money(vuelto)}</b>}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                    <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
                      <option value="">— elegir empresa —</option>
                      {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} (debe {money(c.saldo)})</option>)}
                    </select>
                    <button onClick={nuevaEmpresaMesa}>+ Nueva empresa</button>
                  </div>
                  <button className="btn-green" style={{ width: '100%', padding: 12 }} onClick={cobrarFiadoMesa}>📒 Cargar al fiado e imprimir (con firma)</button>
                  <button style={{ marginTop: 8 }} onClick={() => setModoFiado(false)}>← Volver a las formas de pago</button>
                </>
              )}
              <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="spacer" />
                <button onClick={() => { setCobrando(false); setModoFiado(false); setRecibido(''); }}>Cancelar</button>
              </div>
            </div>
          );
        })()}
        {accionMesa && (
          <div className="card" style={{ marginBottom: 12, borderColor: 'var(--accent)' }}>
            <h2 className="h2" style={{ marginTop: 0 }}>{accionMesa === 'mover' ? '🔀 Mover a otra mesa' : '🔗 Unir con otra mesa'}</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
              {accionMesa === 'mover'
                ? 'Pasá este pedido a una mesa LIBRE.'
                : 'Pasá los platos de esta mesa a otra mesa OCUPADA (se juntan las dos cuentas).'}
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={mesaDestino} onChange={(e) => setMesaDestino(e.target.value)} style={{ minWidth: 160 }}>
                <option value="">— elegir mesa —</option>
                {(accionMesa === 'mover' ? mesasLibres : mesasOcupadas).map((m) => (
                  <option key={m.id} value={m.id}>Mesa {m.numero}{m.pedido ? ` (${money(m.pedido.total)})` : ' (libre)'}</option>
                ))}
              </select>
              <button className="btn-green" disabled={!mesaDestino} onClick={accionMesa === 'mover' ? mover : unir}>Confirmar</button>
              <button onClick={() => setAccionMesa(null)}>Cancelar</button>
            </div>
          </div>
        )}
        {pedido.items?.filter((i) => i.estado !== 'anulado').length > 0 && (
          <div className="card" style={{ marginBottom: 12 }}>
            <h2 className="h2">Ya enviado a cocina</h2>
            {pedido.items.filter((i) => i.estado !== 'anulado').map((i) => (
              <div key={i.id} className="cart-item">
                <span style={{ flex: 1 }}>{i.cantidad}× {i.nombre} {i.observacion ? `(${i.observacion})` : ''}</span>
                <span className="badge warn">{i.estado}</span>
                <span>{money(i.cantidad * i.precio_unit)}</span>
                <button className="btn-red" title="Quitar plato" onClick={() => quitarItem(i.id)}>✕</button>
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
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <h1 className="h1" style={{ margin: 0 }}>Elegí una mesa</h1>
        <span className="badge warn">{mesas.filter((m) => m.pedido).length} ocupadas / {mesas.length}</span>
        <span className="spacer" />
        <label style={{ fontWeight: 700 }}>👤 Tu nombre:</label>
        <select value={mozo} onChange={(e) => { setMozo(e.target.value); localStorage.setItem('mozo', e.target.value); }}
          style={{ padding: 8, borderColor: mozo ? '' : 'var(--orange)', fontWeight: 700 }}>
          <option value="">— elegí tu nombre —</option>
          {mozos.map((m) => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
        </select>
      </div>
      {!mozo && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--orange)' }}>
          ⚠ Elegí <b>tu nombre</b> arriba antes de tomar pedidos, así la cocina sabe de quién es la comanda.
          {!mozos.length && <> (No hay mozos cargados — pedile al encargado que los cargue en <b>Ajustes → Mozos</b>.)</>}
        </div>
      )}
      <div className="mesas">
        {mesas.map((m) => (
          <div key={m.id} className={'mesa ' + (m.pedido ? 'ocupada' : 'libre')} onClick={() => abrirMesa(m.id)}>
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
