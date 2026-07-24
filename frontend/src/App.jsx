import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { socket, api } from './api';
import Home from './pages/Home.jsx';
import Mozo from './pages/Mozo.jsx';
import Cafeteria from './pages/Cafeteria.jsx';
import Delivery from './pages/Delivery.jsx';
import KDS from './pages/KDS.jsx';
import Caja from './pages/Caja.jsx';
import Cuentas from './pages/Cuentas.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Admin from './pages/Admin.jsx';
import Ajustes from './pages/Ajustes.jsx';
import WhatsApp from './pages/WhatsApp.jsx';
import PinGate from './components/PinGate.jsx';
import Reportes from './pages/Reportes.jsx';
import Stock from './pages/Stock.jsx';
import { UiHost, toast } from './ui.jsx';

export default function App() {
  const [online, setOnline] = useState(socket.connected);
  const [caja, setCaja] = useState({ horas: null, umbral: 0 });
  const [snoozeCaja, setSnoozeCaja] = useState(() => Number(localStorage.getItem('snoozeCaja') || 0));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const onImpError = (d) =>
      toast('⚠ La comanda del pedido #' + (d.pedido_id ?? '?') +
            ' NO se imprimió. Revisá la COMANDERA y reimprimí desde Cocina.', 'error');
    const onTrancada = (d) => toast(`⚠ La impresora tiene ${d.count ?? ''} comanda(s) sin salir. Revisá el papel o si está encendida.`, 'error');
    const onDash = (d) => setCaja({ horas: d?.horasSinCierre ?? null, umbral: d?.avisarCajaHoras ?? 0 });
    socket.on('connect', on);
    socket.on('disconnect', off);
    socket.on('impresion:error', onImpError);
    socket.on('impresion:trancada', onTrancada);
    socket.on('dashboard:update', onDash);
    api.dashboard().then(onDash).catch(() => {});
    return () => { socket.off('connect', on); socket.off('disconnect', off); socket.off('impresion:error', onImpError); socket.off('impresion:trancada', onTrancada); socket.off('dashboard:update', onDash); };
  }, []);

  const avisarCaja = caja.umbral > 0 && caja.horas != null && caja.horas >= caja.umbral && Date.now() > snoozeCaja;
  const postergarCaja = () => { const t = Date.now() + 2 * 60 * 60 * 1000; localStorage.setItem('snoozeCaja', String(t)); setSnoozeCaja(t); };

  const link = ({ isActive }) => (isActive ? 'active' : '');
  return (
    <div className="app">
      <UiHost />
      <div className="topbar">
        <NavLink to="/" className="brand">🍽 Sede Social</NavLink>
        <nav className="nav">
          <NavLink to="/mozo" className={link}>Mozo</NavLink>
          <NavLink to="/cafeteria" className={link}>Cafetería</NavLink>
          <NavLink to="/delivery" className={link}>Delivery</NavLink>
          <NavLink to="/whatsapp" className={link}>WhatsApp</NavLink>
          <NavLink to="/kds" className={link}>Cocina (KDS)</NavLink>
          <NavLink to="/caja" className={link}>Caja</NavLink>
          <NavLink to="/cuentas" className={link}>Cuentas</NavLink>
          <NavLink to="/dashboard" className={link}>Monitoreo</NavLink>
          <NavLink to="/reportes" className={link}>Reportes</NavLink>
          <NavLink to="/stock" className={link}>Stock</NavLink>
          <NavLink to="/admin" className={link}>Catálogo</NavLink>
          <NavLink to="/ajustes" className={link}>Ajustes</NavLink>
        </nav>
        <div className="spacer" />
        <span className={'dot' + (online ? '' : ' off')} title={online ? 'En línea' : 'Sin conexión'} />
      </div>
      {!online && (
        <div className="offline-banner">
          ⚠ Sin conexión con el sistema — reconectando… Esperá a que vuelva antes de cobrar o mandar comandas.
        </div>
      )}
      {online && avisarCaja && (
        <div className="caja-banner">
          🕒 Hace {Math.round(caja.horas)} h que no se cierra la caja. Conviene cerrar el turno en <b>Caja → Cerrar caja</b>.
          <button className="caja-banner-x" onClick={postergarCaja}>Recordar más tarde</button>
        </div>
      )}
      <div className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/salon" element={<Navigate to="/mozo" replace />} />
          <Route path="/mozo" element={<Mozo />} />
          <Route path="/mozo/:mesaId" element={<Mozo />} />
          <Route path="/cafeteria" element={<Cafeteria />} />
          <Route path="/delivery" element={<Delivery />} />
          <Route path="/whatsapp" element={<WhatsApp />} />
          <Route path="/kds" element={<KDS />} />
          <Route path="/caja" element={<PinGate area="la Caja"><Caja /></PinGate>} />
          <Route path="/cuentas" element={<PinGate area="las Cuentas corrientes"><Cuentas /></PinGate>} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/reportes" element={<PinGate area="los Reportes"><Reportes /></PinGate>} />
          <Route path="/stock" element={<PinGate area="el Stock"><Stock /></PinGate>} />
          <Route path="/admin" element={<PinGate area="el Catálogo"><Admin /></PinGate>} />
          <Route path="/ajustes" element={<PinGate area="Ajustes"><Ajustes /></PinGate>} />
        </Routes>
      </div>
    </div>
  );
}
