import { useEffect, useState } from 'react';
import { api, socket, money } from '../api';
import { toast, confirmar, preguntar } from '../ui.jsx';

const MEDIOS = ['EFECTIVO', 'TARJETA DÉBITO', 'TARJETA CRÉDITO', 'QR / TRANSFERENCIA', 'FIADO (cuenta corriente)'];
const numAR = (s) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
const esFiadoMedio = (m) => /FIADO/i.test(m);

function nombrePedido(p) {
  if (p.tipo === 'salon') return `Mesa ${p.mesa?.numero ?? '?'}`;
  if (p.tipo === 'delivery') return `🛵 Delivery${p.cliente_nombre ? ' · ' + p.cliente_nombre : ' #' + p.id}`;
  return 'Mostrador #' + p.id;
}

export default function Caja() {
  const [pedidos, setPedidos] = useState([]);
  const [sel, setSel] = useState(null);
  const [cuentas, setCuentas] = useState([]);
  const [cuentaId, setCuentaId] = useState('');
  const [detalleFiado, setDetalleFiado] = useState('');

  // Cobro
  const [descuento, setDescuento] = useState('');
  const [propina, setPropina] = useState('');
  const [mixto, setMixto] = useState(false);
  const [medio, setMedio] = useState('EFECTIVO');
  const [recibido, setRecibido] = useState('');
  const [pagos, setPagos] = useState([{ medio: 'EFECTIVO', importe: '' }]);

  // Arqueo / cierre
  const [verCierre, setVerCierre] = useState(false);
  const [resumen, setResumen] = useState(null);
  const [contado, setContado] = useState('');
  const [imprimir, setImprimir] = useState(true);

  // Movimiento de caja
  const [mov, setMov] = useState(null); // { tipo, importe, detalle }
  // Reabrir
  const [verCobrados, setVerCobrados] = useState(false);
  const [cobrados, setCobrados] = useState([]);
  // Facturación AFIP
  const [factCfg, setFactCfg] = useState({});

  const cargar = () => api.pedidos().then((ps) => setPedidos(ps.filter((p) => p.total > 0 && p.estado !== 'cobrado')));
  const cargarCuentas = () => api.cuentas().then(setCuentas);

  useEffect(() => {
    cargar(); cargarCuentas();
    api.config().then((c) => setFactCfg(c.facturador || {})).catch(() => {});
    const reload = () => cargar();
    ['pedido:actualizado', 'pedido:nuevo', 'pedido:cobrado', 'connect'].forEach((e) => socket.on(e, reload));
    return () => ['pedido:actualizado', 'pedido:nuevo', 'pedido:cobrado', 'connect'].forEach((e) => socket.off(e, reload));
  }, []);

  const elegir = (p) => {
    setSel(p); setDescuento(''); setPropina(''); setMixto(false);
    setMedio('EFECTIVO'); setRecibido(''); setCuentaId(''); setDetalleFiado('');
    setPagos([{ medio: 'EFECTIVO', importe: String(Math.round(p.total)) }]);
  };

  const neto = sel ? Math.max(0, Math.round(sel.total) - numAR(descuento)) : 0;

  // Abre el facturador AFIP con el monto (neto) y el pedido ya cargados
  const facturar = () => {
    if (!sel) return;
    const base = (factCfg.url || 'http://localhost:5000').replace(/\/+$/, '');
    let url = `${base}/?total=${encodeURIComponent(neto)}&pedido=${encodeURIComponent(sel.id)}`;
    if (sel.mozo_nombre) url += `&mozo=${encodeURIComponent(sel.mozo_nombre)}`;
    window.open(url, '_blank', 'noopener');
  };
  // Montos sugeridos para el pago en efectivo (justo + redondeos hacia arriba)
  const sugeridos = () => {
    const s = new Set([neto]);
    [1000, 5000, 10000].forEach((r) => { const up = Math.ceil(neto / r) * r; if (up > neto) s.add(up); });
    return [...s].sort((a, b) => a - b).slice(0, 4);
  };
  const asignado = pagos.reduce((s, x) => s + numAR(x.importe), 0);
  const falta = neto - asignado;
  const vuelto = (!mixto && medio === 'EFECTIVO' && recibido) ? numAR(recibido) - neto : null;
  const hayFiado = mixto ? pagos.some((x) => esFiadoMedio(x.medio)) : esFiadoMedio(medio);

  const cobrar = async () => {
    if (!sel) return;
    let cuerpoPagos;
    if (mixto) {
      if (Math.abs(falta) > 1) { toast(`Los pagos no suman el neto. Falta asignar ${money(falta)}.`, 'error'); return; }
      cuerpoPagos = pagos.filter((x) => numAR(x.importe) > 0)
        .map((x) => ({ medio: esFiadoMedio(x.medio) ? 'FIADO' : x.medio, importe: Math.round(numAR(x.importe)) }));
    } else {
      cuerpoPagos = [{ medio: esFiadoMedio(medio) ? 'FIADO' : medio, importe: neto }];
      if (medio === 'EFECTIVO' && recibido && numAR(recibido) < neto) {
        if (!(await confirmar('Lo recibido es MENOR al neto. ¿Cobrar igual?'))) return;
      }
    }
    if (hayFiado && !cuentaId) { toast('Elegí a qué cuenta corriente va el fiado.', 'error'); return; }
    // Confirmación con el DETALLE del medio de pago y el vuelto (evita cobrar en el medio equivocado)
    const nombreMedio = (m) => (esFiadoMedio(m) ? 'Fiado' : m);
    const detalleCobro = mixto
      ? cuerpoPagos.map((x) => `• ${nombreMedio(x.medio)}: ${money(x.importe)}`).join('\n')
      : `• ${nombreMedio(medio)}`;
    const lineaVuelto = (!mixto && medio === 'EFECTIVO' && vuelto != null && vuelto >= 0)
      ? `\nPaga con ${money(numAR(recibido))} → vuelto ${money(vuelto)}` : '';
    const msgConfirm = `Cobrar ${money(neto)}${numAR(propina) ? ' + propina ' + money(numAR(propina)) : ''}\n\nMedio de pago:\n${detalleCobro}${lineaVuelto}\n\n¿Confirmás?`;
    if (!(await confirmar(msgConfirm, { ok: 'Cobrar' }))) return;
    try {
      await api.pagar(sel.id, cuerpoPagos, {
        cuenta_id: hayFiado ? Number(cuentaId) : undefined,
        detalle: hayFiado ? (detalleFiado || null) : undefined,
        descuento: numAR(descuento), propina: numAR(propina),
      });
      // Fiado: imprimir el ticket con espacio de FIRMA como comprobante de la deuda (best-effort).
      if (hayFiado) { try { await api.imprimirCuenta(sel.id, { firma: true }); } catch { /* ignorar */ } }
      setSel(null); cargar(); cargarCuentas();
      toast(hayFiado ? '✅ Cargado al fiado. Ticket impreso.' : '✅ Cobrado.');
    } catch (e) {
      toast(e.message.includes('409') ? 'Ese pedido ya fue cobrado.' : 'No se pudo cobrar: ' + e.message, 'error');
      cargar();
    }
  };

  // ---- Arqueo ----
  const abrirCierre = async () => { setResumen(await api.cajaResumen()); setContado(''); setVerCierre(true); };
  const dif = resumen && contado !== '' ? numAR(contado) - resumen.esperado : null;
  const cerrarCaja = async () => {
    if (!(await confirmar('¿Cerrar la caja del período? Se registra el arqueo y empieza uno nuevo.', { ok: 'Cerrar caja' }))) return;
    const r = await api.cajaCerrar({ imprimir, contado: contado === '' ? null : numAR(contado) });
    toast(`✅ Caja cerrada (Cierre #${r.cierre.id}).`);
    setResumen(await api.cajaResumen()); setContado('');
  };
  const guardarMov = async () => {
    const imp = numAR(mov.importe);
    if (!(imp > 0)) { toast('Importe inválido', 'error'); return; }
    await api.cajaMovimiento({ tipo: mov.tipo, importe: imp, detalle: mov.detalle || null });
    setMov(null);
    if (verCierre) setResumen(await api.cajaResumen());
    toast('✅ Movimiento registrado.');
  };

  // ---- Reabrir ----
  const abrirCobrados = async () => { setCobrados(await api.pedidos('cobrado')); setVerCobrados(true); };
  const reabrir = async (p) => {
    if (!(await confirmar(`¿Reabrir ${nombrePedido(p)} (${money(p.total)})? Se anula el cobro para volver a cobrarlo.`, { ok: 'Reabrir' }))) return;
    await api.reabrirPedido(p.id);
    toast('✅ Pedido reabierto. Ya podés cobrarlo de nuevo.');
    setCobrados(await api.pedidos('cobrado')); cargar();
  };

  const setPagoRow = (i, campo, val) => setPagos((ps) => ps.map((x, j) => (j === i ? { ...x, [campo]: val } : x)));

  // Crear una empresa/cuenta corriente al vuelo, sin ir a la pantalla de Cuentas
  const nuevaEmpresa = async () => {
    const nombre = await preguntar('Nombre de la empresa (o persona) para el fiado:');
    if (!nombre || !nombre.trim()) return;
    try {
      const c = await api.crearCuenta({ nombre: nombre.trim() });
      await cargarCuentas();
      setCuentaId(String(c.id));
      toast('Empresa creada.');
    } catch (e) { toast('No se pudo crear la empresa: ' + e.message, 'error'); }
  };

  const cancelarPedido = async (p, e) => {
    e.stopPropagation();
    if (!(await confirmar(`¿Cancelar ${nombrePedido(p)} (${money(p.total)})? Se devuelve el stock. NO se cobra.`, { peligro: true, ok: 'Cancelar' }))) return;
    const motivo = (await preguntar('Motivo (opcional):')) || '';
    try {
      await api.anular(p.id, motivo);
      if (sel?.id === p.id) setSel(null);
      cargar(); toast('Pedido cancelado.');
    } catch (err) { toast('No se pudo cancelar: ' + err.message, 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="h1" style={{ margin: 0 }}>Caja</h1>
        <span className="spacer" />
        <button onClick={() => setMov({ tipo: 'apertura', importe: '', detalle: '' })}>💵 Fondo</button>
        <button onClick={() => setMov({ tipo: 'egreso', importe: '', detalle: '' })}>📤 Egreso</button>
        <button onClick={abrirCobrados}>↩ Reabrir cobro</button>
        <button className="btn-accent" onClick={abrirCierre}>📊 Cierre / Arqueo</button>
      </div>

      {/* Movimiento de caja */}
      {mov && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
          <h2 className="h2" style={{ marginTop: 0 }}>
            {mov.tipo === 'apertura' ? '💵 Fondo de caja (apertura)' : mov.tipo === 'egreso' ? '📤 Egreso / retiro' : '📥 Ingreso'}
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
            {mov.tipo === 'apertura' ? 'Plata con la que arrancás la caja (cambio).'
              : mov.tipo === 'egreso' ? 'Plata que sacás de la caja (pagar proveedor, retiro).'
              : 'Plata que entra a la caja (no por venta).'}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input autoFocus placeholder="Importe $" value={mov.importe} onChange={(e) => setMov({ ...mov, importe: e.target.value })} style={{ width: 140 }} />
            <input placeholder="Detalle (opcional)" value={mov.detalle} onChange={(e) => setMov({ ...mov, detalle: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
            <button className="btn-green" onClick={guardarMov}>Registrar</button>
            <button onClick={() => setMov(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Cobrados (reabrir) */}
      {verCobrados && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h2 className="h2" style={{ margin: 0 }}>Pedidos cobrados (reabrir)</h2>
            <span className="spacer" />
            <button onClick={() => setVerCobrados(false)}>✕ cerrar</button>
          </div>
          {!cobrados.length && <p style={{ color: 'var(--muted)' }}>No hay pedidos cobrados.</p>}
          {cobrados.map((p) => (
            <div key={p.id} className="cart-item">
              <span style={{ flex: 1 }}>{nombrePedido(p)} · {money(p.total)}</span>
              <button className="btn-red" onClick={() => reabrir(p)}>↩ Reabrir</button>
            </div>
          ))}
        </div>
      )}

      {/* Arqueo / cierre */}
      {verCierre && resumen && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h2 className="h2" style={{ margin: 0 }}>Arqueo del período</h2>
            <span className="spacer" />
            <button onClick={() => setVerCierre(false)}>✕ cerrar</button>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>Desde {resumen.desde}</p>
          {resumen.ventas.map((m) => (
            <div key={m.medio} className="cart-item"><span style={{ flex: 1 }}>{m.medio} ({m.n})</span><b>{money(m.total)}</b></div>
          ))}
          <div className="total-row"><span>Total ventas ({resumen.tickets} tickets)</span><span>{money(resumen.totalVentas)}</span></div>
          {resumen.descuentos > 0 && <div className="cart-item"><span style={{ flex: 1 }}>Descuentos otorgados</span><b>{money(resumen.descuentos)}</b></div>}
          {resumen.propinas > 0 && <div className="cart-item"><span style={{ flex: 1 }}>Propinas</span><b>{money(resumen.propinas)}</b></div>}
          {resumen.fiadoCobradoTotal > 0 && <div className="cart-item"><span style={{ flex: 1 }}>Cobros de fiado recibidos</span><b>{money(resumen.fiadoCobradoTotal)}</b></div>}
          {resumen.ventaFiado > 0 && <div className="cart-item" style={{ color: 'var(--orange)' }}><span style={{ flex: 1 }}>Fiado nuevo (a cobrar)</span><b>{money(resumen.ventaFiado)}</b></div>}

          <h2 className="h2" style={{ marginTop: 12 }}>🧮 Arqueo de efectivo</h2>
          <div className="cart-item"><span style={{ flex: 1 }}>Fondo inicial</span><b>{money(resumen.fondo)}</b></div>
          <div className="cart-item"><span style={{ flex: 1 }}>Ventas en efectivo</span><b>{money(resumen.ventaEfectivo)}</b></div>
          {resumen.fiadoCobradoEfectivo > 0 && <div className="cart-item"><span style={{ flex: 1 }}>Fiado cobrado en efectivo</span><b>{money(resumen.fiadoCobradoEfectivo)}</b></div>}
          {resumen.ingresos > 0 && <div className="cart-item"><span style={{ flex: 1 }}>Ingresos</span><b>{money(resumen.ingresos)}</b></div>}
          {resumen.egresos > 0 && <div className="cart-item" style={{ color: 'var(--orange)' }}><span style={{ flex: 1 }}>Egresos / retiros</span><b>−{money(resumen.egresos)}</b></div>}
          <div className="total-row" style={{ color: 'var(--green)' }}><span>💵 Efectivo esperado</span><span>{money(resumen.esperado)}</span></div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <label>Efectivo contado:</label>
            <input placeholder="$ contado" value={contado} onChange={(e) => setContado(e.target.value)} style={{ width: 140 }} />
            {dif != null && (
              <b style={{ color: dif === 0 ? 'var(--green)' : (dif > 0 ? 'var(--accent)' : '#e5484d') }}>
                {dif === 0 ? '✓ Cuadra' : dif > 0 ? `Sobra ${money(dif)}` : `Falta ${money(-dif)}`}
              </b>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setMov({ tipo: 'apertura', importe: '', detalle: '' })}>💵 Cargar fondo</button>
            <button onClick={() => setMov({ tipo: 'egreso', importe: '', detalle: '' })}>📤 Egreso</button>
            <span className="spacer" />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={imprimir} onChange={(e) => setImprimir(e.target.checked)} /> Imprimir
            </label>
            <button className="btn-green" onClick={cerrarCaja}>🔒 Cerrar caja</button>
          </div>
        </div>
      )}

      {/* Cobro */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div>
          <h2 className="h2">Pedidos por cobrar</h2>
          {!pedidos.length && <p style={{ color: 'var(--muted)' }}>Nada por cobrar.</p>}
          {pedidos.map((p) => (
            <div key={p.id} className="card" style={{ marginBottom: 8, cursor: 'pointer', borderColor: sel?.id === p.id ? 'var(--accent)' : '' }} onClick={() => elegir(p)}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>{nombrePedido(p)} {p.factura_ref ? '🧾' : ''}</b>
                <b style={{ color: 'var(--accent)' }}>{money(p.total)}</b>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ color: 'var(--muted)', fontSize: 13, flex: 1 }}>{p.mozo_nombre} · {p.estado} · {p.items?.length || 0} ítems</span>
                <button title="Cancelar pedido (no cobra)" onClick={(e) => cancelarPedido(p, e)} style={{ fontSize: 12 }}>✖ Cancelar</button>
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          {!sel && <p style={{ color: 'var(--muted)' }}>Seleccioná un pedido para cobrar.</p>}
          {sel && (
            <>
              <h2 className="h2">{nombrePedido(sel)}</h2>
              {sel.items?.map((i) => (
                <div key={i.id} className="cart-item">
                  <span style={{ flex: 1 }}>{i.cantidad}× {i.nombre}</span>
                  <span>{money(i.cantidad * i.precio_unit)}</span>
                </div>
              ))}
              <div className="cart-item"><span style={{ flex: 1 }}>Subtotal</span><span>{money(sel.total)}</span></div>
              <div style={{ display: 'flex', gap: 8, margin: '6px 0', flexWrap: 'wrap' }}>
                <label style={{ color: 'var(--muted)' }}>Descuento $</label>
                <input value={descuento} onChange={(e) => setDescuento(e.target.value)} style={{ width: 100 }} placeholder="0" />
                <label style={{ color: 'var(--muted)' }}>Propina $</label>
                <input value={propina} onChange={(e) => setPropina(e.target.value)} style={{ width: 100 }} placeholder="0" />
              </div>
              <div className="total-row"><span>A cobrar (neto)</span><span>{money(neto)}</span></div>

              {sel.factura_ref ? (
                <div style={{ marginTop: 6, color: 'var(--green)', fontWeight: 700 }}>🧾 Facturado — {sel.factura_ref}</div>
              ) : factCfg.habilitado ? (
                <button onClick={facturar} style={{ marginTop: 6 }} title="Abre el facturador AFIP con el total ya cargado">
                  🧾 Facturar {money(neto)} (AFIP)
                </button>
              ) : null}

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0' }}>
                <input type="checkbox" checked={mixto} onChange={(e) => setMixto(e.target.checked)} /> Pago mixto (varios medios)
              </label>

              {!mixto ? (
                <>
                  <select value={medio} onChange={(e) => setMedio(e.target.value)} style={{ width: '100%', marginBottom: 10 }}>
                    {MEDIOS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                  {medio === 'EFECTIVO' && (
                    <>
                      <input placeholder="¿Con cuánto paga? $" value={recibido} onChange={(e) => setRecibido(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {sugeridos().map((v) => (
                          <button key={v} onClick={() => setRecibido(String(v))} style={{ padding: '6px 12px' }}>
                            {v === neto ? 'Justo' : money(v)}
                          </button>
                        ))}
                      </div>
                      {vuelto != null && vuelto >= 0 && (
                        <div style={{ marginBottom: 8, fontSize: 18 }}>Vuelto: <b style={{ color: 'var(--green)' }}>{money(vuelto)}</b></div>
                      )}
                      {vuelto != null && vuelto < 0 && (
                        <div style={{ marginBottom: 8, color: 'var(--orange)' }}>Falta: <b>{money(-vuelto)}</b></div>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div style={{ marginBottom: 10 }}>
                  {pagos.map((row, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <select value={row.medio} onChange={(e) => setPagoRow(i, 'medio', e.target.value)} style={{ flex: 1 }}>
                        {MEDIOS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                      <input placeholder="$" value={row.importe} onChange={(e) => setPagoRow(i, 'importe', e.target.value)} style={{ width: 100 }} />
                      {pagos.length > 1 && <button className="btn-red" onClick={() => setPagos((ps) => ps.filter((_, j) => j !== i))}>✕</button>}
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button onClick={() => setPagos((ps) => [...ps, { medio: 'TARJETA DÉBITO', importe: String(Math.max(0, falta)) }])}>+ Agregar medio</button>
                    <span style={{ color: Math.abs(falta) > 1 ? 'var(--orange)' : 'var(--green)', fontSize: 13 }}>
                      {Math.abs(falta) <= 1 ? '✓ Asignado' : (falta > 0 ? `Falta ${money(falta)}` : `Sobra ${money(-falta)}`)}
                    </span>
                  </div>
                </div>
              )}

              {hayFiado && (
                <div style={{ marginBottom: 10 }}>
                  <label className="h2">Empresa / cuenta corriente del fiado</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} style={{ flex: 1 }}>
                      <option value="">— elegir empresa —</option>
                      {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} (debe {money(c.saldo)})</option>)}
                    </select>
                    <button onClick={nuevaEmpresa}>+ Nueva</button>
                  </div>
                  <input placeholder="A nombre de (opcional)" value={detalleFiado} onChange={(e) => setDetalleFiado(e.target.value)} style={{ width: '100%', marginTop: 8 }} />
                </div>
              )}

              <button className="btn-green" style={{ width: '100%', padding: 14 }} onClick={cobrar}>✅ Confirmar cobro {money(neto)}</button>
              <button style={{ width: '100%', marginTop: 8 }} onClick={() => api.imprimirCuenta(sel.id)}>🖨 Imprimir cuenta</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
