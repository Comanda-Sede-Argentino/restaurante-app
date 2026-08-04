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
  const [inbox, setInbox] = useState([]);
  const [editPedido, setEditPedido] = useState(null);

  const cargarMenus = () => api.menuDia().then((r) => { setFecha(r.fecha); setMenus(r.menus || []); }).catch(() => {});
  const cargarDia = () => api.viandas().then((r) => {
    setPedidos(r.pedidos || []); setPorMenu(r.porMenu || []); setTotalDia(r.totalDia || 0);
    if (r.menus) setMenus(r.menus);
  }).catch(() => {});
  const cargarInbox = () => api.viandasInbox().then(setInbox).catch(() => {});

  useEffect(() => {
    cargarMenus();
    // Generar los pedidos de los clientes fijos de hoy (si hay menús) y después cargar el día
    api.viandasGenerarFijos().then(cargarDia).catch(cargarDia);
    cargarInbox();
    const reload = () => cargarDia();
    ['pedido:nuevo', 'pedido:actualizado', 'pedido:cobrado', 'connect'].forEach((e) => socket.on(e, reload));
    socket.on('vianda:inbox', cargarInbox);
    return () => {
      ['pedido:nuevo', 'pedido:actualizado', 'pedido:cobrado', 'connect'].forEach((e) => socket.off(e, reload));
      socket.off('vianda:inbox', cargarInbox);
    };
  }, []);

  const sinCobrar = pedidos.filter((p) => p.estado !== 'cobrado').length;
  const cargado = pedidos.reduce((a, p) => a + (p.total || 0), 0);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="h1" style={{ margin: 0 }}>🍱 Viandas</h1>
        <span className="badge" title="Total cargado hoy (cobrado + sin cobrar)">Cargado: {money(cargado)} ({pedidos.length})</span>
        <span className="badge" style={{ background: 'var(--green)', color: '#fff' }} title="Cobrado en viandas hoy">Cobrado: {money(totalDia)}</span>
        {sinCobrar > 0 && <span className="badge warn">{sinCobrar} sin cobrar</span>}
        {inbox.length > 0 && <span className="badge" style={{ background: 'var(--blue)', color: '#fff' }}>📥 {inbox.length} de WhatsApp</span>}
        <span className="spacer" />
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={'chip' + (tab === 'pedido' ? ' active' : '')} onClick={() => setTab('pedido')}>➕ Nuevo pedido</button>
          <button className={'chip' + (tab === 'dia' ? ' active' : '')} onClick={() => setTab('dia')}>🛵 Pedidos del día</button>
          <button className={'chip' + (tab === 'fijos' ? ' active' : '')} onClick={() => setTab('fijos')}>📌 Fijos</button>
          <button className={'chip' + (tab === 'menus' ? ' active' : '')} onClick={() => setTab('menus')}>📋 Menús</button>
        </div>
      </div>

      {inbox.length > 0 && <InboxViandas inbox={inbox} recargar={() => { cargarInbox(); cargarDia(); }} />}

      {tab === 'menus' && <Menus fecha={fecha} menus={menus} onSaved={() => { cargarMenus(); cargarDia(); }} />}
      {tab === 'fijos' && <Fijos />}
      {tab === 'pedido' && (
        <NuevoPedido menus={menus} pedidos={pedidos} editPedido={editPedido}
          onDone={(fueEdicion) => { setEditPedido(null); cargarDia(); if (fueEdicion) setTab('dia'); }}
          irAMenus={() => setTab('menus')} />
      )}
      {tab === 'dia' && (
        <DelDia pedidos={pedidos} porMenu={porMenu} totalDia={totalDia} recargar={cargarDia}
          onEditar={(p) => { setEditPedido(p); setTab('pedido'); }} />
      )}
    </div>
  );
}

