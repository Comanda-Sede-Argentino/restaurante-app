import { useEffect, useState, useRef } from 'react';
import { api, socket, money } from '../api';
import { toast, confirmar, preguntar } from '../ui.jsx';

// Módulo de VIANDAS del mediodía: cargar los 2 menús del día, tomar pedidos rápido
// (el "cuaderno digital") y repartir/cobrar como en el módulo de Reparto.
const MEDIOS = [
  { k: 'EFECTIVO', label: '💵 Efectivo', cls: 'btn-green' },
  { k: 'QR / TRANSFERENCIA', label: '📱 Transf.', cls: 'btn-blue' },
  { k: 'TARJETA DÉBITO', label: '💳 Débito', cls: 'btn-blue' },
];

export default function Viandas() {
  const [tab, setTab] = useState('pedido'); // pedido | menus | dia
  const [fecha, setFecha] = useState('');
  const [menus, setMenus] = useState([]);       // menús del día (guardados)
  const [pedidos, setPedidos] = useState([]);
  const [porMenu, setPorMenu] = useState([]);
  const [totalDia, setTotalDia] = useState(0);

  const cargarMenus = () => api.menuDia().then((r) => { setFecha(r.fecha); setMenus(r.menus || []); }).catch(() => {});
  const cargarDia = () => api.viandas().then((r) => {
    setPedidos(r.pedidos || []); setPorMenu(r.porMenu || []); setTotalDia(r.totalDia || 0);
    if (r.menus) setMenus(r.menus);
  }).catch(() => {});

  useEffect(() => {
    cargarMenus();
    cargarDia();
    const reload = () => cargarDia();
    ['pedido:nuevo', 'pedido:actualizado', 'pedido:cobrado', 'connect'].forEach((e) => socket.on(e, reload));
    return () => ['pedido:nuevo', 'pedido:actualizado', 'pedido:cobrado', 'connect'].forEach((e) => socket.off(e, reload));
  }, []);

  const sinCobrar = pedidos.filter((p) => p.estado !== 'cobrado').length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="h1" style={{ margin: 0 }}>🍱 Viandas</h1>
        <span className="badge" style={{ background: 'var(--green)', color: '#fff' }} title="Cobrado en viandas hoy">Hoy: {money(totalDia)}</span>
        {sinCobrar > 0 && <span className="badge warn">{sinCobrar} sin cobrar</span>}
        <span className="spacer" />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={'chip' + (tab === 'pedido' ? ' active' : '')} onClick={() => setTab('pedido')}>➕ Nuevo pedido</button>
          <button className={'chip' + (tab === 'dia' ? ' active' : '')} onClick={() => setTab('dia')}>🛵 Pedidos del día</button>
          <button className={'chip' + (tab === 'menus' ? ' active' : '')} onClick={() => setTab('menus')}>📋 Menús</button>
        </div>
      </div>

      {tab === 'menus' && <Menus fecha={fecha} menus={menus} onSaved={() => { cargarMenus(); cargarDia(); }} />}
      {tab === 'pedido' && <NuevoPedido menus={menus} onCreado={() => { cargarDia(); setTab('dia'); }} irAMenus={() => setTab('menus')} />}
      {tab === 'dia' && <DelDia pedidos={pedidos} porMenu={porMenu} totalDia={totalDia} recargar={cargarDia} />}
    </div>
  );
}

