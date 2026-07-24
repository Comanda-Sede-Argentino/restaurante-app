import { useEffect, useState } from 'react';
import { api, socket, money } from '../api';
import { toast, confirmar, preguntar } from '../ui.jsx';

// Medios de pago rápidos. El fiado se elige con la cuenta corriente.
const MEDIOS = [
  { k: 'EFECTIVO', label: '💵 Efectivo', cls: 'btn-green' },
  { k: 'TARJETA DÉBITO', label: '💳 Débito', cls: 'btn-blue' },
  { k: 'TARJETA CRÉDITO', label: '💳 Crédito', cls: 'btn-blue' },
  { k: 'QR / TRANSFERENCIA', label: '📱 QR/Transf.', cls: 'btn-blue' },
];

export default function Cafeteria() {
  const [productos, setProductos] = useState([]);
  const [mesas, setMesas] = useState([]);
  const [selId, setSelId] = useState(null);
  const [cobrando, setCobrando] = useState(false);
  const [modoFiado, setModoFiado] = useState(false);
  const [cuentas, setCuentas] = useState([]);
  const [cuentaId, setCuentaId] = useState('');
  const [totalTurno, setTotalTurno] = useState(0);

  // Productos de cafetería, con los FAVORITOS (⭐) primero para tocar más rápido
  const cargarProductos = () =>
    api.platos({}).then((ps) => setProductos(
      ps.filter((p) => p.cat_cafeteria && p.activo !== 0)
        .sort((a, b) => (b.favorito ? 1 : 0) - (a.favorito ? 1 : 0) || a.nombre.localeCompare(b.nombre))
    ));
  const cargarMesas = () => api.cafeteriaMesas()
    .then((r) => { setMesas(r.mesas || []); setTotalTurno(r.totalTurno || 0); }).catch(() => {});
  const cargarCuentas = () => api.cuentas().then(setCuentas).catch(() => {});

  useEffect(() => {
    cargarProductos();
    cargarMesas();
    cargarCuentas();
    const reload = () => cargarMesas();
    socket.on('pedido:actualizado', reload);
    socket.on('pedido:nuevo', reload);
    socket.on('pedido:cobrado', reload);
    socket.on('plato:disponibilidad', cargarProductos);
    socket.on('connect', reload);
    return () => {
      socket.off('pedido:actualizado', reload);
      socket.off('pedido:nuevo', reload);
      socket.off('pedido:cobrado', reload);
      socket.off('plato:disponibilidad', cargarProductos);
      socket.off('connect', reload);
    };
  }, []);

  const sel = mesas.find((m) => m.id === selId) || null;
  const items = (sel?.items || []).filter((i) => i.estado !== 'anulado');

  const abrirMesa = (id) => { setSelId(id); setCobrando(false); setModoFiado(false); setCuentaId(''); };

  const nuevaMesa = async () => {
    try {
      const p = await api.cafeteriaNueva();
      await cargarMesas();
      abrirMesa(p.id);
    } catch (e) { toast('No se pudo abrir la mesa: ' + e.message, 'error'); }
  };

  // Sumar (+1) o restar (−1) un producto de la mesa seleccionada
  const sumar = async (platoId, delta) => {
    if (!selId) { toast('Abrí o elegí una mesa primero.', 'error'); return; }
    try {
      const p = await api.cafeteriaItem(selId, platoId, delta);
      setMesas((ms) => ms.map((m) => (m.id === p.id ? p : m)));
    } catch (e) { toast('No se pudo cargar: ' + e.message, 'error'); }
  };

  // Nombre de la mesa (para identificar a los habitués): se guarda en el pedido
  const renombrar = (nombre) => setMesas((ms) => ms.map((m) => (m.id === selId ? { ...m, cliente_nombre: nombre } : m)));
  const guardarNombre = async () => {
    if (!sel) return;
    try { await api.actualizarPedido(sel.id, { cliente_nombre: sel.cliente_nombre || '' }); } catch { /* ignorar */ }
  };

  // Ticket opcional (solo cuando el cliente lo necesita)
  const imprimirTicket = async () => {
    if (!sel) return;
    try {
      const r = await api.imprimirCuenta(sel.id);
      const m = r.resultado?.modo;
      toast(m === 'impreso' ? '🖨 Ticket enviado a la impresora.' : '🖨 Ticket generado (sin impresora, guardado en archivo).');
    } catch (e) { toast('No se pudo imprimir: ' + e.message, 'error'); }
  };

  const cobrar = async (medio) => {
    if (!sel) return;
    if (!(await confirmar(`¿Cobrar ${money(sel.total)} en ${medio}?`, { ok: 'Cobrar' }))) return;
    try {
      await api.pagar(sel.id, [{ medio, importe: Math.round(sel.total) }], {});
      setSelId(null); setCobrando(false);
      await cargarMesas();
      toast('✅ Cobrado.');
    } catch (e) {
      toast(e.message.includes('409') ? 'Esa mesa ya fue cobrada.' : 'No se pudo cobrar: ' + e.message, 'error');
      cargarMesas();
    }
  };

  const nuevaCuenta = async () => {
    const nombre = await preguntar('Nombre de la empresa o persona para el fiado:');
    if (!nombre || !nombre.trim()) return;
    try {
      const c = await api.crearCuenta({ nombre: nombre.trim() });
      await cargarCuentas();
      setCuentaId(String(c.id));
      toast('Cuenta creada.');
    } catch (e) { toast('No se pudo crear: ' + e.message, 'error'); }
  };

  const cobrarFiado = async () => {
    if (!sel) return;
    if (!cuentaId) { toast('Elegí la cuenta (o creá una nueva).', 'error'); return; }
    const emp = cuentas.find((c) => String(c.id) === String(cuentaId));
    if (!(await confirmar(`¿Cargar ${money(sel.total)} al fiado de ${emp?.nombre || 'la cuenta'}?`, { ok: 'Cargar' }))) return;
    try {
      await api.pagar(sel.id, [{ medio: 'FIADO', importe: Math.round(sel.total) }], { cuenta_id: Number(cuentaId) });
      try { await api.imprimirCuenta(sel.id, { firma: true }); } catch { /* impresión best-effort */ }
      setSelId(null); setCobrando(false); setModoFiado(false); setCuentaId('');
      await cargarMesas();
      toast('✅ Cargado al fiado. Ticket impreso.');
    } catch (e) {
      toast(e.message.includes('409') ? 'Esa mesa ya fue cobrada.' : 'No se pudo cargar: ' + e.message, 'error');
      cargarMesas();
    }
  };

  const cerrarSinCobrar = async () => {
    if (!sel) return;
    if (!(await confirmar('¿Cerrar esta mesa sin cobrar? Se descarta lo cargado.', { peligro: true, ok: 'Cerrar sin cobrar', cancelar: 'Volver' }))) return;
    try {
      await api.anular(sel.id, 'Cafetería: cerrada sin cobrar');
      setSelId(null); setCobrando(false); setModoFiado(false);
      await cargarMesas();
    } catch (e) { toast('No se pudo cerrar: ' + e.message, 'error'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="h1" style={{ margin: 0 }}>☕ Cafetería</h1>
        <span className="badge" style={{ background: 'var(--green)', color: '#fff' }} title="Vendido en cafetería en el turno actual (desde el último cierre)">
          Turno: {money(totalTurno)}
        </span>
        <span className="spacer" />
        {mesas.map((m, i) => (
          <button key={m.id} className={'chip' + (m.id === selId ? ' active' : '')}
            onClick={() => abrirMesa(m.id)} style={{ fontWeight: 700 }}>
            {m.cliente_nombre || 'Mesa ' + (i + 1)} · {money(m.total)}
          </button>
        ))}
        <button className="btn-accent" onClick={nuevaMesa}>＋ Nueva mesa</button>
      </div>

      {productos.length === 0 && (
        <div className="card" style={{ borderColor: 'var(--orange)', marginBottom: 12 }}>
          No hay productos de cafetería. Marcá una categoría como <b>☕ Cafetería</b> en <b>Catálogo</b> y cargá ahí los productos (café, medialunas, criollos...).
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
        {/* Botones de productos */}
        <div>
          {!selId && <p style={{ color: 'var(--muted)' }}>Abrí una mesa con <b>＋ Nueva mesa</b> (o elegí una de arriba) y tocá los productos para cargarlos.</p>}
          <div className="cards">
            {productos.map((p) => (
              <div key={p.id} className={'plato-btn' + (p.disponible === 0 ? ' agotado' : '')}
                role="button" tabIndex={0}
                onClick={() => { if (p.disponible !== 0) sumar(p.id, 1); }}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && p.disponible !== 0) { e.preventDefault(); sumar(p.id, 1); } }}>
                <div className="pn">{p.nombre}</div>
                {p.disponible === 0 ? <div className="pp" style={{ color: '#e5484d', fontWeight: 700 }}>SIN STOCK</div> : <div className="pp">{money(p.precio)}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Mesa seleccionada */}
        <div className="card">
          {!sel && <p style={{ color: 'var(--muted)' }}>Ninguna mesa seleccionada.</p>}
          {sel && (
            <>
              <input value={sel.cliente_nombre || ''} onChange={(e) => renombrar(e.target.value)} onBlur={guardarNombre}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                placeholder="Nombre de la mesa (ej. Pedro) — opcional"
                style={{ width: '100%', marginBottom: 8, fontWeight: 700 }} />
              <div className="total-row" style={{ marginTop: 0 }}><span>Total</span><span>{money(sel.total)}</span></div>
              {!items.length && <p style={{ color: 'var(--muted)' }}>Sin consumos todavía. Tocá los productos de la izquierda.</p>}
              {items.map((i) => (
                <div key={i.id} className="cart-item">
                  <span style={{ flex: 1 }}>{i.nombre}</span>
                  <div className="qty">
                    <button onClick={() => sumar(i.plato_id, -1)}>−</button>
                    <b>{i.cantidad}</b>
                    <button onClick={() => sumar(i.plato_id, 1)}>+</button>
                  </div>
                  <span style={{ minWidth: 70, textAlign: 'right' }}>{money(i.cantidad * i.precio_unit)}</span>
                </div>
              ))}

              {!cobrando ? (
                <>
                  <button className="btn-green" style={{ width: '100%', padding: 13, marginTop: 8 }}
                    disabled={!items.length} onClick={() => { setCobrando(true); setModoFiado(false); }}>💵 Cobrar {money(sel.total)}</button>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button style={{ flex: 1 }} disabled={!items.length} onClick={imprimirTicket} title="Imprimir ticket (solo si el cliente lo necesita)">🖨 Ticket</button>
                    <button className="btn-red" style={{ flex: 1 }} onClick={cerrarSinCobrar}>✖ Cerrar</button>
                  </div>
                </>
              ) : !modoFiado ? (
                <>
                  <div style={{ margin: '10px 0 6px', fontWeight: 700 }}>¿Cómo paga?</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {MEDIOS.map((m) => (
                      <button key={m.k} className={m.cls} onClick={() => cobrar(m.k)}>{m.label}</button>
                    ))}
                    <button className="btn-blue" onClick={() => { setModoFiado(true); setCuentaId(''); }}>📒 Fiado</button>
                  </div>
                  <button style={{ marginTop: 10 }} onClick={() => setCobrando(false)}>← Volver</button>
                </>
              ) : (
                <>
                  <div style={{ margin: '10px 0 6px', fontWeight: 700 }}>📒 Fiado — ¿a qué cuenta?</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                    <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
                      <option value="">— elegir cuenta —</option>
                      {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} (debe {money(c.saldo)})</option>)}
                    </select>
                    <button onClick={nuevaCuenta}>+ Nueva</button>
                  </div>
                  <button className="btn-green" style={{ width: '100%', padding: 12 }} onClick={cobrarFiado}>📒 Cargar al fiado (con ticket)</button>
                  <button style={{ marginTop: 8 }} onClick={() => setModoFiado(false)}>← Volver a formas de pago</button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