// ---------- Pestaña MENÚS del día ----------
function Menus({ fecha, menus, onSaved }) {
  const [rows, setRows] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [msg, setMsg] = useState('');
  const initFecha = useRef(null);

  // Inicializa el editor UNA vez por día (no en cada recarga, para no borrar lo que se está tipeando)
  useEffect(() => {
    if (!fecha || initFecha.current === fecha) return;
    initFecha.current = fecha;
    const base = menus.length ? menus.map((m) => ({ nombre: m.nombre, descripcion: m.descripcion || '', precio: m.precio })) : [];
    while (base.length < 2) base.push({ nombre: '', descripcion: '', precio: '' });
    setRows(base);
  }, [fecha, menus]);
  useEffect(() => { api.menuDiaHistorial().then(setHistorial).catch(() => {}); }, []);

  const setRow = (i, campo, val) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, [campo]: val } : r)));
  // Al escribir/elegir el nombre de un menú ya usado antes, autocompleta el precio si está vacío
  const setNombreMenu = (i, val) => setRows((rs) => rs.map((r, k) => {
    if (k !== i) return r;
    const nr = { ...r, nombre: val };
    if (!String(r.precio).trim()) {
      const h = historial.find((x) => (x.nombre || '').toLowerCase() === val.trim().toLowerCase());
      if (h) nr.precio = h.precio;
    }
    return nr;
  }));
  const agregar = () => setRows((rs) => [...rs, { nombre: '', descripcion: '', precio: '' }]);
  const quitar = (i) => setRows((rs) => rs.filter((_, k) => k !== i));

  const guardar = async () => {
    const limpios = rows.filter((r) => r.nombre.trim()).map((r, i) => ({ opcion: i + 1, nombre: r.nombre.trim(), descripcion: r.descripcion.trim(), precio: Number(r.precio) || 0 }));
    if (!limpios.length) { toast('Cargá al menos un menú.', 'error'); return; }
    try { await api.guardarMenuDia(fecha, limpios); toast('✅ Menús del día guardados.'); onSaved(); }
    catch (e) { toast('No se pudo guardar: ' + e.message, 'error'); }
  };

  const repetirUltimos = async () => {
    try {
      const r = await api.menuDiaUltimo();
      if (!r.menus || !r.menus.length) { toast('No hay menús anteriores para repetir.'); return; }
      setRows(r.menus.map((m) => ({ nombre: m.nombre, descripcion: m.descripcion || '', precio: m.precio })));
      toast(`Cargué los menús del ${r.fecha}. Revisá el precio y guardá.`);
    } catch (e) { toast('No se pudo: ' + e.message, 'error'); }
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
              <input list="hist-menus" value={r.nombre} onChange={(e) => setNombreMenu(i, e.target.value)}
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
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button onClick={repetirUltimos} title="Cargar los menús del último día (para ajustar y guardar)">🔁 Repetir últimos</button>
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

// ---------- Pestaña NUEVO PEDIDO (carga rápida + edición) ----------
function NuevoPedido({ menus, pedidos, editPedido, onDone, irAMenus }) {
  const editId = editPedido?.id || null;
  const [cart, setCart] = useState([]);       // {key,tipo,menu_dia_id?,plato_id?,nombre,precio,cantidad,obs,guarnicion,salsa,catGuarnicion,catSalsa}
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [entrega, setEntrega] = useState('domicilio');
  const [hora, setHora] = useState('');
  const [obsGeneral, setObsGeneral] = useState('');
  const [sug, setSug] = useState([]);
  const [verCarta, setVerCarta] = useState(false);
  const [platos, setPlatos] = useState([]);
  const [buscar, setBuscar] = useState('');
  const [guarniciones, setGuarniciones] = useState(['Papas fritas', 'Puré', 'Ensalada mixta', 'Rúcula con queso']);
  const [salsas, setSalsas] = useState(['Salsa roja', 'Salsa mixta', 'Bolognesa', 'Crema y queso']);
  const timer = useRef(null);
  const seq = useRef(0);

  // Cargar carta y las guarniciones/salsas configuradas (mismas que el módulo principal)
  useEffect(() => {
    api.platos({}).then((ps) => setPlatos(ps.filter((p) => p.activo !== 0))).catch(() => {});
    api.config().then((c) => {
      if (c?.cocina?.guarniciones?.length) setGuarniciones(c.cocina.guarniciones);
      if (c?.cocina?.salsas?.length) setSalsas(c.cocina.salsas);
    }).catch(() => {});
  }, []);

  const limpiar = () => {
    setCart([]); setNombre(''); setTelefono(''); setDireccion(''); setHora(''); setObsGeneral(''); setEntrega('domicilio'); setSug([]);
  };

  // Modo edición: precargar el pedido elegido
  useEffect(() => {
    if (!editPedido) return;
    setCart((editPedido.items || []).filter((i) => i.estado !== 'anulado').map((i) => ({
      key: 'e' + i.id + '_' + (seq.current++), tipo: i.menu_dia_id ? 'menu' : 'plato',
      menu_dia_id: i.menu_dia_id || undefined, plato_id: i.plato_id || undefined,
      nombre: i.nombre, precio: i.precio_unit, cantidad: i.cantidad,
      obs: i.observacion || '', guarnicion: '', salsa: '', catGuarnicion: 0, catSalsa: 0,
    })));
    setNombre(editPedido.cliente_nombre || ''); setTelefono(editPedido.cliente_telefono || '');
    setDireccion(editPedido.cliente_direccion || ''); setEntrega(editPedido.entrega === 'retiro' ? 'retiro' : 'domicilio');
    setHora(editPedido.hora_entrega || ''); setObsGeneral(editPedido.observacion || '');
  }, [editPedido]);

  const addMenu = (m) => setCart((c) => {
    const ex = c.find((x) => x.menu_dia_id === m.id && !x.obs);
    if (ex) return c.map((x) => (x === ex ? { ...x, cantidad: x.cantidad + 1 } : x));
    return [...c, { key: 'm' + m.id + '_' + (seq.current++), tipo: 'menu', menu_dia_id: m.id, nombre: m.nombre, precio: m.precio, cantidad: 1, obs: '', guarnicion: '', salsa: '' }];
  });
  const addPlato = (p) => setCart((c) => {
    const conOpciones = p.cat_guarnicion || p.cat_salsa;
    if (!conOpciones) {
      const ex = c.find((x) => x.plato_id === p.id && !x.obs);
      if (ex) return c.map((x) => (x === ex ? { ...x, cantidad: x.cantidad + 1 } : x));
    }
    return [...c, { key: 'p' + p.id + '_' + (seq.current++), tipo: 'plato', plato_id: p.id, nombre: p.nombre, precio: p.precio, cantidad: 1, obs: '', guarnicion: '', salsa: '', catGuarnicion: p.cat_guarnicion, catSalsa: p.cat_salsa }];
  });
  const cambiarCant = (key, delta) => setCart((c) => c
    .map((x) => (x.key === key ? { ...x, cantidad: x.cantidad + delta } : x))
    .filter((x) => x.cantidad > 0));
  const setItem = (key, campo, val) => setCart((c) => c.map((x) => (x.key === key ? { ...x, [campo]: val } : x)));

  const total = cart.reduce((a, x) => a + x.precio * x.cantidad, 0);

  // Arma la observación final del ítem: guarnición + salsa + nota libre
  const obsDeItem = (x) => [
    x.guarnicion ? (x.guarnicion === 'SIN' ? 'SIN guarnición' : 'con ' + x.guarnicion) : '',
    x.salsa ? 'con ' + x.salsa.toLowerCase() : '',
    (x.obs || '').trim(),
  ].filter(Boolean).join(' - ') || null;

  const onNombre = (v) => { setNombre(v); buscarCli(v); };
  const onTel = (v) => { setTelefono(v); buscarCli(v); };
  const buscarCli = (q) => {
    clearTimeout(timer.current);
    if (!q || q.trim().length < 2) { setSug([]); return; }
    timer.current = setTimeout(() => api.buscarClientes(q).then(setSug).catch(() => setSug([])), 250);
  };
  const elegirCliente = (c) => { setNombre(c.nombre || ''); setTelefono(c.telefono || ''); setDireccion(c.direccion || ''); setSug([]); };

  const abrirCarta = () => setVerCarta((v) => !v);
  const platosFiltrados = buscar.trim()
    ? platos.filter((p) => p.nombre.toLowerCase().includes(buscar.toLowerCase())).slice(0, 24)
    : [];

  const guardar = async () => {
    if (!cart.length) { toast('Agregá al menos un menú o ítem.', 'error'); return; }
    // Aviso anti-duplicado: si ese teléfono ya tiene un pedido hoy (evita cargar dos veces bot + manual)
    if (!editId && telefono.replace(/\D/g, '').length >= 6) {
      const tel = telefono.replace(/\D/g, '');
      const dup = (pedidos || []).find((p) => (p.cliente_telefono || '').replace(/\D/g, '') === tel);
      if (dup && !(await confirmar(
        `⚠ ${dup.cliente_nombre || 'Ese teléfono'} ya tiene un pedido cargado hoy (${money(dup.total)}). ¿Cargar OTRO igual?`,
        { ok: 'Sí, cargar otro', cancelar: 'Volver' }
      ))) return;
    }
    if (entrega === 'domicilio' && !direccion.trim() && !telefono.trim()) {
      if (!(await confirmar('El pedido es a domicilio pero no cargaste dirección ni teléfono. ¿Guardar igual?', { ok: 'Guardar' }))) return;
    }
    const items = cart.map((x) => x.tipo === 'menu'
      ? { menu_dia_id: x.menu_dia_id, nombre: x.nombre, precio_unit: x.precio, cantidad: x.cantidad, observacion: obsDeItem(x) }
      : { plato_id: x.plato_id, nombre: x.nombre, cantidad: x.cantidad, precio_unit: x.precio, observacion: obsDeItem(x) });
    const payload = {
      cliente_nombre: nombre.trim() || null, cliente_telefono: telefono.trim() || null,
      cliente_direccion: direccion.trim() || null, entrega, hora_entrega: hora.trim() || null,
      observacion: obsGeneral.trim() || null, items,
    };
    try {
      if (editId) { await api.editarVianda(editId, payload); toast('✅ Pedido actualizado.'); }
      else { await api.crearVianda(payload); toast('✅ Pedido cargado.'); }
      limpiar();
      onDone(!!editId);
    } catch (e) { toast('No se pudo guardar: ' + e.message, 'error'); }
  };
  const cancelar = () => { limpiar(); onDone(true); };

  return (
    <div>
      {editId && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--blue)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ color: 'var(--blue)' }}>✏ Editando el pedido de {editPedido.cliente_nombre || 'cliente'}</b>
          <span className="spacer" />
          <button onClick={cancelar}>✕ Cancelar edición</button>
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: '1fr 360px', gap: 16, alignItems: 'start' }}>
        <div>
          {!menus.length && (
            <div className="card" style={{ borderColor: 'var(--orange)', marginBottom: 12 }}>
              Todavía no cargaste los menús de hoy. Andá a <b>📋 Menús</b> {irAMenus && <button onClick={irAMenus}>Ir a Menús</button>}
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
                      <div className="pn">{p.nombre}{(p.cat_guarnicion || p.cat_salsa) ? ' 🍟' : ''}</div>
                      <div className="pp">{money(p.precio)}</div>
                    </div>
                  ))}
                  {buscar.trim() && !platosFiltrados.length && <p style={{ color: 'var(--muted)' }}>Sin resultados.</p>}
                </div>
              </div>
            )}
          </div>

          {/* Cuaderno en vivo: los pedidos que ya cargaste hoy */}
          <CuadernoHoy pedidos={pedidos} />
        </div>

        {/* Panel del pedido */}
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{editId ? 'Editando pedido' : 'Pedido'}</div>
          {!cart.length && <p style={{ color: 'var(--muted)' }}>Tocá un menú (o algo de la carta) para armar el pedido.</p>}
          {cart.map((x) => (
            <div key={x.key} style={{ borderBottom: '1px solid var(--panel2)', paddingBottom: 6, marginBottom: 6 }}>
              <div className="cart-item" style={{ borderBottom: 'none' }}>
                <span style={{ flex: 1 }}>{x.nombre}</span>
                <div className="qty">
                  <button onClick={() => cambiarCant(x.key, -1)}>−</button>
                  <b>{x.cantidad}</b>
                  <button onClick={() => cambiarCant(x.key, 1)}>+</button>
                </div>
                <span style={{ minWidth: 66, textAlign: 'right' }}>{money(x.cantidad * x.precio)}</span>
              </div>
              {x.catGuarnicion ? (
                <select value={x.guarnicion} onChange={(e) => setItem(x.key, 'guarnicion', e.target.value)} style={{ width: '100%', marginTop: 4, fontSize: 13 }}>
                  <option value="">— guarnición —</option>
                  {guarniciones.map((g) => <option key={g} value={g}>{g}</option>)}
                  <option value="SIN">SIN guarnición</option>
                </select>
              ) : null}
              {x.catSalsa ? (
                <select value={x.salsa} onChange={(e) => setItem(x.key, 'salsa', e.target.value)} style={{ width: '100%', marginTop: 4, fontSize: 13 }}>
                  <option value="">— salsa —</option>
                  {salsas.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : null}
              <input value={x.obs} onChange={(e) => setItem(x.key, 'obs', e.target.value)}
                placeholder="nota del ítem (ej. sin sal)" style={{ width: '100%', marginTop: 4, fontSize: 13 }} />
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
            <input value={hora} onChange={(e) => setHora(e.target.value)} placeholder="Hora de entrega (opcional)" style={{ width: '100%', marginBottom: 6 }} />
            <input value={obsGeneral} onChange={(e) => setObsGeneral(e.target.value)} placeholder="Observación del pedido (ej. tocar timbre)" style={{ width: '100%', marginBottom: 8 }} />
          </div>

          <button className="btn-green" style={{ width: '100%', padding: 13 }} disabled={!cart.length} onClick={guardar}>
            {editId ? '💾 Guardar cambios' : '💾 Cargar pedido'}
          </button>
          {editId && <button style={{ width: '100%', marginTop: 6 }} onClick={cancelar}>✕ Cancelar</button>}
        </div>
      </div>
    </div>
  );
}

// Lista compacta de los pedidos ya cargados hoy (el "cuaderno")
function CuadernoHoy({ pedidos }) {
  if (!pedidos?.length) return null;
  const resumen = (p) => (p.items || []).filter((i) => i.estado !== 'anulado')
    .map((i) => `${i.cantidad}× ${i.nombre}`).join(', ');
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>🧾 Cargados hoy ({pedidos.length})</div>
      {pedidos.map((p) => (
        <div key={p.id} className="cart-item" style={{ fontSize: 13 }}>
          <span style={{ fontWeight: 700, minWidth: 90 }}>{p.cliente_nombre || 'Cliente'}</span>
          <span style={{ flex: 1, color: 'var(--muted)' }}>{resumen(p)}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: p.estado === 'cobrado' ? 'var(--green)' : 'var(--orange)', marginRight: 8 }}>{p.estado === 'cobrado' ? '✅' : '🕒'}</span>
          <b>{money(p.total)}</b>
        </div>
      ))}
    </div>
  );
}

