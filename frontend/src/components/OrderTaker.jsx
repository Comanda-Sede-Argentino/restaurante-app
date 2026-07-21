import { useEffect, useMemo, useState } from 'react';
import { api, money, socket } from '../api';
import { toast } from '../ui.jsx';

// Observaciones rápidas (se tocan para agregar/quitar). Editable a futuro.
const OBS_RAPIDAS = ['Sin sal', 'Sin cebolla', 'Sin hielo', 'Para compartir'];
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
  const [guarnItem, setGuarnItem] = useState({}); // plato_id -> [guarnición por unidad]
  const [salsaItem, setSalsaItem] = useState({}); // plato_id -> [salsa por unidad] (pastas)
  const [puntoItem, setPuntoItem] = useState({}); // plato_id -> [punto de cocción por unidad]
  const [enviando, setEnviando] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  const [frecuentes, setFrecuentes] = useState([]);
  const [guarniciones, setGuarniciones] = useState(['Papas fritas', 'Puré', 'Ensalada mixta', 'Rúcula con queso', 'Puré mixto']);
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

  // Vista "Frecuentes + buscador": con el buscador vacío mostramos solo los MÁS PEDIDOS
  // (sin bebidas, que se buscan); al escribir, busca en TODO el menú (incluidas bebidas).
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

  const toggleObs = (id, txt) => setObsItem((o) => {
    const cur = (o[id] || '').split(',').map((s) => s.trim()).filter(Boolean);
    const i = cur.indexOf(txt);
    if (i >= 0) cur.splice(i, 1); else cur.push(txt);
    return { ...o, [id]: cur.join(', ') };
  });

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

  const enviar = async () => {
    if (!cart.length || enviando) return;
    setEnviando(true);
    try {
      const items = [];
      for (const x of cart) {
        const baseObs = obsItem[x.plato_id] || '';
        // Plato con guarnición o punto y cantidad > 1: lo separamos en unidades
        if (porUnidad(x.plato_id) && x.cantidad > 1) {
          for (let u = 0; u < x.cantidad; u++) {
            items.push({ plato_id: x.plato_id, nombre: x.nombre, precio_unit: x.precio_unit, cantidad: 1, observacion: obsUnidad(x.plato_id, u, baseObs) });
          }
        } else {
          items.push({ plato_id: x.plato_id, nombre: x.nombre, precio_unit: x.precio_unit, cantidad: x.cantidad, observacion: obsUnidad(x.plato_id, 0, baseObs) });
        }
      }
      await api.agregarItems(pedido.id, items);
      setCart([]); setObsItem({}); setGuarnItem({}); setSalsaItem({}); setPuntoItem({}); setCartOpen(false);
      if (draftKey) localStorage.removeItem(draftKey);
      toast('✅ Comanda enviada a cocina.');
      onEnviado && onEnviado();
    } catch (e) {
      toast('⚠ No se pudo enviar la comanda. Revisá la conexión y volvé a intentar. (No se duplicó nada.)', 'error');
    } finally { setEnviando(false); }
  };

  return (
    <div className="taker">
      {/* Selección de platos */}
      <div className="menu">
        <input
          placeholder="🔎 Buscar bebidas y cualquier otro plato..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 2px 8px', color: 'var(--muted)', fontSize: 13 }}>
          {buscando ? (
            <span>Resultados de "{q}"</span>
          ) : (
            <>
              <b style={{ color: 'var(--accent)' }}>⭐ LOS MÁS PEDIDOS</b>
              <span>· bebidas y el resto, buscalos arriba 🔎</span>
            </>
          )}
        </div>
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
                onClick={() => add(p)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(p); } }}
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
            <div className="obs-chips">
              {OBS_RAPIDAS.map((o) => {
                const active = (obsItem[x.plato_id] || '').split(',').map((s) => s.trim()).includes(o);
                return (
                  <span key={o} className={'obs-chip' + (active ? ' active' : '')} onClick={() => toggleObs(x.plato_id, o)}>{o}</span>
                );
              })}
            </div>
            <input
              placeholder="Otra observación..."
              value={obsItem[x.plato_id] || ''}
              onChange={(e) => setObsItem((o) => ({ ...o, [x.plato_id]: e.target.value }))}
              style={{ width: '100%', marginTop: 6, fontSize: 13 }}
            />
          </div>
        ))}
        <div className="total-row"><span>Total</span><span>{money(total)}</span></div>
        <button className="btn-accent" style={{ width: '100%', padding: 14 }} disabled={!cart.length || enviando} onClick={enviar}>
          {enviando ? 'Enviando...' : '🍳 Enviar a cocina'}
        </button>
      </div>

      {/* Fondo oscuro al abrir el carrito en celular */}
      {cartOpen && <div className="sheet-backdrop" onClick={() => setCartOpen(false)} />}

      {/* Barra fija inferior (celular) */}
      {cart.length > 0 && (
        <div className="cart-bar">
          <div style={{ flex: 1 }} onClick={() => setCartOpen(true)}>
            🛒 <b>{totalCount}</b> ítem(s) · <b>{money(total)}</b>
          </div>
          <button onClick={() => setCartOpen(true)}>Ver</button>
          <button className="btn-accent" disabled={enviando} onClick={enviar}>{enviando ? '...' : '🍳 Enviar'}</button>
        </div>
      )}
    </div>
  );
}
