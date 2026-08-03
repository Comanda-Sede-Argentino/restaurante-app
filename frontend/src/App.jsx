import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { socket, api, getOperador, setOperador } from './api';
import Home from './pages/Home.jsx';
import Mozo from './pages/Mozo.jsx';
import Cafeteria from './pages/Cafeteria.jsx';
import Delivery from './pages/Delivery.jsx';
import Reparto from './pages/Reparto.jsx';
import Viandas from './pages/Viandas.jsx';
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
  const [turnoMsg, setTurnoMsg] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false); // menú ☰ desplegable (solo teléfono)
  const [snoozeCaja, setSnoozeCaja] = useState(() => Number(localStorage.getItem('snoozeCaja') || 0));
  // Quién está usando este dispositivo (para las comandas/cierres). Chip siempre visible en la barra.
  const [operador, setOperadorState] = useState(getOperador());
  const [mozos, setMozos] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    api.usuarios().then((u) => setMozos(u.filter((x) => x.rol === 'mozo' || x.rol === 'admin'))).catch(() => {});
    const onOp = (e) => setOperadorState(e.detail ?? getOperador());
    window.addEventListener('operador-change', onOp);
    window.addEventListener('storage', onOp); // sincroniza entre pestañas
    return () => { window.removeEventListener('operador-change', onOp); window.removeEventListener('storage', onOp); };
  }, []);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const onImpError = (d) =>
      toast('⚠ La comanda del pedido #' + (d.pedido_id ?? '?') +
            ' NO se imprimió. Revisá la COMANDERA y reimprimí desde Cocina.', 'error');
    const onTrancada = (d) => toast(`⚠ La impresora tiene ${d.count ?? ''} comanda(s) sin salir. Revisá el papel o si está encendida.`, 'error');
    const onDash = (d) => { setCaja({ horas: d?.horasSinCierre ?? null, umbral: d?.avisarCajaHoras ?? 0 }); setTurnoMsg(d?.turnoSinCerrar ?? null); };
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
        <nav className={'nav' + (menuOpen ? ' open' : '')} onClick={() => setMenuOpen(false)}>
          <NavLink to="/mozo" className={link}>Mozo</NavLink>
          <NavLink to="/cafeteria" className={link}>Cafetería</NavLink>
          <NavLink to="/delivery" className={link}>Delivery</NavLink>
          <NavLink to="/reparto" className={link}>🛵 Reparto</NavLink>
          <NavLink to="/viandas" className={link}>🍱 Viandas</NavLink>
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
        <div className="operador-chip">
          <button className={'op-btn' + (operador ? '' : ' warn')} onClick={() => setPickerOpen((o) => !o)}
            title="Quién está usando este dispositivo (sale en las comandas y cierres)">
            {operador ? '👤 ' + operador : '⚠ Elegí tu nombre'}
          </button>
          {pickerOpen && (
            <>
              <div className="op-backdrop" onClick={() => setPickerOpen(false)} />
              <div className="op-menu">
                <div className="op-menu-title">¿Quién sos? (para tu turno)</div>
                {!mozos.length && <div style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 8px' }}>No hay mozos cargados (Ajustes → Mozos).</div>}
                {mozos.map((m) => (
                  <button key={m.id} className={'op-item' + (m.nombre === operador ? ' active' : '')}
                    onClick={() => { setOperador(m.nombre); setPickerOpen(false); }}>
                    {m.nombre === operador ? '✓ ' : ''}{m.nombre}
                  </button>
                ))}
                {operador && <button className="op-item op-salir" onClick={() => { setOperador(''); setPickerOpen(false); }}>Salir (borrar nombre)</button>}
              </div>
            </>
          )}
        </div>
        <button className="nav-toggle" onClick={() => setMenuOpen((o) => !o)} aria-label="Menú">{menuOpen ? '✕' : '☰'}</button>
        <span className={'dot' + (online ? '' : ' off')} title={online ? 'En línea' : 'Sin conexión'} />
      </div>
      {!online && (
        <div className="offline-banner">
          ⚠ Sin conexión con el sistema — reconectando… Esperá a que vuelva antes de cobrar o mandar comandas.
        </div>
      )}
      {online && turnoMsg && (
        <div className="caja-banner" style={{ background: '#e5484d', color: '#fff' }}>
          {turnoMsg} Cerralo en <b>Caja → Cerrar caja</b>.
        </div>
      )}
      {online && !turnoMsg && avisarCaja && (
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
          <Route path="/reparto" element={<Reparto />} />
          <Route path="/viandas" element={<Viandas />} />
          <Route path="/whatsapp" element={<WhatsApp />} />
          <Route path="/kds" element={<KDS />} />
          <Route path="/caja" element={<PinGate area="la Caja"><Caja /></PinGate>} />
          <Route path="/cuentas" element={<PinGate area="las Cuentas corrientes"><Cuentas /></PinGate>} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/reportes" element={<PinGate area="los Reportes" clave="soloyo25" store="pin_reportes"><Reportes /></PinGate>} />
          <Route path="/stock" element={<PinGate area="el Stock"><Stock /></PinGate>} />
          <Route path="/admin" element={<PinGate area="el Catálogo"><Admin /></PinGate>} />
          <Route path="/ajustes" element={<PinGate area="Ajustes"><Ajustes /></PinGate>} />
        </Routes>
      </div>
    </div>
  );
}