// ---------- Bandeja del BOT: propuestas de vianda leídas de WhatsApp ----------
function InboxViandas({ inbox, recargar }) {
  return (
    <div className="card" style={{ marginBottom: 14, borderColor: 'var(--blue)' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>📥 Pedidos de WhatsApp por confirmar</div>
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
        {inbox.map((m) => <PropuestaCard key={m.id} msg={m} onDone={recargar} />)}
      </div>
    </div>
  );
}

function PropuestaCard({ msg, onDone }) {
  const p = msg.propuesta || {};
  const [nombre, setNombre] = useState(p.cliente_nombre || msg.nombre || '');
  const [direccion, setDireccion] = useState(p.cliente_direccion || '');
  const [entrega, setEntrega] = useState(p.entrega === 'retiro' ? 'retiro' : 'domicilio');
  const [items, setItems] = useState((p.items || []).map((x) => ({ ...x })));
  const [ocupado, setOcupado] = useState(false);

  const cambiar = (i, delta) => setItems((its) => its.map((x, k) => (k === i ? { ...x, cantidad: x.cantidad + delta } : x)).filter((x) => x.cantidad > 0));
  const setPrecio = (i, v) => setItems((its) => its.map((x, k) => (k === i ? { ...x, precio: Number(String(v).replace(/[^\d]/g, '')) || 0, precioPendiente: false } : x)));
  const setObs = (i, v) => setItems((its) => its.map((x, k) => (k === i ? { ...x, observacion: v } : x)));
  const total = items.reduce((a, x) => a + (x.precio || 0) * x.cantidad, 0);
  const faltaPrecio = items.some((x) => !(x.precio > 0));

  const aceptar = async () => {
    if (!items.length) { toast('La propuesta quedó sin ítems.', 'error'); return; }
    if (faltaPrecio && !(await confirmar('Hay ítems SIN precio (los extras fuera del menú). ¿Confirmar igual? Podés cargarles el precio arriba.', { ok: 'Confirmar igual', cancelar: 'Volver a cargar' }))) return;
    setOcupado(true);
    try {
      await api.viandasInboxConfirmar(msg.id, {
        cliente_nombre: nombre.trim() || null, cliente_telefono: p.cliente_telefono || msg.telefono,
        cliente_direccion: direccion.trim() || null, entrega, hora_entrega: p.hora_entrega || null, items,
      });
      toast('✅ Pedido confirmado. Se le avisó al cliente.');
      onDone();
    } catch (e) { toast('No se pudo confirmar: ' + e.message, 'error'); setOcupado(false); }
  };
  const descartar = async () => {
    if (!(await confirmar('¿Descartar este pedido de WhatsApp?', { peligro: true, ok: 'Descartar', cancelar: 'Volver' }))) return;
    try { await api.viandasInboxDescartar(msg.id); onDone(); }
    catch (e) { toast('No se pudo descartar: ' + e.message, 'error'); }
  };

  return (
    <div className="card" style={{ background: 'var(--panel2)' }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', marginBottom: 6 }}>💬 "{msg.texto}"</div>
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" style={{ width: '100%', marginBottom: 6, fontWeight: 700 }} />
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>📞 {p.cliente_telefono || msg.telefono}</div>
      {items.map((x, i) => {
        const tieneCambio = !!(x.observacion || '').trim() && !x.libre; // menú con una variante pedida
        const precioAlerta = !(x.precio > 0) || tieneCambio;            // resaltar si falta precio o hay cambio a revisar
        return (
          <div key={i} style={{ borderBottom: '1px solid var(--panel)', padding: '6px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>
                {x.nombre}
                {x.libre && <span style={{ color: 'var(--orange)', fontSize: 11 }}> · extra {x.precio > 0 ? '' : '(poné precio)'}</span>}
                {x.deCarta && <span style={{ color: 'var(--muted)', fontSize: 11 }}> · agregado (de la carta)</span>}
                {tieneCambio && <span style={{ color: 'var(--orange)', fontSize: 11 }}> · con cambio (revisá el precio)</span>}
              </span>
              <div className="qty">
                <button onClick={() => cambiar(i, -1)}>−</button>
                <b>{x.cantidad}</b>
                <button onClick={() => cambiar(i, 1)}>+</button>
              </div>
              <input inputMode="numeric" value={x.precio || ''} onChange={(e) => setPrecio(i, e.target.value)}
                placeholder="$" title="Precio unitario"
                style={{ width: 74, textAlign: 'right', borderColor: precioAlerta ? 'var(--orange)' : '' }} />
            </div>
            <input value={x.observacion || ''} onChange={(e) => setObs(i, e.target.value)}
              placeholder="Cambio/aclaración (ej. con ensalada en vez de puré)"
              style={{ width: '100%', fontSize: 12, marginTop: 4, borderColor: tieneCambio ? 'var(--orange)' : '' }} />
          </div>
        );
      })}
      <div className="total-row"><span>Total</span><span>{money(total)}</span></div>
      <div style={{ display: 'flex', gap: 6, margin: '8px 0 6px' }}>
        <button className={entrega === 'domicilio' ? 'btn-accent' : ''} style={{ flex: 1 }} onClick={() => setEntrega('domicilio')}>🛵 Domicilio</button>
        <button className={entrega === 'retiro' ? 'btn-accent' : ''} style={{ flex: 1 }} onClick={() => setEntrega('retiro')}>🏪 Retira</button>
      </div>
      {entrega === 'domicilio' && (
        <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección" style={{ width: '100%', marginBottom: 8 }} />
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn-green" style={{ flex: 1, padding: 10 }} disabled={ocupado} onClick={aceptar}>✔ Confirmar</button>
        <button className="btn-red" style={{ padding: 10 }} disabled={ocupado} onClick={descartar}>✗</button>
      </div>
    </div>
  );
}

// ---------- Pestaña PEDIDOS DEL DÍA (reparto + cobro) ----------
function DelDia({ pedidos, porMenu, totalDia, recargar, onEditar }) {
  const [cobrarId, setCobrarId] = useState(null);
  const [fiadoId, setFiadoId] = useState(null);
  const [cuentas, setCuentas] = useState([]);
  const [cuentaId, setCuentaId] = useState('');
  const [buscar, setBuscar] = useState('');

  useEffect(() => { api.cuentas().then(setCuentas).catch(() => {}); }, []);
  const recargarCuentas = () => api.cuentas().then(setCuentas).catch(() => {});

  const entregar = async (p) => {
    try { await api.entregar(p.id, true); recargar(); toast(p.entrega === 'retiro' ? '🏪 Retirado.' : '📦 Entregado.'); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };
  // Deshacer: marcar que todavía NO salió (vuelve a "faltan")
  const desentregar = async (p) => {
    try { await api.entregar(p.id, false); recargar(); toast('↩ Marcado como que todavía no salió.'); }
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
      // No imprime solo: si hace falta el comprobante con firma, se usa el botón "🖨 Con firma".
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
  // Comprobante con espacio para firma (para el fiado, cuando se necesita el papel firmado)
  const imprimirFirma = async (p) => {
    try { await api.imprimirCuenta(p.id, { firma: true }); toast('🖨 Comprobante con firma enviado.'); }
    catch (e) { toast('No se pudo imprimir: ' + e.message, 'error'); }
  };
  const anular = async (p) => {
    if (!(await confirmar(`¿Anular el pedido de ${p.cliente_nombre || 'la vianda'}? Se saca del día.`, { peligro: true, ok: 'Anular', cancelar: 'Volver' }))) return;
    try { await api.anular(p.id, 'Vianda anulada'); recargar(); toast('Pedido anulado.'); }
    catch (e) { toast('No se pudo anular: ' + e.message, 'error'); }
  };
  // Editar un pedido: si no está cobrado, directo; si ya se cobró, se reabre (anula el cobro) y se edita
  const editar = async (p) => {
    if (p.estado !== 'cobrado') { onEditar(p); return; }
    if (!(await confirmar(
      `El pedido de ${p.cliente_nombre || 'este cliente'} ya está cobrado. Para editarlo hay que reabrirlo: se anula el cobro y después lo volvés a cobrar. ¿Seguir?`,
      { peligro: true, ok: 'Reabrir y editar', cancelar: 'Volver' }
    ))) return;
    try { await api.reabrirPedido(p.id); const fresh = await api.pedido(p.id); onEditar(fresh); }
    catch (e) { toast('No se pudo reabrir: ' + e.message, 'error'); }
  };
  const entregarTodos = async () => {
    if (!(await confirmar('¿Marcar como ENTREGADOS todos los domicilios que faltan? (no toca el cobro)', { ok: 'Marcar entregados' }))) return;
    try { const r = await api.viandasEntregarTodos(); recargar(); toast(`📦 ${r.n} marcado(s) como entregado(s).`); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };
  const hojaReparto = async () => {
    try {
      const r = await api.viandasRepartoImprimir();
      const m = r.resultado?.modo;
      toast(m === 'impreso' ? `🧾 Hoja de reparto impresa (${r.n} entrega/s).` : `🧾 Hoja generada (${r.n} entrega/s).`);
    } catch (e) { toast('No se pudo imprimir la hoja: ' + e.message, 'error'); }
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
  // Cierre del día: ticket con desglose, total y efectivo (al terminar el reparto)
  const cierre = async () => {
    try {
      const r = await api.viandasCierreImprimir();
      const m = r.resultado?.modo;
      let t = m === 'impreso' ? '🧾 Cierre impreso · ' : '🧾 Cierre generado · ';
      t += `Total ${money(r.totalVendido)} · efectivo ${money(r.efectivo)}`;
      if (r.sinCobrar > 0) t += ` · ⚠ ${r.sinCobrar} sin cobrar`;
      toast(t);
    } catch (e) { toast('No se pudo imprimir el cierre: ' + e.message, 'error'); }
  };

  // Separación visual: por entregar (domicilios sin entregar) / a cobrar / cobrados
  const orden = (a, b) => (a.hora_entrega || '~').localeCompare(b.hora_entrega || '~') || a.id - b.id;
  // "Por salir": todavía no se entregó (domicilio) ni se retiró (retiro). Cuando sale, baja de "faltan".
  const faltaEntregar = (p) => !p.entregado_en;
  const q = buscar.trim().toLowerCase();
  const coincide = (p) => !q || (p.cliente_nombre || '').toLowerCase().includes(q) || (p.cliente_telefono || '').includes(q);
  const visibles = pedidos.filter(coincide);
  const gPorEntregar = visibles.filter((p) => faltaEntregar(p)).sort(orden);
  const gACobrar = visibles.filter((p) => !faltaEntregar(p) && p.estado !== 'cobrado').sort(orden);
  const gCobrados = visibles.filter((p) => !faltaEntregar(p) && p.estado === 'cobrado').sort(orden);

  const tarjeta = (p) => {
    const pagado = p.estado === 'cobrado';
    const entregado = !!p.entregado_en;
    const dom = p.entrega !== 'retiro';
    const items = (p.items || []).filter((i) => i.estado !== 'anulado');
    const tel = (p.cliente_telefono || '').replace(/[^\d+]/g, '');
    return (
      <div key={p.id} className="card" style={p.fijo_id ? { borderColor: 'var(--blue)' } : undefined}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 17 }}>{p.fijo_id ? '📌 ' : ''}{p.cliente_nombre || 'Cliente'}</b>
          <b style={{ color: 'var(--accent)', fontSize: 17 }}>{money(p.total)}</b>
        </div>
        <div style={{ margin: '4px 0', fontSize: 13 }}>
          {dom ? <>🛵 {p.cliente_direccion || 'sin dirección'}</> : <>🏪 Retira</>}
          {p.hora_entrega && <span style={{ color: 'var(--muted)', marginLeft: 8 }}>⏰ {p.hora_entrega}</span>}
        </div>
        {p.fijo_id && (
          <div style={{ fontSize: 12, color: 'var(--blue)', marginBottom: 4 }}>
            Cliente fijo{p.fijoPago === 'fiado' ? ' · 📒 fiado' + (p.fijoCuenta ? ' → ' + p.fijoCuenta : '') : ' · 💵 cobra al entregar'}
          </div>
        )}
        {items.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0', borderTop: '1px solid var(--panel2)', paddingTop: 6 }}>
            {items.map((i) => (
              <div key={i.id}>
                {i.cantidad}× {i.nombre}
                {i.observacion && <span style={{ color: 'var(--orange)' }}> — {i.observacion}</span>}
              </div>
            ))}
          </div>
        )}
        {p.observacion && <div style={{ fontSize: 12, color: 'var(--orange)', marginBottom: 4 }}>📝 {p.observacion}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: pagado ? 'var(--green)' : 'var(--orange)' }}>{pagado ? '✅ Pagado' : '🕒 A cobrar'}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: entregado ? 'var(--green)' : 'var(--muted)' }}>
            {entregado ? (dom ? '📦 Entregado' : '🏪 Retirado') : (dom ? '🛵 Sin entregar' : '🏪 Sin retirar')}
          </span>
          {tel && <a href={'tel:' + tel} className="btn-green" style={{ padding: '3px 10px', textDecoration: 'none', marginLeft: 'auto' }}>📞</a>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!entregado && <button style={{ flex: 1, padding: 9 }} onClick={() => entregar(p)}>{dom ? '📦 Entregado' : '🏪 Retirado'}</button>}
          {entregado && <button style={{ flex: 1, padding: 9 }} onClick={() => desentregar(p)} title="Marcar que todavía no salió">↩ {dom ? 'Sin entregar' : 'Sin retirar'}</button>}
          {!pagado && cobrarId !== p.id && fiadoId !== p.id && <button className="btn-green" style={{ flex: 1, padding: 9 }} onClick={() => { setCobrarId(p.id); setFiadoId(null); }}>💵 Cobrar</button>}
          <button style={{ padding: 9 }} onClick={() => editar(p)} title={pagado ? 'Editar (reabre el cobro)' : 'Editar pedido'}>✏</button>
          <button style={{ padding: 9 }} onClick={() => imprimir(p)} title="Imprimir ticket">🖨</button>
          {!pagado && <button className="btn-red" style={{ padding: 9 }} onClick={() => anular(p)} title="Anular (cargado por error)">🗑</button>}
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
              <button onClick={() => imprimirFirma(p)} title="Imprimir comprobante con firma">🖨 Con firma</button>
              <button onClick={() => { setFiadoId(null); setCobrarId(p.id); }}>←</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const grupo = (titulo, arr, color, acciones) => arr.length ? (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color }}>{titulo} ({arr.length})</span>
        {acciones}
      </div>
      <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))' }}>
        {arr.map(tarjeta)}
      </div>
    </div>
  ) : null;

  return (
    <div>
      {porMenu.length > 0 && (() => {
        const totV = porMenu.reduce((a, m) => a + m.cantidad, 0);
        const totE = porMenu.reduce((a, m) => a + (m.entregadas || 0), 0);
        const totF = Math.max(0, totV - totE);
        return (
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700 }}>Resumen del día {money(totalDia)}</span>
              <button className="btn-accent" style={{ marginLeft: 'auto' }} onClick={pasarCocina}
                title="Imprime el acumulado para la cocina (cuántas de cada menú van hasta ahora)">🍳 Pasar a cocina</button>
              <button className="btn-blue" onClick={cierre}
                title="Cierre del día: total, formas de pago y efectivo (al terminar el reparto)">🧾 Cierre de viandas</button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="badge warn">Pedidas: {totV}</span>
              <span className="badge warn">Salieron: {totE}</span>
              <b style={{ color: totF > 0 ? 'var(--orange)' : 'var(--green)' }}>{totF > 0 ? `Faltan salir: ${totF}` : '✅ Salió todo'}</b>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {porMenu.map((m, i) => {
                const f = Math.max(0, m.cantidad - (m.entregadas || 0));
                return (
                  <div key={m.id}>
                    <b>Menú {i + 1}</b> ({m.nombre}): <b>{m.cantidad}</b> · {money(m.importe)}
                    {f > 0 && <span style={{ color: 'var(--orange)' }}> · faltan {f}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {!pedidos.length && <p style={{ color: 'var(--muted)' }}>No hay pedidos de viandas cargados hoy.</p>}

      {pedidos.length > 0 && (
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)}
          placeholder="🔎 Buscar por nombre o teléfono..." style={{ width: '100%', maxWidth: 360, marginBottom: 12 }} />
      )}

      {grupo('🛵 Por salir (entregar / retirar)', gPorEntregar, 'var(--orange)', (
        <>
          <button onClick={hojaReparto} title="Imprimir la lista de domicilios para el cadete">🧾 Hoja de reparto</button>
          <button onClick={entregarTodos} title="Marca entregados SOLO los domicilios (los retiros se marcan uno por uno al pasarlos a buscar)">📦 Domicilios entregados</button>
        </>
      ))}
      {grupo('🕒 A cobrar', gACobrar, 'var(--orange)')}
      {grupo('✅ Cobrados', gCobrados, 'var(--green)')}

      {q && !gPorEntregar.length && !gACobrar.length && !gCobrados.length && (
        <p style={{ color: 'var(--muted)' }}>Ningún pedido coincide con "{buscar}".</p>
      )}
    </div>
  );
}

// ---------- Pestaña CLIENTES FIJOS (reciben vianda automáticamente los días que corresponde) ----------
const DIAS_SEM = [['1', 'Lun'], ['2', 'Mar'], ['3', 'Mié'], ['4', 'Jue'], ['5', 'Vie'], ['6', 'Sáb'], ['0', 'Dom']];
const diasTexto = (csv) => (csv || '').split(',').filter(Boolean)
  .map((n) => (DIAS_SEM.find((d) => d[0] === n) || [, n])[1]).join(' ');

function Fijos() {
  const vacio = { cliente_nombre: '', cliente_telefono: '', cliente_direccion: '', entrega: 'domicilio', dias: ['1', '2', '3', '4', '5'], opcion: 1, cantidad: 1, pago: 'dia', cuenta_id: '', nota: '' };
  const [lista, setLista] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [form, setForm] = useState(vacio);
  const [editId, setEditId] = useState(null);

  const cargar = () => api.viandasFijos().then(setLista).catch(() => {});
  useEffect(() => { cargar(); api.cuentas().then(setCuentas).catch(() => {}); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleDia = (n) => setForm((f) => ({ ...f, dias: f.dias.includes(n) ? f.dias.filter((x) => x !== n) : [...f.dias, n] }));
  const cancelar = () => { setEditId(null); setForm(vacio); };
  const editar = (fj) => {
    setEditId(fj.id);
    setForm({
      cliente_nombre: fj.cliente_nombre || '', cliente_telefono: fj.cliente_telefono || '', cliente_direccion: fj.cliente_direccion || '',
      entrega: fj.entrega || 'domicilio', dias: (fj.dias || '').split(',').filter(Boolean), opcion: fj.opcion ?? 1, cantidad: fj.cantidad || 1,
      pago: fj.pago || 'dia', cuenta_id: fj.cuenta_id ? String(fj.cuenta_id) : '', nota: fj.nota || '',
    });
  };
  const guardar = async () => {
    if (!form.cliente_nombre.trim()) { toast('Poné el nombre.', 'error'); return; }
    if (!form.dias.length) { toast('Elegí al menos un día.', 'error'); return; }
    if (form.pago === 'fiado' && !form.cuenta_id) { toast('Elegí la cuenta del fiado.', 'error'); return; }
    const data = { ...form, dias: form.dias.join(','), cuenta_id: form.pago === 'fiado' ? Number(form.cuenta_id) : null };
    try {
      if (editId) await api.editarFijo(editId, data); else await api.crearFijo(data);
      toast(editId ? '✅ Cliente fijo actualizado.' : '✅ Cliente fijo agregado.');
      cancelar(); cargar();
    } catch (e) { toast('No se pudo guardar: ' + e.message, 'error'); }
  };
  const borrar = async (fj) => {
    if (!(await confirmar(`¿Borrar al cliente fijo "${fj.cliente_nombre}"? No se borran los pedidos ya generados.`, { peligro: true, ok: 'Borrar', cancelar: 'Volver' }))) return;
    try { await api.borrarFijo(fj.id); cargar(); if (editId === fj.id) cancelar(); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };
  const toggleActivo = async (fj) => {
    try { await api.editarFijo(fj.id, { ...fj, activo: !fj.activo }); cargar(); }
    catch (e) { toast('No se pudo: ' + e.message, 'error'); }
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: '380px 1fr', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{editId ? '✏ Editar cliente fijo' : '➕ Nuevo cliente fijo'}</div>
        <input value={form.cliente_nombre} onChange={(e) => set('cliente_nombre', e.target.value)} placeholder="Nombre *" style={{ width: '100%', marginBottom: 6 }} />
        <input value={form.cliente_telefono} onChange={(e) => set('cliente_telefono', e.target.value)} placeholder="Teléfono (opcional)" style={{ width: '100%', marginBottom: 6 }} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <button className={form.entrega === 'domicilio' ? 'btn-accent' : ''} style={{ flex: 1 }} onClick={() => set('entrega', 'domicilio')}>🛵 A domicilio</button>
          <button className={form.entrega === 'retiro' ? 'btn-accent' : ''} style={{ flex: 1 }} onClick={() => set('entrega', 'retiro')}>🏪 Retira</button>
        </div>
        {form.entrega === 'domicilio' && (
          <input value={form.cliente_direccion} onChange={(e) => set('cliente_direccion', e.target.value)} placeholder="Dirección" style={{ width: '100%', marginBottom: 6 }} />
        )}
        <div style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 4px' }}>¿Qué días recibe?</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {DIAS_SEM.map(([n, l]) => (
            <button key={n} className={form.dias.includes(n) ? 'btn-accent' : ''} style={{ padding: '6px 10px' }} onClick={() => toggleDia(n)}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>Menú
            <select value={form.opcion} onChange={(e) => set('opcion', Number(e.target.value))} style={{ display: 'block', marginTop: 4 }}>
              <option value={1}>Menú 1</option>
              <option value={2}>Menú 2</option>
              <option value={0}>A elección</option>
            </select>
          </label>
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>Cantidad
            <input type="number" min="1" value={form.cantidad} onChange={(e) => set('cantidad', Number(e.target.value))} style={{ display: 'block', width: 80, marginTop: 4 }} />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <button className={form.pago === 'dia' ? 'btn-accent' : ''} style={{ flex: 1 }} onClick={() => set('pago', 'dia')}>💵 Cobra al día</button>
          <button className={form.pago === 'fiado' ? 'btn-accent' : ''} style={{ flex: 1 }} onClick={() => set('pago', 'fiado')}>📒 Fiado mensual</button>
        </div>
        {form.pago === 'fiado' && (
          <select value={form.cuenta_id} onChange={(e) => set('cuenta_id', e.target.value)} style={{ width: '100%', marginBottom: 6 }}>
            <option value="">— cuenta del fiado —</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        )}
        <input value={form.nota} onChange={(e) => set('nota', e.target.value)} placeholder="Nota (ej. sin sal, dejar en portería)" style={{ width: '100%', marginBottom: 8 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-green" style={{ flex: 1, padding: 11 }} onClick={guardar}>{editId ? '💾 Guardar' : '➕ Agregar'}</button>
          {editId && <button onClick={cancelar}>✕</button>}
        </div>
      </div>

      <div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Los clientes fijos aparecen <b>solos</b> en “Pedidos del día” los días que corresponde (apenas cargás los menús). Si un día alguno no quiere, anulá ese pedido con el 🗑.
        </p>
        {!lista.length && <p style={{ color: 'var(--muted)' }}>Todavía no hay clientes fijos. Cargá uno a la izquierda.</p>}
        <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
          {lista.map((fj) => (
            <div key={fj.id} className="card" style={{ opacity: fj.activo ? 1 : 0.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <b>{fj.cliente_nombre}</b>
                <span style={{ fontSize: 12, color: fj.entrega === 'retiro' ? 'var(--muted)' : 'var(--accent)' }}>{fj.entrega === 'retiro' ? '🏪 Retira' : '🛵 Domicilio'}</span>
              </div>
              {fj.cliente_direccion && <div style={{ fontSize: 13, color: 'var(--muted)' }}>📍 {fj.cliente_direccion}</div>}
              <div style={{ fontSize: 13, margin: '4px 0' }}>
                📅 {diasTexto(fj.dias)} · {fj.opcion === 0 ? 'a elección' : 'Menú ' + fj.opcion}{fj.cantidad > 1 ? ` ×${fj.cantidad}` : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--blue)' }}>{fj.pago === 'fiado' ? '📒 Fiado' + (fj.cuenta_nombre ? ' → ' + fj.cuenta_nombre : '') : '💵 Cobra al día'}</div>
              {fj.nota && <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', marginTop: 2 }}>📝 {fj.nota}</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button style={{ padding: '6px 10px' }} onClick={() => editar(fj)}>✏ Editar</button>
                <button style={{ padding: '6px 10px' }} onClick={() => toggleActivo(fj)}>{fj.activo ? '⏸ Desactivar' : '▶ Activar'}</button>
                <button className="btn-red" style={{ padding: '6px 10px' }} onClick={() => borrar(fj)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
