import { useEffect, useState } from 'react';
import { api, money } from '../api';
import { toast, confirmar } from '../ui.jsx';

// Seguimiento de las transferencias "prometidas" (por confirmar), para que no se escapen cobros.
// Flujo: por confirmar → (llegó) ✅ / (no llega) 📲 recordar → (sigue sin llegar) 📒 pasar a fiado.
export default function Transferencias() {
  const [lista, setLista] = useState([]);
  const [total, setTotal] = useState(0);
  const [cuentas, setCuentas] = useState([]);
  const [fiadoId, setFiadoId] = useState(null);   // id del pago que se está pasando a fiado
  const [cuentaSel, setCuentaSel] = useState('');
  const [otroId, setOtroId] = useState(null);     // id del pago al que se le cambia el medio
  const [cargando, setCargando] = useState(false);

  const cargar = () => api.transferenciasPendientes().then((r) => { setLista(r.pendientes || []); setTotal(r.total || 0); }).catch(() => {});
  useEffect(() => { cargar(); api.cuentas().then(setCuentas).catch(() => {}); }, []);

  const confirmarLlego = async (p) => {
    if (!(await confirmar(`¿Confirmás que ENTRÓ la transferencia de ${money(p.importe)} de ${p.cliente_nombre || 'el cliente'}?`, { ok: '✅ Sí, llegó' }))) return;
    try { await api.confirmarPago(p.id); toast('✅ Confirmada.'); cargar(); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };

  const recordar = async (p) => {
    if (!p.cliente_telefono) { toast('Ese pedido no tiene teléfono para avisar.', 'error'); return; }
    if (!(await confirmar(`¿Mandarle un recordatorio por WhatsApp a ${p.cliente_nombre || p.cliente_telefono}?`, { ok: '📲 Enviar' }))) return;
    try { const r = await api.recordarPago(p.id); toast(r.avisado ? '📲 Recordatorio enviado.' : '⚠ No se pudo enviar (¿WhatsApp desconectado?).', r.avisado ? 'ok' : 'error'); cargar(); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };

  const recordarVencidas = async () => {
    if (!(await confirmar('¿Mandar recordatorio por WhatsApp a TODAS las que ya llevan 1 día o más sin confirmar?', { ok: '📲 Recordar a todas' }))) return;
    setCargando(true);
    try {
      const r = await api.recordarVencidas(1);
      toast(`📲 ${r.enviados} enviado(s)${r.sinTel ? ` · ${r.sinTel} sin teléfono` : ''}.`);
      cargar();
    } catch (e) { toast('No se pudo: ' + e.message, 'error'); }
    finally { setCargando(false); }
  };

  const pasarAFiado = async (p) => {
    if (!cuentaSel) { toast('Elegí la cuenta corriente.', 'error'); return; }
    const c = cuentas.find((x) => String(x.id) === String(cuentaSel));
    if (!(await confirmar(`¿Pasar ${money(p.importe)} al fiado de ${c?.nombre || 'la cuenta'}? Queda como deuda del cliente.`, { ok: '📒 Pasar a fiado' }))) return;
    try { await api.pasarPagoAFiado(p.id, Number(cuentaSel)); toast('📒 Pasada a fiado.'); setFiadoId(null); setCuentaSel(''); cargar(); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };

  const cambiarMedio = async (p, medio) => {
    if (!medio) return;
    try { await api.cambiarMedioPago(p.id, medio); toast(`✅ Marcada como cobrada en ${medio}.`); setOtroId(null); cargar(); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };

  const vencidas = lista.filter((p) => (p.dias || 0) >= 1).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>💸 Transferencias por confirmar</h1>
        <span className="spacer" style={{ flex: 1 }} />
        {total > 0 && <span className="badge warn">{lista.length} · {money(total)}</span>}
        {vencidas > 0 && <button className="btn-blue" disabled={cargando} onClick={recordarVencidas}>📲 Recordar a las {vencidas} vencidas</button>}
      </div>

      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Son las transferencias que el cliente <b>prometió</b> pero todavía no viste entrar. Revisá tu homebanking/Mercado Pago
        y tocá <b>✅ Llegó</b> en las que ya entraron. A las que se atrasan, mandales un recordatorio; si aun así no llegan, pasalas a fiado.
      </p>

      {!lista.length && <div className="card" style={{ color: 'var(--muted)' }}>🎉 No hay transferencias pendientes. ¡Todo cobrado!</div>}

      <div className="grid" style={{ gap: 10 }}>
        {lista.map((p) => {
          const dias = p.dias || 0;
          const vencida = dias >= 1;
          return (
            <div key={p.id} className="card" style={vencida ? { borderColor: 'var(--orange)' } : undefined}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 16 }}>{p.cliente_nombre || 'Cliente'}</b>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{p.tipo === 'vianda' ? '🍱 Vianda' : '🛵 Delivery'} · pedido #{p.pedido_id}</span>
                <span className="spacer" style={{ flex: 1 }} />
                <b style={{ fontSize: 17 }}>{money(p.importe)}</b>
              </div>
              <div style={{ color: vencida ? 'var(--orange)' : 'var(--muted)', fontSize: 13, margin: '4px 0 10px' }}>
                {p.cliente_telefono ? '📱 ' + p.cliente_telefono + ' · ' : '⚠ sin teléfono · '}
                {dias <= 0 ? 'hoy' : dias === 1 ? 'hace 1 día' : `hace ${dias} días`}
                {p.recordado_en ? ' · 📲 ya recordado' : ''}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn-green" onClick={() => confirmarLlego(p)}>✅ Llegó</button>
                <button className="btn-blue" disabled={!p.cliente_telefono} onClick={() => recordar(p)}>📲 Recordar</button>
                <button onClick={() => { setFiadoId(fiadoId === p.id ? null : p.id); setOtroId(null); setCuentaSel(''); }}>📒 Pasar a fiado</button>
                <button onClick={() => { setOtroId(otroId === p.id ? null : p.id); setFiadoId(null); }}>Cobré de otra forma</button>
              </div>

              {fiadoId === p.id && (
                <div style={{ marginTop: 8, borderTop: '1px solid var(--panel2)', paddingTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>¿A qué cuenta?</span>
                  <select value={cuentaSel} onChange={(e) => setCuentaSel(e.target.value)}>
                    <option value="">— Elegí la cuenta —</option>
                    {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  <button className="btn-green" onClick={() => pasarAFiado(p)}>Confirmar fiado</button>
                </div>
              )}

              {otroId === p.id && (
                <div style={{ marginTop: 8, borderTop: '1px solid var(--panel2)', paddingTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 13 }}>Al final pagó en:</span>
                  <button className="btn-green" onClick={() => cambiarMedio(p, 'EFECTIVO')}>💵 Efectivo</button>
                  <button className="btn-blue" onClick={() => cambiarMedio(p, 'TARJETA DÉBITO')}>💳 Débito</button>
                  <button className="btn-blue" onClick={() => cambiarMedio(p, 'TARJETA CRÉDITO')}>💳 Crédito</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
