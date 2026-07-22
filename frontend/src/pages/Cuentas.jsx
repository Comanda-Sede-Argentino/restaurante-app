import { useEffect, useState } from 'react';
import { api, money } from '../api';
import { toast, confirmar, preguntar } from '../ui.jsx';

const MEDIOS_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'CHEQUE'];

export default function Cuentas() {
  const [cuentas, setCuentas] = useState([]);
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState('');
  const [pagoImp, setPagoImp] = useState('');
  const [pagoMedio, setPagoMedio] = useState('TRANSFERENCIA');

  const cargar = () => api.cuentas().then(setCuentas);
  const abrir = async (id) => setSel(await api.cuenta(id));
  useEffect(() => { cargar(); }, []);

  const nueva = async () => {
    const nombre = await preguntar('Nombre de la empresa o persona:');
    if (!nombre || !nombre.trim()) return;
    const tel = (await preguntar('Teléfono (opcional):')) || '';
    await api.crearCuenta({ nombre: nombre.trim(), telefono: tel.trim() });
    cargar(); toast('Cuenta creada.');
  };

  const numAR = (s) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
  const registrarPago = async () => {
    const importe = numAR(pagoImp);
    if (!(importe > 0)) { toast('Ingresá un importe válido.', 'error'); return; }
    if (!(await confirmar(`¿Registrar pago de ${money(importe)} de ${sel.nombre}?`, { ok: 'Registrar' }))) return;
    await api.pagoCuenta(sel.id, { importe, medio: pagoMedio });
    setPagoImp('');
    toast('✅ Pago registrado.');
    abrir(sel.id); cargar();
  };

  const imprimirEstado = async () => {
    try {
      const r = await api.imprimirEstadoCuenta(sel.id);
      const m = r.resultado?.modo;
      toast(m === 'impreso' ? '🖨 Estado de cuenta enviado a la impresora.'
        : m === 'archivo' ? '🖨 Estado de cuenta generado (sin impresora, guardado en archivo).'
        : 'No se pudo imprimir el estado de cuenta.', m === 'impreso' ? 'ok' : 'info');
    } catch (e) { toast('No se pudo imprimir: ' + e.message, 'error'); }
  };

  const totalDeuda = cuentas.reduce((a, c) => a + (c.saldo > 0 ? c.saldo : 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h1 className="h1" style={{ margin: 0 }}>Cuentas corrientes (fiado)</h1>
        <span className="spacer" />
        <button className="btn-accent" onClick={nueva}>+ Nueva cuenta</button>
      </div>
      {msg && <div className="card" style={{ marginBottom: 12, borderColor: 'var(--accent)' }}>{msg}</div>}

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        <div>
          <div className="card" style={{ marginBottom: 10 }}>
            <b>Deuda total a cobrar: <span style={{ color: 'var(--orange)' }}>{money(totalDeuda)}</span></b>
          </div>
          {!cuentas.length && <p style={{ color: 'var(--muted)' }}>No hay cuentas. Creá una con "+ Nueva cuenta".</p>}
          {cuentas.map((c) => (
            <div key={c.id} className="card" style={{ marginBottom: 8, cursor: 'pointer', borderColor: sel?.id === c.id ? 'var(--accent)' : '' }} onClick={() => abrir(c.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <b>{c.nombre}</b>
                <b style={{ color: c.saldo > 0 ? 'var(--orange)' : 'var(--green)' }}>{money(c.saldo)}</b>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>{c.tipo}{c.telefono ? ' · ' + c.telefono : ''}</div>
            </div>
          ))}
        </div>

        <div className="card">
          {!sel && <p style={{ color: 'var(--muted)' }}>Elegí una cuenta para ver el detalle y registrar pagos.</p>}
          {sel && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 className="h2" style={{ marginTop: 0, marginBottom: 0 }}>{sel.nombre}</h2>
                <span className="spacer" />
                <button onClick={imprimirEstado}>🖨 Imprimir estado de cuenta</button>
              </div>
              <div className="total-row"><span>Saldo (debe)</span><span style={{ color: sel.saldo > 0 ? 'var(--orange)' : 'var(--green)' }}>{money(sel.saldo)}</span></div>

              <h2 className="h2" style={{ marginTop: 14 }}>Registrar pago de la empresa</h2>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <input placeholder="Importe $" value={pagoImp} onChange={(e) => setPagoImp(e.target.value)} style={{ flex: 1 }} />
                <select value={pagoMedio} onChange={(e) => setPagoMedio(e.target.value)}>
                  {MEDIOS_PAGO.map((m) => <option key={m}>{m}</option>)}
                </select>
                <button className="btn-green" onClick={registrarPago}>Registrar</button>
              </div>

              <h2 className="h2" style={{ marginTop: 14 }}>Movimientos</h2>
              {!sel.movimientos?.length && <p style={{ color: 'var(--muted)' }}>Sin movimientos.</p>}
              {sel.movimientos?.map((m) => (
                <div key={m.id} className="cart-item">
                  <span style={{ flex: 1 }}>
                    {m.tipo === 'cargo' ? '🍽 Consumo' : '💵 Pago'}
                    {m.pedido_id ? ` (pedido #${m.pedido_id})` : ''}
                    {m.detalle ? ' · ' + m.detalle : ''}
                    {m.medio ? ' · ' + m.medio : ''}
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}> · {m.fecha}</span>
                  </span>
                  <b style={{ color: m.tipo === 'cargo' ? 'var(--orange)' : 'var(--green)' }}>
                    {m.tipo === 'cargo' ? '+' : '−'}{money(m.importe)}
                  </b>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
