import { useState } from 'react';

// Puerta de PIN para las pantallas sensibles.
// >>> Para cambiar el PIN general, editá esta línea: <<<
const PIN = '12345';

// Cada área puede recibir su propia contraseña (prop `clave`) y su propio desbloqueo (prop `store`).
// Por defecto usan el PIN general '12345' y el desbloqueo compartido 'pin_ok'. Reportes, por ejemplo,
// usa una clave propia para que los mozos (que saben el PIN general) no puedan entrar.
// Una vez ingresada bien la clave, queda desbloqueada para toda la sesión del navegador (se vuelve a
// pedir si se cierra la pestaña). Es una barrera simple del lado del dispositivo, no seguridad fuerte.
export default function PinGate({ area = 'esta sección', clave = PIN, store = 'pin_ok', children }) {
  const [ok, setOk] = useState(() => sessionStorage.getItem(store) === '1');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const soloNumeros = /^\d+$/.test(clave);

  if (ok) return children;

  const probar = (e) => {
    e.preventDefault();
    if (pin === clave) {
      sessionStorage.setItem(store, '1');
      setOk(true);
    } else {
      setError(true);
      setPin('');
    }
  };

  return (
    <div style={{ maxWidth: 340, margin: '60px auto' }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <h2 className="h2">🔒 Acceso restringido</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>
          Ingresá el PIN para entrar a <b>{area}</b>.
        </p>
        <form onSubmit={probar}>
          <input
            type="password"
            inputMode={soloNumeros ? 'numeric' : 'text'}
            autoFocus
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(false); }}
            placeholder="Contraseña"
            style={{ width: '100%', textAlign: 'center', fontSize: 22, letterSpacing: 6, marginBottom: 10 }}
          />
          {error && <p style={{ color: 'var(--orange)', marginTop: 0 }}>PIN incorrecto.</p>}
          <button className="btn-accent" style={{ width: '100%', padding: 12 }} type="submit">Entrar</button>
        </form>
      </div>
    </div>
  );
}
