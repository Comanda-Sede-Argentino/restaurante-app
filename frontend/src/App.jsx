import { Routes, Route, NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { socket } from './api';
import Home from './pages/Home.jsx';
import Mozo from './pages/Mozo.jsx';
import Delivery from './pages/Delivery.jsx';
import KDS from './pages/KDS.jsx';
import Salon from './pages/Salon.jsx';
import Caja from './pages/Caja.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Admin from './pages/Admin.jsx';
import Ajustes from './pages/Ajustes.jsx';
import WhatsApp from './pages/WhatsApp.jsx';

export default function App() {
  const [online, setOnline] = useState(socket.connected);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    socket.on('connect', on);
    socket.on('disconnect', off);
    return () => { socket.off('connect', on); socket.off('disconnect', off); };
  }, []);

  const link = ({ isActive }) => (isActive ? 'active' : '');
  return (
    <div className="app">
      <div className="topbar">
        <NavLink to="/" className="brand">🍽 Sede Social</NavLink>
        <nav className="nav">
          <NavLink to="/salon" className={link}>Salón</NavLink>
          <NavLink to="/mozo" className={link}>Mozo</NavLink>
          <NavLink to="/delivery" className={link}>Delivery</NavLink>
          <NavLink to="/whatsapp" className={link}>WhatsApp</NavLink>
          <NavLink to="/kds" className={link}>Cocina (KDS)</NavLink>
          <NavLink to="/caja" className={link}>Caja</NavLink>
          <NavLink to="/dashboard" className={link}>Monitoreo</NavLink>
          <NavLink to="/admin" className={link}>Catálogo</NavLink>
          <NavLink to="/ajustes" className={link}>Ajustes</NavLink>
        </nav>
        <div className="spacer" />
        <span className={'dot' + (online ? '' : ' off')} title={online ? 'En línea' : 'Sin conexión'} />
      </div>
      <div className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/salon" element={<Salon />} />
          <Route path="/mozo" element={<Mozo />} />
          <Route path="/mozo/:mesaId" element={<Mozo />} />
          <Route path="/delivery" element={<Delivery />} />
          <Route path="/whatsapp" element={<WhatsApp />} />
          <Route path="/kds" element={<KDS />} />
          <Route path="/caja" element={<Caja />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/ajustes" element={<Ajustes />} />
        </Routes>
      </div>
    </div>
  );
}
