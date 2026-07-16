import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, socket, money } from '../api';

const grupos = [
  {
    titulo: 'Atención',
    tiles: [
      { to: '/salon', ico: '🪑', t: 'Salón', d: 'Plano de mesas' },
      { to: '/mozo', ico: '📝', t: 'Mozo', d: 'Tomar pedidos' },
      { to: '/delivery', ico: '🛵', t: 'Delivery', d: 'Pedidos a domicilio' },
      { to: '/whatsapp', ico: '💬', t: 'WhatsApp', d: 'Pedidos por WhatsApp' },
    ],
  },
  {
    titulo: 'Cocina y control',
    tiles: [
      { to: '/kds', ico: '👨‍🍳', t: 'Cocina', d: 'Comandas en vivo' },
      { to: '/dashboard', ico: '📊', t: 'Monitoreo', d: 'Ventas en tiempo real' },
      { to: '/stock', ico: '📦', t: 'Stock', d: 'Insumos y faltantes' },
    ],
  },
  {
    titulo: 'Caja y administración',
    tiles: [
      { to: '/caja', ico: '💵', t: 'Caja', d: 'Cobro y arqueo' },
      { to: '/cuentas', ico: '📒', t: 'Cuentas', d: 'Fiado / empresas' },
      { to: '/reportes', ico: '📈', t: 'Reportes', d: 'Ventas históricas' },
      { to: '/admin', ico: '🍽', t: 'Catálogo', d: 'Platos y precios' },
      { to: '/ajustes', ico: '⚙️', t: 'Ajustes', d: 'Impresora, mozos, bot' },
    ],
  },
];

export default function Home() {
  const nav = useNavigate();
  const [d, setD] = useState(null);
  useEffect(() => {
    const cargar = () => api.dashboard().then(setD).catch(() => {});
    cargar();
    socket.on('dashboard:update', setD);
    const t = setInterval(cargar, 15000);
    return () => { socket.off('dashboard:update', setD); clearInterval(t); };
  }, []);

  return (
    <div>
      <h1 className="h1" style={{ textAlign: 'center', marginTop: 12 }}>🍽 Argentino Sede Social</h1>

      {/* Estado en vivo */}
      {d && (
        <div className="home-stats">
          <div className="hs"><span className="v">{money(d.ventasHoy)}</span><span className="l">Ventas hoy</span></div>
          <div className="hs"><span className="v">{d.mesasOcupadas}/{d.mesasTotal}</span><span className="l">Mesas</span></div>
          <div className="hs"><span className="v">{d.enCocina}</span><span className="l">En cocina</span></div>
          <div className="hs"><span className="v">{d.pedidosAbiertos}</span><span className="l">Pedidos abiertos</span></div>
          {d.demoradas > 0 && <div className="hs alert"><span className="v">{d.demoradas}</span><span className="l">Demoradas</span></div>}
          {d.faltantes?.length > 0 && <div className="hs alert"><span className="v">{d.faltantes.length}</span><span className="l">Faltan insumos</span></div>}
        </div>
      )}

      {grupos.map((g) => (
        <div key={g.titulo} style={{ marginTop: 18 }}>
          <div className="home-grupo">{g.titulo}</div>
          <div className="tiles">
            {g.tiles.map((t) => (
              <div className="tile" key={t.to} onClick={() => nav(t.to)}>
                <div className="ico">{t.ico}</div>
                <div className="t">{t.t}</div>
                <div className="d">{t.d}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
