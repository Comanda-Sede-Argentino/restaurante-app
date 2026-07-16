import { useState } from 'react';

// Puerta de PIN para las pantallas sensibles (Caja, Catálogo, Ajustes).
// >>> Para cambiar el PIN, editá esta línea: <<<
const PIN = '12345';

// Una vez ingresado bien el PIN, queda desbloqueado para toda la sesión del navegador
// (se vuelve a pedir si se cierra la pestaña/navegador). Es una barrera simple del lado
// del dispositivo: frena al cliente curioso y al toque accidental, no a un experto.
export default function PinGate({ area = 'esta sección', children }) {
  const [ok, setOk] = useState(() => sessionStorage.getItem('pin_ok') === '1');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  if (ok) return children;

  const probar = (e) => {
    e.preventDefault();
    if (pin === PIN) {
      sessionStorage.setItem('pin_ok', '1');
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
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(false); }}
            placeholder="PIN"
            style={{ width: '100%', textAlign: 'center', fontSize: 22, letterSpacing: 6, marginBottom: 10 }}
          />
          {error && <p style={{ color: 'var(--orange)', marginTop: 0 }}>PIN incorrecto.</p>}
          <button className="btn-accent" style={{ width: '100%', padding: 12 }} type="submit">Entrar</button>
        </form>
      </div>
    </div>
  );
}
