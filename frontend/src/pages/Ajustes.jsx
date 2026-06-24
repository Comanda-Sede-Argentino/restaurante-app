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
  const wa = cfg.whatsapp || {};

  const setSector = (sector, valor) =>
    setCfg({ ...cfg, impresion: { ...imp, porSector: { ...imp.porSector, [sector]: valor } } });
  const setWa = (campo, valor) =>
    setCfg({ ...cfg, whatsapp: { ...wa, [campo]: valor } });

  const guardar = async () => {
    await api.guardarConfig({ impresion: imp, whatsapp: wa });
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
          Imprimir la comanda automáticamente al enviar a cocina
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 0 }}>
          Se imprime <b>una sola comanda</b> con todo el pedido. Si no hay impresora configurada,
          se guarda una copia en <code>backend/comandas_impresas</code>.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="h2">Impresora de comandas</h2>
        {!impresoras.length && (
          <p style={{ color: 'var(--orange)' }}>
            ⚠ No se detectaron impresoras en Windows. Instalá el driver de la térmica y recargá.
          </p>
        )}
        <select value={imp.impresoraComanda || ''}
          onChange={(e) => setCfg({ ...cfg, impresion: { ...imp, impresoraComanda: e.target.value } })}
          style={{ minWidth: 280 }}>
          <option value="">— (solo guardar en archivo)</option>
          {impresoras.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button style={{ marginLeft: 8 }} onClick={() => probar(imp.impresoraComanda)}>🖨 Probar</button>

        <div style={{ marginTop: 14 }}>
          <h2 className="h2">Tipo de impresora</h2>
          <label style={{ display: 'block', marginBottom: 4 }}>
            <input type="radio" name="modo" checked={(imp.modo || 'escpos') === 'escpos'}
              onChange={() => setCfg({ ...cfg, impresion: { ...imp, modo: 'escpos' } })} />
            {' '}Térmica de tickets (ESC/POS) — <span style={{ color: 'var(--muted)' }}>recomendado: destaca plato, cantidad y mesa/delivery en grande</span>
          </label>
          <label style={{ display: 'block' }}>
            <input type="radio" name="modo" checked={imp.modo === 'texto'}
              onChange={() => setCfg({ ...cfg, impresion: { ...imp, modo: 'texto' } })} />
            {' '}Impresora común (texto simple)
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="h2">Ancho del ticket (columnas, solo modo texto)</label>
          <input type="number" value={imp.anchoColumnas}
            onChange={(e) => setCfg({ ...cfg, impresion: { ...imp, anchoColumnas: Number(e.target.value) } })}
            style={{ width: 100, marginLeft: 8 }} />
          <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 13 }}>(58 mm ≈ 32 · 80 mm ≈ 42/48)</span>
        </div>
      </div>

      <h1 className="h1" style={{ marginTop: 24 }}>Ajustes · Respuestas automáticas de WhatsApp</h1>
      <div className="card" style={{ marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={wa.autoRespuesta !== false}
            onChange={(e) => setWa('autoRespuesta', e.target.checked)} />
          Responder automáticamente los mensajes entrantes
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 0 }}>
          El sistema detecta si el mensaje es un <b>pedido</b> (por las palabras clave) o una
          <b> consulta</b>, y responde distinto en cada caso. No repite la respuesta al mismo número
          dentro del tiempo configurado (salvo que cambie de consulta a pedido).
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="h2">Palabras clave que indican un pedido</h2>
        <textarea
          value={(wa.palabrasPedido || []).join(', ')}
          onChange={(e) => setWa('palabrasPedido', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          rows={2} style={{ width: '100%' }}
          placeholder="pedido, encargar, quiero, mandame, delivery..." />
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>Separadas por comas. No distingue mayúsculas ni acentos.</p>

        <h2 className="h2" style={{ marginTop: 12 }}>Mensaje cuando ES un pedido</h2>
        <textarea value={wa.textoRecepcion || ''} onChange={(e) => setWa('textoRecepcion', e.target.value)}
          rows={3} style={{ width: '100%' }} />

        <h2 className="h2" style={{ marginTop: 12 }}>Mensaje cuando es otra consulta</h2>
        <textarea value={wa.textoConsulta || ''} onChange={(e) => setWa('textoConsulta', e.target.value)}
          rows={3} style={{ width: '100%' }} />

        <div style={{ marginTop: 12 }}>
          <label className="h2">No repetir la respuesta dentro de</label>
          <input type="number" value={wa.cooldownMin ?? 180}
            onChange={(e) => setWa('cooldownMin', Number(e.target.value))}
            style={{ width: 90, marginLeft: 8 }} /> <span style={{ color: 'var(--muted)' }}>minutos</span>
        </div>
      </div>

      <button className="btn-green" style={{ padding: 13 }} onClick={guardar}>💾 Guardar configuración</button>
    </div>
  );
}
