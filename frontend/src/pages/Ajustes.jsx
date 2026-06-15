import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Ajustes() {
  const [impresoras, setImpresoras] = useState([]);
  const [sectores, setSectores] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.impresoras().then(setImpresoras);
    api.sectores().then(setSectores);
    api.config().then(setCfg);
  }, []);

  if (!cfg) return <p>Cargando...</p>;
  const imp = cfg.impresion;

  const setSector = (sector, valor) =>
    setCfg({ ...cfg, impresion: { ...imp, porSector: { ...imp.porSector, [sector]: valor } } });

  const guardar = async () => {
    await api.guardarConfig({ impresion: imp });
    setMsg('✅ Configuración guardada.');
    setTimeout(() => setMsg(''), 3000);
  };

  const probar = async (impresora) => {
    setMsg('Imprimiendo prueba...');
    const r = await api.testImpresora(impresora);
    setMsg(r.ok ? `✅ Enviado (${r.modo})${r.archivo ? ' · respaldo: ' + r.archivo : ''}` : '❌ Error de impresión');
  };

  return (
    <div>
      <h1 className="h1">Ajustes · Impresión de comandas</h1>
      {msg && <div className="card" style={{ marginBottom: 12, borderColor: 'var(--accent)' }}>{msg}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={!!imp.habilitada}
            onChange={(e) => setCfg({ ...cfg, impresion: { ...imp, habilitada: e.target.checked } })} />
          Imprimir comandas automáticamente al enviar a cocina
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 0 }}>
          Cada comanda se imprime en la impresora del sector. Si un sector no tiene impresora asignada,
          se guarda una copia en <code>backend/comandas_impresas</code>.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="h2">Impresora por sector de cocina</h2>
        {!impresoras.length && (
          <p style={{ color: 'var(--orange)' }}>
            ⚠ No se detectaron impresoras instaladas en Windows. Instalá el driver de la térmica y recargá.
          </p>
        )}
        <table>
          <thead><tr><th>Sector</th><th>Impresora</th><th></th></tr></thead>
          <tbody>
            {sectores.map((s) => (
              <tr key={s.id}>
                <td><b>{s.nombre}</b></td>
                <td>
                  <select value={imp.porSector?.[s.nombre] || ''} onChange={(e) => setSector(s.nombre, e.target.value)} style={{ minWidth: 220 }}>
                    <option value="">— (solo archivo)</option>
                    {impresoras.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td><button onClick={() => probar(imp.porSector?.[s.nombre])}>🖨 Probar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="h2">Impresora por defecto (fallback)</h2>
        <select value={imp.impresoraPorDefecto || ''}
          onChange={(e) => setCfg({ ...cfg, impresion: { ...imp, impresoraPorDefecto: e.target.value } })}
          style={{ minWidth: 260 }}>
          <option value="">— ninguna</option>
          {impresoras.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div style={{ marginTop: 10 }}>
          <label className="h2">Ancho del ticket (columnas)</label>
          <input type="number" value={imp.anchoColumnas}
            onChange={(e) => setCfg({ ...cfg, impresion: { ...imp, anchoColumnas: Number(e.target.value) } })}
            style={{ width: 100, marginLeft: 8 }} />
          <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 13 }}>(48 mm ≈ 32 · 80 mm ≈ 42/48)</span>
        </div>
      </div>

      <button className="btn-green" style={{ padding: 13 }} onClick={guardar}>💾 Guardar configuración</button>
    </div>
  );
}
