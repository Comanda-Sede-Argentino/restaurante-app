import { useEffect, useState } from 'react';
import { api, socket } from '../api';

// Candado de acceso: si el sistema está expuesto por internet y tiene clave activada,
// pide la clave una vez por dispositivo antes de mostrar nada. En la red local (sin candado)
// no aparece. La clave real se valida en el servidor (no alcanza con esconder la pantalla).
export default function AccesoGate({ children }) {
  const [estado, setEstado] = useState('cargando'); // 'cargando' | 'ok' | 'pedir'
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.accesoEstado()
      .then((r) => setEstado(r.requiere && !r.autorizado ? 'pedir' : 'ok'))
      .catch(() => setEstado('ok')); // ante un error de chequeo, no bloquear (uso local)
  }, []);

  const entrar = async (e) => {
    e.preventDefault();
    setEnviando(true); setError('');
    try {
      await api.acceso(clave);
      try { socket.disconnect(); socket.connect(); } catch { /* reconecta solo */ }
      setClave(''); setEstado('ok');
    } catch { setError('Clave incorrecta. Probá de nuevo.'); }
    finally { setEnviando(false); }
  };

  if (estado === 'cargando') return null;
  if (estado === 'ok') return children;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form onSubmit={entrar} className="card" style={{ maxWidth: 360, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 44 }}>🔒</div>
        <h1 className="h1" style={{ marginTop: 8, marginBottom: 4 }}>Sede Social</h1>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>Ingresá la clave para acceder al sistema.</p>
        <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoFocus
          placeholder="Clave" style={{ width: '100%', textAlign: 'center', fontSize: 18, padding: 12 }} />
        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{error}</div>}
        <button className="btn-accent" disabled={enviando || !clave} style={{ width: '100%', marginTop: 12, padding: 12 }}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
