import { useEffect, useState } from 'react';
import { api, socket, money } from '../api';
import { toast, confirmar } from '../ui.jsx';

// Panel del cadete (delivery): lista de pedidos a repartir/cobrar, pensado para el celular.
const MEDIOS = [
  { k: 'EFECTIVO', label: '💵 Efectivo', cls: 'btn-green' },
  { k: 'TARJETA DÉBITO', label: '💳 Débito', cls: 'btn-blue' },
  { k: 'TARJETA CRÉDITO', label: '💳 Crédito', cls: 'btn-blue' },
  { k: 'QR / TRANSFERENCIA', label: '📱 QR/Transf.', cls: 'btn-blue' },
];

export default function Reparto() {
  const [activos, setActivos] = useState([]);
  const [cobrarId, setCobrarId] = useState(null); // pedido que está eligiendo forma de pago

  const cargar = () => api.deliveryPendientes().then(setActivos).catch(() => {});
  useEffect(() => {
    cargar();
    const reload = () => cargar();
    ['pedido:nuevo', 'pedido:actualizado', 'pedido:cobrado', 'connect'].forEach((e) => socket.on(e, reload));
    return () => ['pedido:nuevo', 'pedido:actualizado', 'pedido:cobrado', 'connect'].forEach((e) => socket.off(e, reload));
  }, []);

  const entregar = async (p) => {
    try { await api.entregar(p.id, true); cargar(); toast('📦 Entregado.'); }
    catch (e) { toast('No se pudo marcar entregado: ' + e.message, 'error'); }
  };

  const cobrar = async (p, medio) => {
    if (!(await confirmar(`¿Cobrar ${money(p.total)} de ${p.cliente_nombre || 'delivery'} en ${medio}?`, { ok: 'Cobrar' }))) return;
    try {
      await api.pagar(p.id, [{ medio, importe: p.total }], {});
      setCobrarId(null); cargar();
      toast('✅ Cobrado.');
    } catch (e) {
      toast(e.message.includes('409') ? 'Ese pedido ya estaba cobrado.' : 'No se pudo cobrar: ' + e.message, 'error');
      cargar();
    }
  };

  const entregarTodos = async () => {
    const faltan = activos.filter((p) => !p.entregado_en);
    if (!faltan.length) { toast('No hay pedidos sin entregar.'); return; }
    if (!(await confirmar(`¿Marcar como ENTREGADOS los ${faltan.length} pedido(s) que faltan?`, { ok: 'Marcar entregados' }))) return;
    try { const r = await api.deliveryEntregarTodos(); cargar(); toast(`📦 ${r.n} marcado(s) como entregado(s).`); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };

  const cobrarTodos = async () => {
    const cobrables = activos.filter((p) => p.estado !== 'cobrado' && p.entregado_en);
    if (!cobrables.length) { toast('No hay entregados sin cobrar. (Marcá "entregados" primero.)'); return; }
    const total = cobrables.reduce((a, p) => a + (p.total || 0), 0);
    if (!(await confirmar(`¿Cobrar en EFECTIVO los ${cobrables.length} entregado(s) sin cobrar?\n\nTotal: ${money(total)}\n\nOJO: los de tarjeta/transferencia cobralos aparte ANTES.`, { ok: 'Cobrar todos (efectivo)' }))) return;
    try { const r = await api.deliveryCobrarEntregados(); cargar(); toast(`✅ ${r.n} cobrado(s) en efectivo (${money(r.total)}).`); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="h1" style={{ margin: 0 }}>🛵 Reparto</h1>
        <span className="badge warn">{activos.length} activo(s)</span>
      </div>

      {activos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button onClick={entregarTodos}>📦 Marcar todos entregados</button>
          <button className="btn-green" onClick={cobrarTodos}>💵 Cobrar todos (efectivo)</button>
        </div>
      )}

      {!activos.length && <p style={{ color: 'var(--muted)' }}>No hay pedidos de delivery para repartir. 🎉</p>}

      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))' }}>
        {activos.map((p) => {
          const pagado = p.estado === 'cobrado';
          const entregado = !!p.entregado_en;
          const items = (p.items || []).filter((i) => i.estado !== 'anulado' && i.nombre !== 'Envío');
          const tel = (p.cliente_telefono || '').replace(/[^\d+]/g, '');
          return (
            <div key={p.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b style={{ fontSize: 18 }}>{p.cliente_nombre || 'Cliente'}</b>
                <b style={{ color: 'var(--accent)', fontSize: 18 }}>{money(p.total)}</b>
              </div>
              <div style={{ margin: '6px 0', fontSize: 15 }}>📍 {p.cliente_direccion || '—'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--muted)' }}>📞 {p.cliente_telefono || '—'}</span>
                {tel && (
                  <a href={'tel:' + tel} className="btn-green" style={{ padding: '4px 12px', textDecoration: 'none' }}>📞 Llamar</a>
                )}
                {p.hora_entrega && <span style={{ color: 'var(--muted)', marginLeft: 'auto' }}>⏰ {p.hora_entrega}</span>}
              </div>
              {items.length > 0 && (
                <div style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0', borderTop: '1px solid var(--panel2)', paddingTop: 6 }}>
                  {items.map((i) => <div key={i.id}>{i.cantidad}× {i.nombre}{i.observacion ? ` (${i.observacion})` : ''}</div>)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: pagado ? 'var(--green)' : 'var(--orange)' }}>{pagado ? '✅ Pagado' : '🕒 A cobrar'}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: entregado ? 'var(--green)' : 'var(--muted)' }}>{entregado ? '📦 Entregado' : '🛵 Sin entregar'}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!entregado && <button style={{ flex: 1, padding: 10 }} onClick={() => entregar(p)}>📦 Entregado</button>}
                {!pagado && cobrarId !== p.id && <button className="btn-green" style={{ flex: 1, padding: 10 }} onClick={() => setCobrarId(p.id)}>💵 Cobrar</button>}
              </div>
              {!pagado && cobrarId === p.id && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>¿Cómo paga?</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {MEDIOS.map((m) => <button key={m.k} className={m.cls} onClick={() => cobrar(p, m.k)}>{m.label}</button>)}
                    <button onClick={() => setCobrarId(null)}>✕</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
