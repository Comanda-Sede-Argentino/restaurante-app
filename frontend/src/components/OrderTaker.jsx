import { useEffect, useMemo, useState } from 'react';
import { api, money } from '../api';

// Componente compartido para tomar pedidos (Mozo y Mostrador)
export default function OrderTaker({ pedido, onEnviado, compact }) {
  const [cats, setCats] = useState([]);
  const [catSel, setCatSel] = useState(null);
  const [platos, setPlatos] = useState([]);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [obsItem, setObsItem] = useState({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.categorias().then((c) => { setCats(c); setCatSel(c[0]?.id ?? null); });
  }, []);
  useEffect(() => {
    api.platos(catSel ? { categoria: catSel } : {}).then(setPlatos);
  }, [catSel]);

  const platosFiltrados = useMemo(() => {
    if (!q) return platos;
    const qq = q.toLowerCase();
    return platos.filter((p) => p.nombre.toLowerCase().includes(qq));
  }, [platos, q]);

  const add = (p) => {
    setCart((c) => {
      const ex = c.find((x) => x.plato_id === p.id);
      if (ex) return c.map((x) => (x.plato_id === p.id ? { ...x, cantidad: x.cantidad + 1 } : x));
      return [...c, { plato_id: p.id, nombre: p.nombre, precio_unit: p.precio, cantidad: 1 }];
    });
  };
  const chg = (id, d) =>
    setCart((c) =>
      c.map((x) => (x.plato_id === id ? { ...x, cantidad: Math.max(1, x.cantidad + d) } : x))
    );
  const del = (id) => setCart((c) => c.filter((x) => x.plato_id !== id));
  const total = cart.reduce((s, x) => s + x.cantidad * x.precio_unit, 0);

  const enviar = async () => {
    if (!cart.length) return;
    setEnviando(true);
    try {
      const items = cart.map((x) => ({ ...x, observacion: obsItem[x.plato_id] || null }));
      await api.agregarItems(pedido.id, items);
      setCart([]); setObsItem({});
      onEnviado && onEnviado();
    } finally { setEnviando(false); }
  };

  return (
    <div className="taker">
      <div>
        <input
          placeholder="🔎 Buscar plato..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ width: '100%', marginBottom: 10 }}
        />
        <div className="cats">
          {cats.map((c) => (
            <div
              key={c.id}
              className={'chip' + (catSel === c.id ? ' active' : '')}
              onClick={() => { setCatSel(c.id); setQ(''); }}
            >
              {c.nombre}
            </div>
          ))}
        </div>
        <div className="cards">
          {platosFiltrados.map((p) => (
            <button key={p.id} className="plato-btn" onClick={() => add(p)}>
              <div className="pn">{p.nombre}</div>
              <div className="pp">{money(p.precio)}</div>
            </button>
          ))}
          {!platosFiltrados.length && <p style={{ color: 'var(--muted)' }}>Sin platos.</p>}
        </div>
      </div>

      <div className="cart">
        <h2 className="h2">Comanda {pedido?.mesa ? `· Mesa ${pedido.mesa.numero}` : ''}</h2>
        {!cart.length && <p style={{ color: 'var(--muted)' }}>Agregá platos tocándolos.</p>}
        {cart.map((x) => (
          <div key={x.plato_id} className="cart-item" style={{ flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div>{x.nombre}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>{money(x.precio_unit)} c/u</div>
            </div>
            <div className="qty">
              <button onClick={() => chg(x.plato_id, -1)}>−</button>
              <b>{x.cantidad}</b>
              <button onClick={() => chg(x.plato_id, 1)}>+</button>
            </div>
            <button className="btn-red" onClick={() => del(x.plato_id)}>✕</button>
            <input
              placeholder="Observación (ej: sin sal)"
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
    </div>
  );
}
