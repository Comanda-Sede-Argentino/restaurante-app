import { useEffect, useMemo, useState } from 'react';
import { api, money } from '../api';

// Observaciones rápidas (se tocan para agregar/quitar). Editable a futuro.
const OBS_RAPIDAS = ['Sin sal', 'Sin cebolla', 'Jugoso', 'A punto', 'Bien cocido', 'Sin hielo', 'Para compartir'];
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Componente compartido para tomar pedidos (Mozo, Delivery, WhatsApp)
export default function OrderTaker({ pedido, onEnviado }) {
  const [todos, setTodos] = useState([]); // catálogo completo (para buscar en todo el menú)
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [obsItem, setObsItem] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    api.platos({}).then(setTodos);
  }, []);

  // Sin categorías: con el buscador vacío mostramos todo el menú (ya viene ordenado
  // por los más pedidos); al escribir, busca en todo el menú sin acentos.
  const platosFiltrados = useMemo(() => {
    if (!q.trim()) return todos;
    const qq = norm(q);
    return todos.filter((p) => norm(p.nombre).includes(qq));
  }, [todos, q]);

  const add = (p) => {
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

  const enviar = async () => {
    if (!cart.length) return;
    setEnviando(true);
    try {
      const items = cart.map((x) => ({ ...x, observacion: obsItem[x.plato_id] || null }));
      await api.agregarItems(pedido.id, items);
      setCart([]); setObsItem({}); setCartOpen(false);
      onEnviado && onEnviado();
    } finally { setEnviando(false); }
  };

  return (
    <div className="taker">
      {/* Selección de platos */}
      <div className="menu">
        <input
          placeholder="🔎 Buscar plato en todo el menú..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: '100%', marginBottom: 10 }}
        />
        <div className="cards">
          {platosFiltrados.map((p) => {
            const qty = cart.find((x) => x.plato_id === p.id)?.cantidad || 0;
            return (
              <button key={p.id} className={'plato-btn' + (qty ? ' has-qty' : '')} onClick={() => add(p)}>
                {qty > 0 && <span className="plato-badge">{qty}</span>}
                {qty > 0 && (
                  <span
                    className="plato-minus"
                    onClick={(e) => { e.stopPropagation(); dec(p.id); }}
                  >−</span>
                )}
                <div className="pn">{p.nombre}</div>
                <div className="pp">{money(p.precio)}</div>
              </button>
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
