import { useEffect, useMemo, useState } from 'react';
import { api, money, socket } from '../api';
import { toast, confirmar } from '../ui.jsx';

// Observaciones rápidas (se tocan para agregar/quitar). Editable a futuro.
// Puntos de cocción (para platos marcados "pide punto", se elige por unidad)
const PUNTOS = ['Jugoso', 'A punto', 'Bien cocido', 'Vuelta y vuelta'];
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Componente compartido para tomar pedidos (Mozo, Delivery, WhatsApp)
export default function OrderTaker({ pedido, onEnviado }) {
  const [todos, setTodos] = useState([]); // catálogo completo (para buscar en todo el menú)
  const [q, setQ] = useState('');
  const draftKey = pedido?.id ? 'cart_draft_' + pedido.id : null;
  const [cart, setCart] = useState(() => {
    try { return draftKey ? JSON.parse(localStorage.getItem(draftKey)) || [] : []; } catch { return []; }
  });
  const [obsItem, setObsItem] = useState({});
  const [varios, setVarios] = useState(null);      // formulario de pedido especial (VARIOS / fuera de carta)
  const [mitad, setMitad] = useState(null);        // formulario de pizza mitad y mitad { a, b }
  const [media, setMedia] = useState(null);        // formulario de media pizza { v }
  const [guarnItem, setGuarnItem] = useState({}); // plato_id -> [guarnición por unidad]
  const [salsaItem, setSalsaItem] = useState({}); // plato_id -> [salsa por unidad] (pastas)
  const [puntoItem, setPuntoItem] = useState({}); // plato_id -> [punto de cocción por unidad]
  const [enviando, setEnviando] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [elegir, setElegir] = useState(null); // selector rápido al tocar un plato con guarnición/salsa/punto: { plato, cantidad, guarnicion, salsa, punto }
  const [pulse, setPulse] = useState(0);      // contador para animar el 🛒 cada vez que se agrega algo
  // Aviso de "se agregó": destello en el carrito + vibración corta en el celu
  const pulseCart = () => { setPulse((n) => n + 1); try { navigator.vibrate?.(50); } catch { /* sin vibración */ } };

  const [frecuentes, setFrecuentes] = useState([]);
  const [guarniciones, setGuarniciones] = useState(['Papas fritas', 'Puré', 'Puré de calabaza', 'Puré mixto', 'Ensalada mixta', 'Rúcula con queso']);
  const [salsas, setSalsas] = useState(['Salsa roja', 'Salsa mixta', 'Bolognesa', 'Crema y queso']);
  const cargarMenu = () => {
    api.platos({}).then(setTodos);
    api.platosFrecuentes().then(setFrecuentes).catch(() => {});
  };
  useEffect(() => {
    cargarMenu();
    api.config().then((c) => {
      if (c?.cocina?.guarniciones?.length) setGuarniciones(c.cocina.guarniciones);
      if (c?.cocina?.salsas?.length) setSalsas(c.cocina.salsas);
    }).catch(() => {});
    socket.on('plato:disponibilidad', cargarMenu); // la cocina marcó/quitó "sin stock"
    return () => socket.off('plato:disponibilidad', cargarMenu);
  }, []);

  // Qué platos llevan guarnición (por categoría) y cuáles piden punto de cocción (por plato)
  const catGuarnDe = useMemo(() => {
    const m = {}; for (const p of todos) m[p.id] = p.cat_guarnicion; return m;
  }, [todos]);
  const catSalsaDe = useMemo(() => {
    const m = {}; for (const p of todos) m[p.id] = p.cat_salsa; return m;
  }, [todos]);
  const puntoDe = useMemo(() => {
    const m = {}; for (const p of todos) m[p.id] = p.punto; return m;
  }, [todos]);
  // Pizzas (categoría marcada como pizza): para el botón de "media y media"
  const pizzas = useMemo(() => todos.filter((p) => p.cat_pizza && p.activo !== 0), [todos]);
  const cortoPizza = (nom) => (nom || '').replace(/^\s*pizza\s+/i, '').trim();
  const setUnidad = (setter) => (id, unidad, v) => setter((o) => {
    const arr = (o[id] || []).slice();
    arr[unidad] = arr[unidad] === v ? '' : v;
    return { ...o, [id]: arr };
  });
  const setGuarnicion = setUnidad(setGuarnItem);
  const setSalsa = setUnidad(setSalsaItem);
  const setPunto = setUnidad(setPuntoItem);

  // Guardar el borrador del carrito por pedido (sobrevive a recargas de la tablet)
  useEffect(() => {
    if (!draftKey) return;
    if (cart.length) localStorage.setItem(draftKey, JSON.stringify(cart));
    else localStorage.removeItem(draftKey);
  }, [cart, draftKey]);

  // Qué platos mostrar: al buscar, busca en TODO el menú; por defecto, los MÁS PEDIDOS.
  const buscando = q.trim().length > 0;
  const platosFiltrados = useMemo(() => {
    if (buscando) {
      const qq = norm(q);
      return todos.filter((p) => norm(p.nombre).includes(qq));
    }
    return frecuentes;
  }, [todos, frecuentes, q, buscando]);

  const add = (p) => {
    if (p.disponible === 0) return; // sin stock: no se puede agregar
    setCart((c) => {
      const ex = c.find((x) => x.plato_id === p.id);
      if (ex) return c.map((x) => (x.plato_id === p.id ? { ...x, cantidad: x.cantidad + 1 } : x));
      return [...c, { plato_id: p.id, nombre: p.nombre, precio_unit: p.precio, cantidad: 1 }];
    });
  };
  const chg = (id, d) =>
    setCart((c) => c.map((x) => (x.plato_id === id ? { ...x, cantidad: Math.max(1, x.cantidad + d) } : x)));
  const del = (id) => setCart((c) => c.filter((x) => x.plato_id !== id));
  // Restar uno desde el botón del plato (si llega a 0, lo saca del carrito)
  const dec = (id) =>
    setCart((c) => c.flatMap((x) => (x.plato_id !== id ? [x] : x.cantidad > 1 ? [{ ...x, cantidad: x.cantidad - 1 }] : [])));

  // Al tocar un plato: si lleva guarnición/salsa/punto, abre el selector rápido; si no, lo agrega.
  // Las bebidas / platos sin guarnición NO limpian el buscador, así podés tocar de nuevo para sumar varias.
  const tocar = (p) => {
    if (p.disponible === 0) return;
    if (porUnidad(p.id)) { setElegir({ plato: p, cantidad: 1, guarnicion: '', salsa: '', punto: '' }); return; }
    add(p); pulseCart();
  };
  // Agrega N unidades del plato del selector con la guarnición/salsa/punto elegidos (reusa el estado por unidad)
  const agregarElegido = (sel) => {
    const { plato: p, cantidad, guarnicion, salsa, punto } = sel;
    const n = Math.max(1, cantidad || 1);
    const start = cart.find((x) => x.plato_id === p.id)?.cantidad || 0;
    const fill = (setter, val) => setter((o) => { const a = (o[p.id] || []).slice(); for (let i = 0; i < n; i++) a[start + i] = val; return { ...o, [p.id]: a }; });
    if (catGuarnDe[p.id] && guarnicion) fill(setGuarnItem, guarnicion);
    if (catSalsaDe[p.id] && salsa) fill(setSalsaItem, salsa);
    if (puntoDe[p.id] && punto) fill(setPuntoItem, punto);
    setCart((c) => {
      const ex = c.find((x) => x.plato_id === p.id);
      if (ex) return c.map((x) => (x.plato_id === p.id ? { ...x, cantidad: x.cantidad + n } : x));
      return [...c, { plato_id: p.id, nombre: p.nombre, precio_unit: p.precio, cantidad: n }];
    });
    setElegir(null); setQ(''); pulseCart();
  };
  const confirmarElegir = () => agregarElegido(elegir);
  // ¿El plato del selector SOLO pide guarnición? (sin punto ni salsa) -> tocar la guarnición agrega directo
  const soloGuarnicion = (id) => catGuarnDe[id] && !puntoDe[id] && !catSalsaDe[id];
  // Tocar una guarnición en el selector: si es cantidad 1 y solo pide guarnición, agrega de una (2 toques);
  // si no, solo la marca (para elegir cantidad / punto / salsa y confirmar con el botón).
  const tocarGuarnicion = (g) => {
    if (elegir.cantidad === 1 && soloGuarnicion(elegir.plato.id)) { agregarElegido({ ...elegir, guarnicion: g }); return; }
    setElegir((e) => ({ ...e, guarnicion: e.guarnicion === g ? '' : g }));
  };

  // Agregar un pedido ESPECIAL / fuera de carta (VARIOS): nombre + precio libres. Va a la comanda de cocina.
  const agregarVarios = () => {
    const nombre = (varios?.nombre || '').trim();
    if (!nombre) { toast('Escribí qué pidió el cliente (ej. milanesa con fideos).', 'error'); return; }
    const precio = Math.round(Number(String(varios.precio).replace(/[^\d]/g, '')) || 0);
    const id = -Date.now(); // id negativo único: solo identifica la línea en el carrito (va como fuera de carta)
    setCart((c) => [...c, { plato_id: id, libre: true, nombre, precio_unit: precio, cantidad: 1 }]);
    setVarios(null);
    setCartOpen(true); pulseCart();
  };

  // Media pizza (media porción de una variedad). Cobra el precio de media (o ~60% si no está cargado).
  const precioMediaDe = (p) => (p.precio_media && p.precio_media > 0) ? p.precio_media : Math.round(p.precio * 0.6 / 1000) * 1000;
  const agregarMedia = () => {
    const p = pizzas.find((x) => x.id === Number(media?.v));
    if (!p) { toast('Elegí la variedad de la media pizza.', 'error'); return; }
    const id = -Date.now();
    setCart((c) => [...c, { plato_id: id, libre: true, nombre: '1/2 ' + cortoPizza(p.nombre), precio_unit: precioMediaDe(p), cantidad: 1 }]);
    setMedia(null);
    setCartOpen(true); pulseCart();
  };

  // Pizza mitad y mitad: elegís dos variedades -> una sola pizza con las 2 mitades. Cobra la más cara.
  const agregarMitad = () => {
    const a = pizzas.find((p) => p.id === Number(mitad?.a));
    const b = pizzas.find((p) => p.id === Number(mitad?.b));
    if (!a || !b) { toast('Elegí las dos mitades de la pizza.', 'error'); return; }
    const nombre = 'Pizza 1/2 ' + cortoPizza(a.nombre) + ' + 1/2 ' + cortoPizza(b.nombre);
    const precio = Math.max(a.precio, b.precio);
    const id = -Date.now();
    setCart((c) => [...c, { plato_id: id, libre: true, nombre, precio_unit: precio, cantidad: 1 }]);
    setMitad(null);
    setCartOpen(true); pulseCart();
  };


  const total = cart.reduce((s, x) => s + x.cantidad * x.precio_unit, 0);
  const totalCount = cart.reduce((s, x) => s + x.cantidad, 0);

  const guarnTexto = (g) => (g === 'SIN' ? 'SIN guarnición' : (g ? 'con ' + g : ''));
  const salsaTexto = (s) => (s ? 'con ' + s.toLowerCase() : '');
  // ¿Este plato necesita elegir algo por unidad? (guarnición, salsa o punto de cocción)
  const porUnidad = (id) => catGuarnDe[id] || catSalsaDe[id] || puntoDe[id];
  const obsUnidad = (id, u, baseObs) =>
    [puntoDe[id] ? (puntoItem[id] || [])[u] : '',
     catGuarnDe[id] ? guarnTexto((guarnItem[id] || [])[u]) : '',
     catSalsaDe[id] ? salsaTexto((salsaItem[id] || [])[u]) : '',
     baseObs]
      .filter(Boolean).join(' - ') || null;

  const enviar = async (sinComanda = false) => {
    if (!cart.length || enviando) return;
    if (sinComanda && !(await confirmar('¿Agregar a la cuenta SIN mandar comanda a la cocina?\n\nUsalo solo si ya serviste esto (no sale el ticket ni aparece en la pantalla de cocina). Igual se cobra y queda en los reportes.', { ok: 'Sí, agregar sin comanda' }))) return;
    // Recordatorio: un delivery sin HORA imprime el remito sin hora de entrega.
    if (pedido.tipo === 'delivery' && !pedido.hora_entrega) {
      if (!(await confirmar('⏰ Este delivery NO tiene HORA de entrega cargada.\n\nSi imprimís ahora, el remito sale SIN hora. Cargala arriba (🕒 Hora de entrega) antes de enviar.', { ok: 'Enviar igual (sin hora)', cancelar: 'Volver a cargar la hora' }))) return;
    }
    setEnviando(true);
    try {
      const items = [];
      for (const x of cart) {
        const baseObs = obsItem[x.plato_id] || '';
        // Plato con guarnición o punto y cantidad > 1: lo separamos en unidades
        if (porUnidad(x.plato_id) && x.cantidad > 1) {
          for (let u = 0; u < x.cantidad; u++) {
            items.push({ plato_id: x.libre ? null : x.plato_id, nombre: x.nombre, precio_unit: x.precio_unit, cantidad: 1, observacion: obsUnidad(x.plato_id, u, baseObs) });
          }
        } else {
          items.push({ plato_id: x.libre ? null : x.plato_id, nombre: x.nombre, precio_unit: x.precio_unit, cantidad: x.cantidad, observacion: obsUnidad(x.plato_id, 0, baseObs) });
        }
      }
      await api.agregarItems(pedido.id, items, { sinComanda });
      setCart([]); setObsItem({}); setGuarnItem({}); setSalsaItem({}); setPuntoItem({}); setCartOpen(false);
      if (draftKey) localStorage.removeItem(draftKey);
      toast(sinComanda ? '✅ Agregado a la cuenta (sin comanda).' : '✅ Comanda enviada a cocina.');
      onEnviado && onEnviado();
    } catch (e) {
      toast('⚠ No se pudo enviar la comanda. Revisá la conexión y volvé a intentar. (No se duplicó nada.)', 'error');
    } finally { setEnviando(false); }
  };

  return (
    <div className="taker">
      {/* Selección de platos */}
      <div className="menu">
        <div className="taker-search" style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            placeholder="🔎 Buscar bebidas y cualquier otro plato..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: 1 }}
          />
          {q && <button onClick={() => setQ('')} title="Borrar búsqueda">✕</button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 2px 8px', color: 'var(--muted)', fontSize: 13 }}>
          {buscando ? (
            <span>Resultados de "{q}"</span>
          ) : (
            <>
              <b style={{ color: 'var(--accent)' }}>⭐ LOS MÁS PEDIDOS</b>
              <span>· bebidas y el resto, buscalos arriba 🔎</span>
            </>
          )}
          <span className="spacer" />
          {pizzas.length > 0 && (
            <>
              <button style={{ fontSize: 12, padding: '3px 8px', flexShrink: 0 }} title="Media pizza (una variedad)"
                onClick={() => setMedia(media ? null : { v: '' })}>
                🍕 Media
              </button>
              <button style={{ fontSize: 12, padding: '3px 8px', flexShrink: 0 }} title="Pizza mitad y mitad"
                onClick={() => setMitad(mitad ? null : { a: '', b: '' })}>
                🍕 ½ y ½
              </button>
            </>
          )}
          <button style={{ fontSize: 12, padding: '3px 8px', flexShrink: 0 }} title="Pedido especial fuera de carta"
            onClick={() => setVarios(varios ? null : { nombre: '', precio: '' })}>
            ➕ Varios
          </button>
        </div>
        {media && (
          <div className="card" style={{ marginBottom: 8, borderColor: 'var(--accent)' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>🍕 <b>Media pizza</b> — elegí la variedad. Cobra el precio de media.</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <select value={media.v} onChange={(e) => setMedia({ v: e.target.value })} style={{ flex: 1, minWidth: 150 }}>
                <option value="">— variedad —</option>
                {pizzas.map((p) => <option key={p.id} value={p.id}>{cortoPizza(p.nombre)} ({money(precioMediaDe(p))})</option>)}
              </select>
              <button className="btn-green" onClick={agregarMedia}>Agregar</button>
              <button onClick={() => setMedia(null)}>Cancelar</button>
            </div>
          </div>
        )}
        {mitad && (
          <div className="card" style={{ marginBottom: 8, borderColor: 'var(--accent)' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              🍕 <b>Pizza mitad y mitad</b> — elegí las dos variedades. Se cobra la más cara.
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              <select value={mitad.a} onChange={(e) => setMitad((m) => ({ ...m, a: e.target.value }))} style={{ flex: 1, minWidth: 150 }}>
                <option value="">— primera mitad —</option>
                {pizzas.map((p) => <option key={p.id} value={p.id}>{cortoPizza(p.nombre)} ({money(p.precio)})</option>)}
              </select>
              <select value={mitad.b} onChange={(e) => setMitad((m) => ({ ...m, b: e.target.value }))} style={{ flex: 1, minWidth: 150 }}>
                <option value="">— segunda mitad —</option>
                {pizzas.map((p) => <option key={p.id} value={p.id}>{cortoPizza(p.nombre)} ({money(p.precio)})</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn-green" onClick={agregarMitad}>Agregar</button>
              <button onClick={() => setMitad(null)}>Cancelar</button>
            </div>
          </div>
        )}
        {varios && (
          <div className="card" style={{ marginBottom: 8, borderColor: 'var(--accent)' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              Pedido fuera de carta (ej. <i>milanesa con fideos</i>, <i>calabaza rellena</i>). Sale en la comanda a la cocina.
            </div>
            <input autoFocus placeholder="¿Qué pidió el cliente?" value={varios.nombre}
              onChange={(e) => setVarios((v) => ({ ...v, nombre: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') agregarVarios(); }}
              style={{ width: '100%', marginBottom: 6 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <input inputMode="numeric" placeholder="Precio $" value={varios.precio}
                onChange={(e) => setVarios((v) => ({ ...v, precio: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') agregarVarios(); }}
                style={{ width: 120 }} />
              <button className="btn-green" onClick={agregarVarios}>Agregar</button>
              <button onClick={() => setVarios(null)}>Cancelar</button>
            </div>
          </div>
        )}
        {elegir && (
          <div className="modal-backdrop" onClick={() => setElegir(null)}>
            <div className="modal" style={{ maxWidth: 480, maxHeight: '88vh', overflowY: 'auto', borderColor: 'var(--accent)' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 19 }}>{elegir.plato.nombre}</b>
                <span className="spacer" />
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>Cantidad:</span>
                <div className="qty">
                  <button onClick={() => setElegir((e) => ({ ...e, cantidad: Math.max(1, e.cantidad - 1) }))}>−</button>
                  <b style={{ fontSize: 19, minWidth: 24, textAlign: 'center', display: 'inline-block' }}>{elegir.cantidad}</b>
                  <button onClick={() => setElegir((e) => ({ ...e, cantidad: e.cantidad + 1 }))}>+</button>
                </div>
              </div>
              {puntoDe[elegir.plato.id] ? (
                <div className="obs-chips" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 14, color: 'var(--muted)', alignSelf: 'center', marginRight: 2 }}>🔥 Punto:</span>
                  {PUNTOS.map((pt) => <span key={pt} className={'obs-chip' + (elegir.punto === pt ? ' active' : '')} onClick={() => setElegir((e) => ({ ...e, punto: e.punto === pt ? '' : pt }))}>{pt}</span>)}
                </div>
              ) : null}
              {catGuarnDe[elegir.plato.id] ? (
                <div className="obs-chips" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 14, color: 'var(--muted)', alignSelf: 'center', marginRight: 2 }}>🍟 Guarnición:</span>
                  {guarniciones.map((g) => <span key={g} className={'obs-chip' + (elegir.guarnicion === g ? ' active' : '')} onClick={() => tocarGuarnicion(g)}>{g}</span>)}
                  <span className={'obs-chip' + (elegir.guarnicion === 'SIN' ? ' active' : '')} onClick={() => tocarGuarnicion('SIN')}>Sin</span>
                  {elegir.cantidad === 1 && soloGuarnicion(elegir.plato.id) && (
                    <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center', marginLeft: 4 }}>· tocá una y se agrega</span>
                  )}
                </div>
              ) : null}
              {catSalsaDe[elegir.plato.id] ? (
                <div className="obs-chips" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 14, color: 'var(--muted)', alignSelf: 'center', marginRight: 2 }}>🍝 Salsa:</span>
                  {salsas.map((s) => <span key={s} className={'obs-chip' + (elegir.salsa === s ? ' active' : '')} onClick={() => setElegir((e) => ({ ...e, salsa: e.salsa === s ? '' : s }))}>{s}</span>)}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="btn-green" style={{ flex: 1, padding: 14, fontSize: 16 }} onClick={confirmarElegir}>➕ Agregar{elegir.cantidad > 1 ? ` (${elegir.cantidad})` : ''}</button>
                <button style={{ padding: 14 }} onClick={() => setElegir(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
        <div className="cards">
          {platosFiltrados.map((p) => {
            const qty = cart.find((x) => x.plato_id === p.id)?.cantidad || 0;
            const agotado = p.disponible === 0;
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                className={'plato-btn' + (qty ? ' has-qty' : '') + (agotado ? ' agotado' : '')}
                onClick={() => tocar(p)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tocar(p); } }}
              >
                {qty > 0 && !agotado && <span className="plato-badge">{qty}</span>}
                {qty > 0 && !agotado && (
                  <span
                    className="plato-minus"
                    onClick={(e) => { e.stopPropagation(); dec(p.id); }}
                  >−</span>
                )}
                <div className="pn">{p.nombre}</div>
                {agotado ? <div className="pp" style={{ color: '#e5484d', fontWeight: 700 }}>SIN STOCK</div> : <div className="pp">{money(p.precio)}</div>}
              </div>
            );
          })}
          {!platosFiltrados.length && <p style={{ color: 'var(--muted)' }}>Sin resultados.</p>}
        </div>
      </div>

      {/* Carrito: panel lateral en PC, hoja inferior en celular */}
      <div className={'cart' + (cartOpen ? ' open' : '')}>
        <div className="cart-head">
          <h2 className="h2" style={{ margin: 0 }}>Comanda {pedido?.mesa ? `· Mesa ${pedido.mesa.numero}` : ''}</h2>
          <button className="cart-close" onClick={() => setCartOpen(false)}>✕</button>
        </div>
        {!cart.length && <p style={{ color: 'var(--muted)' }}>Tocá los platos para agregarlos.</p>}
        {cart.map((x) => (
          <div key={x.plato_id} className="cart-item" style={{ flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <div>{x.nombre}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>{money(x.precio_unit)} c/u</div>
            </div>
            <div className="qty">
              <button onClick={() => chg(x.plato_id, -1)}>−</button>
              <b>{x.cantidad}</b>
              <button onClick={() => chg(x.plato_id, 1)}>+</button>
            </div>
            <button className="btn-red" onClick={() => del(x.plato_id)}>✕</button>
            {porUnidad(x.plato_id) ? (
              <div style={{ width: '100%' }}>
                {Array.from({ length: x.cantidad }).map((_, u) => (
                  <div key={u} style={x.cantidad > 1 ? { borderLeft: '3px solid var(--panel2)', paddingLeft: 8, marginBottom: 6 } : undefined}>
                    {x.cantidad > 1 && <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginTop: 4 }}>{x.nombre} #{u + 1}</div>}
                    {puntoDe[x.plato_id] ? (
                      <div className="obs-chips">
                        <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center', marginRight: 2 }}>🔥 Punto:</span>
                        {PUNTOS.map((p) => (
                          <span key={p} className={'obs-chip' + ((puntoItem[x.plato_id]?.[u]) === p ? ' active' : '')} onClick={() => setPunto(x.plato_id, u, p)}>{p}</span>
                        ))}
                      </div>
                    ) : null}
                    {catGuarnDe[x.plato_id] ? (
                      <div className="obs-chips">
                        <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center', marginRight: 2 }}>🍟 Guarnición:</span>
                        {guarniciones.map((g) => (
                          <span key={g} className={'obs-chip' + ((guarnItem[x.plato_id]?.[u]) === g ? ' active' : '')} onClick={() => setGuarnicion(x.plato_id, u, g)}>{g}</span>
                        ))}
                        <span className={'obs-chip' + ((guarnItem[x.plato_id]?.[u]) === 'SIN' ? ' active' : '')} onClick={() => setGuarnicion(x.plato_id, u, 'SIN')}>Sin</span>
                      </div>
                    ) : null}
                    {catSalsaDe[x.plato_id] ? (
                      <div className="obs-chips">
                        <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center', marginRight: 2 }}>🍝 Salsa:</span>
                        {salsas.map((s) => (
                          <span key={s} className={'obs-chip' + ((salsaItem[x.plato_id]?.[u]) === s ? ' active' : '')} onClick={() => setSalsa(x.plato_id, u, s)}>{s}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <input
              placeholder="Observación (ej. sin sal, para compartir)..."
              value={obsItem[x.plato_id] || ''}
              onChange={(e) => setObsItem((o) => ({ ...o, [x.plato_id]: e.target.value }))}
              style={{ width: '100%', marginTop: 6, fontSize: 13 }}
            />
          </div>
        ))}
        <div className="total-row"><span>Total</span><span>{money(total)}</span></div>
        <button className="btn-accent" style={{ width: '100%', padding: 14 }} disabled={!cart.length || enviando} onClick={() => enviar(false)}>
          {enviando ? 'Enviando...' : '🍳 Enviar a cocina'}
        </button>
        {pedido.tipo === 'salon' && (
          <button style={{ width: '100%', padding: 10, marginTop: 8 }} disabled={!cart.length || enviando} onClick={() => enviar(true)}
            title="Solo suma a la cuenta. No imprime comanda ni va a la pantalla de cocina. Usalo si ya serviste esto.">
            ➕ Agregar sin comanda (ya servido)
          </button>
        )}
      </div>

      {/* Fondo oscuro al abrir el carrito en celular */}
      {cartOpen && <div className="sheet-backdrop" onClick={() => setCartOpen(false)} />}

      {/* Barra fija inferior (celular) */}
      {cart.length > 0 && (
        <div className="cart-bar">
          <div style={{ flex: 1 }} onClick={() => setCartOpen(true)}>
            <span className="cart-pop" key={pulse}>🛒 <b>{totalCount}</b> ítem(s) · <b>{money(total)}</b></span>
          </div>
          <button onClick={() => setCartOpen(true)}>Ver</button>
          <button className="btn-accent" disabled={enviando} onClick={() => enviar(false)}>{enviando ? '...' : '🍳 Enviar'}</button>
        </div>
      )}
    </div>
  );
}