// ---------- Pestaña MENÚS del día ----------
function Menus({ fecha, menus, onSaved }) {
  const [rows, setRows] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    // Arranca con lo guardado o 2 filas vacías (los 2 menús habituales)
    const base = menus.length ? menus.map((m) => ({ nombre: m.nombre, descripcion: m.descripcion || '', precio: m.precio })) : [];
    while (base.length < 2) base.push({ nombre: '', descripcion: '', precio: '' });
    setRows(base);
    api.menuDiaHistorial().then(setHistorial).catch(() => {});
  }, [menus]);

  const setRow = (i, campo, val) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, [campo]: val } : r)));
  const agregar = () => setRows((rs) => [...rs, { nombre: '', descripcion: '', precio: '' }]);
  const quitar = (i) => setRows((rs) => rs.filter((_, k) => k !== i));

  const guardar = async () => {
    const limpios = rows.filter((r) => r.nombre.trim()).map((r, i) => ({ opcion: i + 1, nombre: r.nombre.trim(), descripcion: r.descripcion.trim(), precio: Number(r.precio) || 0 }));
    if (!limpios.length) { toast('Cargá al menos un menú.', 'error'); return; }
    try { await api.guardarMenuDia(fecha, limpios); toast('✅ Menús del día guardados.'); onSaved(); }
    catch (e) { toast('No se pudo guardar: ' + e.message, 'error'); }
  };

  const generarMensaje = async () => {
    try { const r = await api.viandasMensaje(); setMsg(r.texto || ''); }
    catch (e) { toast('No se pudo generar: ' + e.message, 'error'); }
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(msg); toast('📋 Copiado. Pegalo en tu lista de difusión de WhatsApp.'); }
    catch { toast('Copialo a mano (Ctrl+C).'); }
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>📋 Menús de hoy <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({fecha})</span></div>
        {rows.map((r, i) => (
          <div key={i} style={{ borderTop: i ? '1px solid var(--panel2)' : 'none', paddingTop: i ? 10 : 0, marginTop: i ? 10 : 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <b style={{ minWidth: 20 }}>{i + 1})</b>
              <input list="hist-menus" value={r.nombre} onChange={(e) => setRow(i, 'nombre', e.target.value)}
                placeholder="Nombre del menú (ej. Milanesa con puré)" style={{ flex: 1 }} />
              <input type="number" value={r.precio} onChange={(e) => setRow(i, 'precio', e.target.value)}
                placeholder="Precio" style={{ width: 100 }} />
              {rows.length > 2 && <button className="btn-red" onClick={() => quitar(i)} title="Quitar">✕</button>}
            </div>
            <input value={r.descripcion} onChange={(e) => setRow(i, 'descripcion', e.target.value)}
              placeholder="Descripción (opcional)" style={{ width: '100%', marginTop: 6, fontSize: 13 }} />
          </div>
        ))}
        <datalist id="hist-menus">
          {historial.map((h, k) => <option key={k} value={h.nombre} />)}
        </datalist>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={agregar}>＋ Otro menú</button>
          <button className="btn-green" style={{ flex: 1 }} onClick={guardar}>💾 Guardar menús del día</button>
        </div>
        {historial.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
            💡 Empezá a escribir el nombre y te sugiere los menús que ya usaste (con su último precio).
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>📣 Mensaje de difusión</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>Generá el texto con los 2 menús y pegalo en tu lista de difusión de WhatsApp.</p>
        <button className="btn-blue" style={{ width: '100%' }} onClick={generarMensaje}>✍ Generar mensaje</button>
        {msg && (
          <>
            <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={10} style={{ width: '100%', marginTop: 10, fontSize: 13 }} />
            <button className="btn-green" style={{ width: '100%', marginTop: 6 }} onClick={copiar}>📋 Copiar</button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Pestaña NUEVO PEDIDO (carga rápida) ----------
function NuevoPedido({ menus, onCreado }) {
  const [cart, setCart] = useState([]);       // {key,tipo,menu_dia_id?,plato_id?,nombre,precio,cantidad}
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [entrega, setEntrega] = useState('domicilio');
  const [hora, setHora] = useState('');
  const [sug, setSug] = useState([]);
  const [verCarta, setVerCarta] = useState(false);
  const [platos, setPlatos] = useState([]);
  const [buscar, setBuscar] = useState('');
  const timer = useRef(null);

  const addMenu = (m) => setCart((c) => {
    const ex = c.find((x) => x.menu_dia_id === m.id);
    if (ex) return c.map((x) => (x.menu_dia_id === m.id ? { ...x, cantidad: x.cantidad + 1 } : x));
    return [...c, { key: 'm' + m.id, tipo: 'menu', menu_dia_id: m.id, nombre: m.nombre, precio: m.precio, cantidad: 1 }];
  });
  const addPlato = (p) => setCart((c) => {
    const ex = c.find((x) => x.plato_id === p.id);
    if (ex) return c.map((x) => (x.plato_id === p.id ? { ...x, cantidad: x.cantidad + 1 } : x));
    return [...c, { key: 'p' + p.id, tipo: 'plato', plato_id: p.id, nombre: p.nombre, precio: p.precio, cantidad: 1 }];
  });
  const cambiarCant = (key, delta) => setCart((c) => c
    .map((x) => (x.key === key ? { ...x, cantidad: x.cantidad + delta } : x))
    .filter((x) => x.cantidad > 0));

  const total = cart.reduce((a, x) => a + x.precio * x.cantidad, 0);

  const onNombre = (v) => { setNombre(v); buscarCli(v); };
  const onTel = (v) => { setTelefono(v); buscarCli(v); };
  const buscarCli = (q) => {
    clearTimeout(timer.current);
    if (!q || q.trim().length < 2) { setSug([]); return; }
    timer.current = setTimeout(() => api.buscarClientes(q).then(setSug).catch(() => setSug([])), 250);
  };
  const elegirCliente = (c) => { setNombre(c.nombre || ''); setTelefono(c.telefono || ''); setDireccion(c.direccion || ''); setSug([]); };

  const abrirCarta = () => {
    setVerCarta((v) => !v);
    if (!platos.length) api.platos({}).then((ps) => setPlatos(ps.filter((p) => p.activo !== 0))).catch(() => {});
  };
  const platosFiltrados = buscar.trim()
    ? platos.filter((p) => p.nombre.toLowerCase().includes(buscar.toLowerCase())).slice(0, 24)
    : [];

  const guardar = async () => {
    if (!cart.length) { toast('Agregá al menos un menú o ítem.', 'error'); return; }
    if (entrega === 'domicilio' && !direccion.trim() && !telefono.trim()) {
      if (!(await confirmar('El pedido es a domicilio pero no cargaste dirección ni teléfono. ¿Guardar igual?', { ok: 'Guardar' }))) return;
    }
    const items = cart.map((x) => x.tipo === 'menu'
      ? { menu_dia_id: x.menu_dia_id, nombre: x.nombre, precio_unit: x.precio, cantidad: x.cantidad }
      : { plato_id: x.plato_id, cantidad: x.cantidad, precio_unit: x.precio });
    try {
      await api.crearVianda({
        cliente_nombre: nombre.trim() || null, cliente_telefono: telefono.trim() || null,
        cliente_direccion: direccion.trim() || null, entrega, hora_entrega: hora.trim() || null, items,
      });
      toast('✅ Pedido de vianda cargado.');
      setCart([]); setNombre(''); setTelefono(''); setDireccion(''); setHora(''); setEntrega('domicilio'); setSug([]);
      onCreado();
    } catch (e) { toast('No se pudo cargar: ' + e.message, 'error'); }
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 360px', gap: 16, alignItems: 'start' }}>
      <div>
        {!menus.length && (
          <div className="card" style={{ borderColor: 'var(--orange)', marginBottom: 12 }}>
            Todavía no cargaste los menús de hoy. Andá a <b>📋 Menús</b> y cargá las 2 opciones del día.
          </div>
        )}
        <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))' }}>
          {menus.map((m, i) => (
            <div key={m.id} className="plato-btn" role="button" tabIndex={0}
              onClick={() => addMenu(m)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addMenu(m); } }}
              style={{ borderColor: 'var(--accent)' }}>
              <div className="pn"><b>Menú {i + 1}</b> · {m.nombre}</div>
              <div className="pp">{money(m.precio)}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <button onClick={abrirCarta}>{verCarta ? '▲ Ocultar carta' : '➕ Agregar de la carta'}</button>
          {verCarta && (
            <div className="card" style={{ marginTop: 8 }}>
              <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar plato de la carta..." style={{ width: '100%', marginBottom: 8 }} />
              <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))' }}>
                {platosFiltrados.map((p) => (
                  <div key={p.id} className="plato-btn" role="button" tabIndex={0} onClick={() => addPlato(p)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addPlato(p); } }}>
                    <div className="pn">{p.nombre}</div>
                    <div className="pp">{money(p.precio)}</div>
                  </div>
                ))}
                {buscar.trim() && !platosFiltrados.length && <p style={{ color: 'var(--muted)' }}>Sin resultados.</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Panel del pedido */}
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Pedido</div>
        {!cart.length && <p style={{ color: 'var(--muted)' }}>Tocá un menú (o algo de la carta) para armar el pedido.</p>}
        {cart.map((x) => (
          <div key={x.key} className="cart-item">
            <span style={{ flex: 1 }}>{x.nombre}</span>
            <div className="qty">
              <button onClick={() => cambiarCant(x.key, -1)}>−</button>
              <b>{x.cantidad}</b>
              <button onClick={() => cambiarCant(x.key, 1)}>+</button>
            </div>
            <span style={{ minWidth: 70, textAlign: 'right' }}>{money(x.cantidad * x.precio)}</span>
          </div>
        ))}
        {cart.length > 0 && <div className="total-row"><span>Total</span><span>{money(total)}</span></div>}

        <div style={{ marginTop: 12, position: 'relative' }}>
          <input value={nombre} onChange={(e) => onNombre(e.target.value)} placeholder="Nombre del cliente" style={{ width: '100%', marginBottom: 6 }} />
          <input value={telefono} onChange={(e) => onTel(e.target.value)} placeholder="Teléfono" style={{ width: '100%', marginBottom: 6 }} />
          {sug.length > 0 && (
            <div className="card" style={{ position: 'absolute', zIndex: 5, width: '100%', padding: 6 }}>
              {sug.map((c, k) => (
                <div key={k} className="cart-item" role="button" tabIndex={0} style={{ cursor: 'pointer' }}
                  onClick={() => elegirCliente(c)}
                  onKeyDown={(e) => { if (e.key === 'Enter') elegirCliente(c); }}>
                  <span style={{ flex: 1 }}>{c.nombre || '—'} · {c.telefono}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{c.direccion || ''}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button className={entrega === 'domicilio' ? 'btn-accent' : ''} style={{ flex: 1 }} onClick={() => setEntrega('domicilio')}>🛵 A domicilio</button>
            <button className={entrega === 'retiro' ? 'btn-accent' : ''} style={{ flex: 1 }} onClick={() => setEntrega('retiro')}>🏪 Retira</button>
          </div>
          {entrega === 'domicilio' && (
            <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección" style={{ width: '100%', marginBottom: 6 }} />
          )}
          <input value={hora} onChange={(e) => setHora(e.target.value)} placeholder="Hora de entrega (opcional)" style={{ width: '100%', marginBottom: 8 }} />
        </div>

        <button className="btn-green" style={{ width: '100%', padding: 13 }} disabled={!cart.length} onClick={guardar}>💾 Cargar pedido</button>
      </div>
    </div>
  );
}

// ---------- Pestaña PEDIDOS DEL DÍA (reparto + cobro) ----------
function DelDia({ pedidos, porMenu, totalDia, recargar }) {
  const [cobrarId, setCobrarId] = useState(null);
  const [fiadoId, setFiadoId] = useState(null);
  const [cuentas, setCuentas] = useState([]);
  const [cuentaId, setCuentaId] = useState('');

  useEffect(() => { api.cuentas().then(setCuentas).catch(() => {}); }, []);
  const recargarCuentas = () => api.cuentas().then(setCuentas).catch(() => {});

  const entregar = async (p) => {
    try { await api.entregar(p.id, true); recargar(); toast('📦 Entregado.'); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };
  const cobrar = async (p, medio) => {
    if (!(await confirmar(`¿Cobrar ${money(p.total)} de ${p.cliente_nombre || 'la vianda'} en ${medio}?`, { ok: 'Cobrar' }))) return;
    try {
      await api.pagar(p.id, [{ medio, importe: Math.round(p.total) }], {});
      setCobrarId(null); recargar(); toast('✅ Cobrado.');
    } catch (e) {
      toast(e.message.includes('409') ? 'Ese pedido ya estaba cobrado.' : 'No se pudo cobrar: ' + e.message, 'error');
      recargar();
    }
  };
  const nuevaCuenta = async () => {
    const nombre = await preguntar('Nombre de la empresa o persona para el fiado:');
    if (!nombre || !nombre.trim()) return;
    try { const c = await api.crearCuenta({ nombre: nombre.trim() }); await recargarCuentas(); setCuentaId(String(c.id)); toast('Cuenta creada.'); }
    catch (e) { toast('No se pudo crear: ' + e.message, 'error'); }
  };
  const cobrarFiado = async (p) => {
    if (!cuentaId) { toast('Elegí la empresa (o creá una nueva).', 'error'); return; }
    const emp = cuentas.find((c) => String(c.id) === String(cuentaId));
    if (!(await confirmar(`¿Cargar ${money(p.total)} al fiado de ${emp?.nombre || 'la empresa'}?`, { ok: 'Cargar' }))) return;
    try {
      await api.pagar(p.id, [{ medio: 'FIADO', importe: Math.round(p.total) }], { cuenta_id: Number(cuentaId) });
      try { await api.imprimirCuenta(p.id, { firma: true }); } catch { /* best-effort */ }
      setFiadoId(null); setCuentaId(''); recargar(); recargarCuentas(); toast('✅ Cargado al fiado.');
    } catch (e) {
      toast(e.message.includes('409') ? 'Ese pedido ya estaba cobrado.' : 'No se pudo cargar: ' + e.message, 'error');
      recargar();
    }
  };
  const imprimir = async (p) => {
    try { await api.imprimirCuenta(p.id); toast('🖨 Ticket enviado.'); }
    catch (e) { toast('No se pudo imprimir: ' + e.message, 'error'); }
  };
  // Resumen acumulado para la cocina (12x Menú 1, 6x Menú 2...). Se puede imprimir varias veces.
  const pasarCocina = async () => {
    try {
      const r = await api.viandasCocinaImprimir();
      const m = r.resultado?.modo;
      toast(m === 'impreso'
        ? `🍳 Resumen enviado a cocina · ${r.totalViandas} vianda(s)`
        : `🍳 Resumen generado (${r.totalViandas} vianda(s)).`);
    } catch (e) { toast('No se pudo imprimir el resumen: ' + e.message, 'error'); }
  };

  return (
    <div>
      {porMenu.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>Resumen del día {money(totalDia)}</span>
            <button className="btn-accent" style={{ marginLeft: 'auto' }} onClick={pasarCocina}
              title="Imprime el acumulado para la cocina (cuántas de cada menú van hasta ahora)">🍳 Pasar a cocina</button>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {porMenu.map((m, i) => (
              <div key={m.id}><b>Menú {i + 1}</b> ({m.nombre}): <b>{m.cantidad}</b> · {money(m.importe)}</div>
            ))}
          </div>
        </div>
      )}

      {!pedidos.length && <p style={{ color: 'var(--muted)' }}>No hay pedidos de viandas cargados hoy.</p>}

      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))' }}>
        {pedidos.map((p) => {
          const pagado = p.estado === 'cobrado';
          const entregado = !!p.entregado_en;
          const dom = p.entrega !== 'retiro';
          const items = (p.items || []).filter((i) => i.estado !== 'anulado');
          const tel = (p.cliente_telefono || '').replace(/[^\d+]/g, '');
          return (
            <div key={p.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b style={{ fontSize: 17 }}>{p.cliente_nombre || 'Cliente'}</b>
                <b style={{ color: 'var(--accent)', fontSize: 17 }}>{money(p.total)}</b>
              </div>
              <div style={{ margin: '4px 0', fontSize: 13 }}>
                {dom ? <>🛵 {p.cliente_direccion || 'sin dirección'}</> : <>🏪 Retira</>}
                {p.hora_entrega && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>⏰ {p.hora_entrega}</span>}
              </div>
              {items.length > 0 && (
                <div style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0', borderTop: '1px solid var(--panel2)', paddingTop: 6 }}>
                  {items.map((i) => <div key={i.id}>{i.cantidad}× {i.nombre}</div>)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: pagado ? 'var(--green)' : 'var(--orange)' }}>{pagado ? '✅ Pagado' : '🕒 A cobrar'}</span>
                {dom && <span style={{ fontSize: 12, fontWeight: 700, color: entregado ? 'var(--green)' : 'var(--muted)' }}>{entregado ? '📦 Entregado' : '🛵 Sin entregar'}</span>}
                {tel && <a href={'tel:' + tel} className="btn-green" style={{ padding: '3px 10px', textDecoration: 'none', marginLeft: 'auto' }}>📞</a>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {dom && !entregado && <button style={{ flex: 1, padding: 9 }} onClick={() => entregar(p)}>📦 Entregado</button>}
                {!pagado && cobrarId !== p.id && fiadoId !== p.id && <button className="btn-green" style={{ flex: 1, padding: 9 }} onClick={() => { setCobrarId(p.id); setFiadoId(null); }}>💵 Cobrar</button>}
                <button style={{ padding: 9 }} onClick={() => imprimir(p)} title="Imprimir ticket">🖨</button>
              </div>
              {!pagado && cobrarId === p.id && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>¿Cómo paga?</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {MEDIOS.map((m) => <button key={m.k} className={m.cls} onClick={() => cobrar(p, m.k)}>{m.label}</button>)}
                    <button className="btn-blue" onClick={() => { setFiadoId(p.id); setCobrarId(null); setCuentaId(''); }}>📒 Fiado</button>
                    <button onClick={() => setCobrarId(null)}>✕</button>
                  </div>
                </div>
              )}
              {!pagado && fiadoId === p.id && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>📒 Fiado — ¿a qué empresa?</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                    <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} style={{ flex: 1, minWidth: 150 }}>
                      <option value="">— elegir empresa —</option>
                      {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} (debe {money(c.saldo)})</option>)}
                    </select>
                    <button onClick={nuevaCuenta}>+ Nueva</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-green" style={{ flex: 1 }} onClick={() => cobrarFiado(p)}>Cargar al fiado</button>
                    <button onClick={() => { setFiadoId(null); setCobrarId(p.id); }}>←</button>
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
