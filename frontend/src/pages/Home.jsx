import { useNavigate } from 'react-router-dom';

const tiles = [
  { to: '/salon', ico: '🪑', t: 'Salón', d: 'Plano de mesas y estados' },
  { to: '/mozo', ico: '📝', t: 'Mozo', d: 'Tomar pedidos en la mesa' },
  { to: '/delivery', ico: '🛵', t: 'Delivery', d: 'Pedidos a domicilio' },
  { to: '/whatsapp', ico: '💬', t: 'WhatsApp', d: 'Pedidos por WhatsApp' },
  { to: '/kds', ico: '👨‍🍳', t: 'Cocina (KDS)', d: 'Comandas en tiempo real' },
  { to: '/caja', ico: '💵', t: 'Caja', d: 'Cobro y cierre' },
  { to: '/dashboard', ico: '📊', t: 'Monitoreo', d: 'Ventas en vivo' },
  { to: '/admin', ico: '🍽', t: 'Catálogo', d: 'Platos, categorías y precios' },
  { to: '/ajustes', ico: '🖨', t: 'Ajustes', d: 'Impresoras de comandas' },
];

export default function Home() {
  const nav = useNavigate();
  return (
    <div>
      <h1 className="h1" style={{ textAlign: 'center', marginTop: 20 }}>
        Sistema de Administración — Restaurante Argentino Sede Social
      </h1>
      <p style={{ textAlign: 'center', color: 'var(--muted)' }}>
        Pedidos · Comandas · Catálogo · Monitoreo en tiempo real
      </p>
      <div className="tiles">
        {tiles.map((t) => (
          <div className="tile" key={t.to} onClick={() => nav(t.to)}>
            <div className="ico">{t.ico}</div>
            <div className="t">{t.t}</div>
            <div className="d">{t.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
