import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, money, setOperador } from '../api';
import OrderTaker from '../components/OrderTaker.jsx';
import { toast, confirmar, preguntar } from '../ui.jsx';

const MEDIOS = ['EFECTIVO', 'TARJETA DÉBITO', 'TARJETA CRÉDITO', 'QR / TRANSFERENCIA', 'FIADO'];
const numAR = (v) => Number(String(v).replace(/[^\d]/g, '')) || 0;

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
  const [propina, setPropina] = useState('');          // propina (se registra aparte del total)
  const [mixto, setMixto] = useState(false);           // pago con varios medios a la vez
  const [pagos, setPagos] = useState([{ medio: 'EFECTIVO', importe: '' }]); // renglones del pago mixto
  const [buscarMesa, setBuscarMesa] = useState('');    // buscador de mesas (número / nombre / mozo)
  const [soloMias, setSoloMias] = useState(() => localStorage.getItem('soloMisMesas') === '1'); // ver solo mis mesas (+ libres)

  const cargarMesas = () => api.mesas().then(setMesas);
  const cargarCuentas = () => api.cuentas().then(setCuentas).catch(() => {});
  useEffect(() => {
    cargarMesas();
    cargarCuentas();
    api.usuarios().then((u) => setMozos(u.filter((x) => x.rol === 'mozo' || x.rol === 'admin')));
    // Mantener sincronizado con el chip de nombre de la barra superior
    const onOp = (e) => setMozo(e.detail ?? (localStorage.getItem('mozo') || ''));
    window.addEventListener('operador-change', onOp);
    return () => window.removeEventListener('operador-change', onOp);
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

  // Ítems cargados en el carrito que TODAVÍA no se enviaron a cocina (borrador local del OrderTaker)
  const itemsSinEnviar = () => {
    try {
      const d = JSON.parse(localStorage.getItem('cart_draft_' + pedido.id) || '[]');
      return Array.isArray(d) ? d.reduce((s, x) => s + (Number(x.cantidad) || 0), 0) : 0;
    } catch { return 0; }
  };
  // Aviso si va a imprimir/cobrar con cosas cargadas pero SIN enviar a cocina (no entrarían en la cuenta)
  const confirmarSinEnviar = async () => {
    const n = itemsSinEnviar();
    if (!n) return true;
    return await confirmar(
      `⚠ Tenés ${n} ítem(s) cargado(s) SIN enviar a cocina. Si seguís, NO entran en la cuenta.\n\nVolvé al carrito y tocá "Enviar a cocina" primero.`,
      { peligro: true, ok: 'Seguir igual', cancelar: 'Volver y enviar' }
    );
  };

  // Solo IMPRIMIR la cuenta (no cobra; la mesa queda abierta). Para llevar el ticket a la mesa antes de saber cómo paga.
  const imprimirCuentaMesa = async () => {
    if (!(await confirmarSinEnviar())) return;
    try {
      const r = await api.imprimirCuenta(pedido.id);
      const m = r.resultado?.modo;
      toast(m === 'impreso' ? '🧾 Cuenta impresa.' : m === 'archivo' ? '🧾 Cuenta generada (sin impresora, guardada en archivo).' : 'No se pudo imprimir la cuenta.', m === 'impreso' ? 'ok' : 'info');
    } catch (e) { toast('No se pudo imprimir: ' + e.message, 'error'); }
  };

  // Abrir el cobro (antes chequea que no queden ítems sin enviar)
  const abrirCobro = async () => {
    if (!(await confirmarSinEnviar())) return;
    setCobrando(true); setRecibido(''); setModoFiado(false); setCuentaId('');
    setPropina(''); setMixto(false); setPagos([{ medio: 'EFECTIVO', importe: String(Math.round(pedido.total)) }]);
    cargarCuentas();
  };
  const cerrarCobro = () => {
    setCobrando(false); setModoFiado(false); setRecibido(''); setPropina(''); setMixto(false); setCuentaId('');
  };
  const setPagoRow = (i, campo, valor) => setPagos((ps) => ps.map((r, j) => (j === i ? { ...r, [campo]: valor } : r)));

  // Registra el cobro en la caja con la forma de pago elegida y libera la mesa. NO imprime (la cuenta se imprime aparte).
  const cobrarMesa = async (medio) => {
    const total = pedido.total;
    const rec = numAR(recibido);
    let propinaN = numAR(propina);
    let extra = '';
    if (medio === 'EFECTIVO') {
      if (rec > 0) extra = `\nPaga con ${money(rec)} → vuelto ${money(Math.max(0, rec - total))}`;
    } else if (rec > total && propinaN === 0) {
      // Pagó de más con tarjeta/transferencia (no hay vuelto) → el excedente es propina.
      propinaN = rec - total;
    }
    const lineaProp = propinaN > 0 ? `\nPropina: ${money(propinaN)} (se registra aparte)` : '';
    if (!(await confirmar(`¿Cobrar ${money(total)} en ${medio}?${lineaProp}${extra}\n\nLa mesa queda libre.`, { ok: 'Cobrar' }))) return;
    try {
      await api.pagar(pedido.id, [{ medio, importe: total }], { propina: propinaN }); // registra la venta + propina y libera la mesa
      cerrarCobro();
      setPedido(null); nav('/mozo'); cargarMesas();
      toast('✅ Cobrado. Mesa liberada.');
    } catch (e) {
      toast(e.message.includes('409') ? 'Ese pedido ya fue cobrado.' : 'No se pudo cobrar: ' + e.message, 'error');
    }
  };

  // Cobro con VARIOS medios a la vez (ej. una parte en efectivo y otra por transferencia).
  const cobrarMixtoMesa = async () => {
    const total = pedido.total;
    const propinaN = numAR(propina);
    const rows = pagos.filter((x) => numAR(x.importe) > 0).map((x) => ({ medio: x.medio, importe: numAR(x.importe) }));
    const suma = rows.reduce((a, x) => a + x.importe, 0);
    if (!rows.length) { toast('Cargá al menos un medio con importe.', 'error'); return; }
    if (Math.abs(suma - total) > 1) {
      toast(`Los pagos deben sumar ${money(total)}. Ahora suman ${money(suma)}.`, 'error'); return;
    }
    const hayFiado = rows.some((x) => /FIADO/i.test(x.medio));
    if (hayFiado && !cuentaId) { toast('Elegí la empresa para la parte en fiado.', 'error'); return; }
    const detalle = rows.map((x) => `• ${x.medio}: ${money(x.importe)}`).join('\n');
    const lineaProp = propinaN > 0 ? `\nPropina: ${money(propinaN)} (aparte)` : '';
    if (!(await confirmar(`¿Cobrar ${money(total)}?${lineaProp}\n\n${detalle}\n\nLa mesa queda libre.`, { ok: 'Cobrar' }))) return;
    try {
      await api.pagar(pedido.id, rows, { propina: propinaN, cuenta_id: hayFiado ? Number(cuentaId) : undefined });
      if (hayFiado) { try { await api.imprimirCuenta(pedido.id, { firma: true }); } catch { /* best-effort */ } }
      cerrarCobro();
      setPedido(null); nav('/mozo'); cargarMesas();
      toast('✅ Cobrado. Mesa liberada.');
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

  // Poner/cambiar el nombre de una mesa (etiqueta para identificarla rápido)
  const renombrarMesa = async (e, m) => {
    e.stopPropagation();
    const nombre = await preguntar('Nombre de la mesa (ej. Ventana, Barra 1). Dejalo vacío para usar solo el número:', m.nombre || '');
    if (nombre === null) return;
    try { await api.renombrarMesa(m.id, nombre.trim()); cargarMesas(); }
    catch (err) { toast('No se pudo renombrar: ' + err.message, 'error'); }
  };
  // Minutos desde que se abrió la mesa (para saber cuál lleva más tiempo esperando)
  const minutosDesde = (ts) => {
    if (!ts) return null;
    const min = Math.round((Date.now() - new Date(ts.replace(' ', 'T')).getTime()) / 60000);
    return min >= 0 && min < 1440 ? min : null;
  };
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
            <>
              <button className="btn-blue" onClick={imprimirCuentaMesa}>🧾 Imprimir cuenta</button>
              <button className="btn-green" onClick={abrirCobro}>💵 Cobrar</button>
            </>
          )}
          {pedido.mesa && <button onClick={() => abrirAccion('mover')}>🔀 Mover</button>}
          {pedido.mesa && mesasOcupadas.length > 0 && <button onClick={() => abrirAccion('unir')}>🔗 Unir</button>}
          <button className="btn-red" onClick={cancelarPedido}>✖ Cancelar pedido</button>
          <span className="badge warn">{pedido.estado}</span>
        </div>
        {cobrando && (() => {
          const total = pedido.total;
          const recNum = numAR(recibido);
          const propNum = numAR(propina);
          const sumaMixto = pagos.reduce((a, x) => a + numAR(x.importe), 0);
          const faltaMixto = total - sumaMixto;
          const hayFiadoMixto = pagos.some((x) => /FIADO/i.test(x.medio));
          const excedente = recNum > total ? recNum - total : 0; // pagó de más → vuelto (efvo) o propina (tarjeta/transf)
          const vuelto = recNum > 0 ? Math.max(0, recNum - total) : null;
          return (
            <div className="card" style={{ marginBottom: 12, borderColor: 'var(--green)' }}>
              <h2 className="h2" style={{ marginTop: 0 }}>💵 Cobrar {money(total)} — {modoFiado ? '¿a qué empresa?' : '¿cómo paga?'}</h2>
              {!modoFiado ? (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                    <label style={{ color: 'var(--muted)', fontSize: 13 }}>🎁 Propina (opcional) $</label>
                    <input inputMode="numeric" value={propina} onChange={(e) => setPropina(e.target.value)} placeholder="0" style={{ width: 120 }} />
                    {propNum > 0 && <b style={{ color: 'var(--green)' }}>Total con propina: {money(total + propNum)}</b>}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <input type="checkbox" checked={mixto} onChange={(e) => setMixto(e.target.checked)} /> 🔀 Pago mixto (una parte con cada medio)
                  </label>
                  {!mixto ? (
                    <>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                        <button className="btn-green" onClick={() => cobrarMesa('EFECTIVO')}>💵 Efectivo</button>
                        <button className="btn-blue" onClick={() => cobrarMesa('TARJETA DÉBITO')}>💳 Débito</button>
                        <button className="btn-blue" onClick={() => cobrarMesa('TARJETA CRÉDITO')}>💳 Crédito</button>
                        <button className="btn-blue" onClick={() => cobrarMesa('QR / TRANSFERENCIA')}>📱 QR / Transf.</button>
                        <button className="btn-blue" onClick={() => setModoFiado(true)}>📒 Fiado (empresa)</button>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ color: 'var(--muted)', fontSize: 13 }}>¿Con cuánto pagó? (opcional):</label>
                        <input inputMode="numeric" value={recibido} onChange={(e) => setRecibido(e.target.value)} placeholder="$" style={{ width: 130 }} />
                        {vuelto != null && vuelto > 0 && <span>💵 Vuelto (efectivo): <b style={{ color: 'var(--green)' }}>{money(vuelto)}</b></span>}
                        {excedente > 0 && propNum === 0 && (
                          <span style={{ color: 'var(--muted)', fontSize: 13 }}>Si paga con tarjeta/transf, los {money(excedente)} de más se registran como <b>propina</b>.</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>Repartí el total en varios medios. Deben sumar {money(total)} (la propina va aparte, arriba).</p>
                      {pagos.map((row, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <select value={row.medio} onChange={(e) => setPagoRow(i, 'medio', e.target.value)} style={{ flex: 1 }}>
                            {MEDIOS.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                          <input inputMode="numeric" placeholder="$" value={row.importe} onChange={(e) => setPagoRow(i, 'importe', e.target.value)} style={{ width: 110 }} />
                          {pagos.length > 1 && <button className="btn-red" onClick={() => setPagos((ps) => ps.filter((_, j) => j !== i))}>✕</button>}
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                        <button onClick={() => setPagos((ps) => [...ps, { medio: 'TARJETA DÉBITO', importe: String(Math.max(0, faltaMixto)) }])}>+ Agregar medio</button>
                        <span style={{ color: Math.abs(faltaMixto) > 1 ? 'var(--orange)' : 'var(--green)', fontSize: 14, fontWeight: 700 }}>
                          {Math.abs(faltaMixto) <= 1 ? '✓ Asignado' : (faltaMixto > 0 ? `Falta ${money(faltaMixto)}` : `Sobra ${money(-faltaMixto)}`)}
                        </span>
                      </div>
                      {hayFiadoMixto && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                          <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
                            <option value="">— empresa del fiado —</option>
                            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} (debe {money(c.saldo)})</option>)}
                          </select>
                          <button onClick={nuevaEmpresaMesa}>+ Nueva empresa</button>
                        </div>
                      )}
                      <button className="btn-green" style={{ width: '100%', padding: 12 }} onClick={cobrarMixtoMesa}>✅ Cobrar mixto {money(total)}</button>
                    </>
                  )}
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
                <button onClick={cerrarCobro}>Cancelar</button>
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
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="h1" style={{ margin: 0 }}>Elegí una mesa</h1>
        <span className="badge warn">{mesas.filter((m) => m.pedido).length} ocupadas / {mesas.length}</span>
        <span className="spacer" />
        <label style={{ fontWeight: 700 }}>👤 Tu nombre:</label>
        <select value={mozo} onChange={(e) => { setMozo(e.target.value); setOperador(e.target.value); }}
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
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={buscarMesa} onChange={(e) => setBuscarMesa(e.target.value)}
          placeholder="🔎 Buscar mesa por número, nombre o mozo..." style={{ flex: 1, minWidth: 220, maxWidth: 420 }} />
        {mozo && (
          <button className={soloMias ? 'btn-accent' : ''}
            onClick={() => { const v = !soloMias; setSoloMias(v); localStorage.setItem('soloMisMesas', v ? '1' : '0'); }}
            title="Ver solo tus mesas (y las libres). Ideal para noches movidas.">
            {soloMias ? '👤 Solo mis mesas ✓' : '👤 Solo mis mesas'}
          </button>
        )}
      </div>
      <div className="mesas">
        {mesas
          .filter((m) => {
            if (soloMias && mozo && m.pedido && m.pedido.mozo_nombre !== mozo) return false; // ocupadas de otros mozos
            const q = buscarMesa.trim().toLowerCase();
            if (!q) return true;
            return String(m.numero).includes(q) || (m.nombre || '').toLowerCase().includes(q) || (m.pedido?.mozo_nombre || '').toLowerCase().includes(q);
          })
          .map((m) => {
            const mins = m.pedido ? minutosDesde(m.pedido.abierto_en) : null;
            return (
              <div key={m.id} className={'mesa ' + (m.pedido ? 'ocupada' : 'libre')} style={{ position: 'relative' }} onClick={() => abrirMesa(m.id)}>
                <button onClick={(e) => renombrarMesa(e, m)} title="Poner nombre a la mesa"
                  style={{ position: 'absolute', top: 3, right: 3, padding: '2px 6px', fontSize: 12, background: 'transparent' }}>✏</button>
                <div className="num" style={m.nombre ? { fontSize: 18, lineHeight: 1.1 } : undefined}>{m.nombre || m.numero}</div>
                <div className="est">{m.nombre ? 'Mesa ' + m.numero : m.sala}</div>
                {m.pedido
                  ? <><div className="tot">{money(m.pedido.total)}</div><div className="est">{m.pedido.mozo_nombre || ''}{mins != null ? ` · ${mins}m` : ''}</div></>
                  : <div className="est">libre</div>}
              </div>
            );
          })}
      </div>
    </div>
  );
}
