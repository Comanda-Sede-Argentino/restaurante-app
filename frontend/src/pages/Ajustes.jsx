import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Ajustes() {
  const [impresoras, setImpresoras] = useState([]);
  const [puertos, setPuertos] = useState([]);
  const [sectores, setSectores] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.impresoras().then(setImpresoras);
    api.puertosCom().then(setPuertos);
    api.sectores().then(setSectores);
    api.config().then(setCfg);
  }, []);

  if (!cfg) return <p>Cargando...</p>;
  const imp = cfg.impresion;
  const wa = cfg.whatsapp || {};

  const setImp = (campo, valor) => setCfg({ ...cfg, impresion: { ...imp, [campo]: valor } });
  const setWa = (campo, valor) => setCfg({ ...cfg, whatsapp: { ...wa, [campo]: valor } });

  const guardar = async () => {
    await api.guardarConfig({ impresion: imp, whatsapp: wa });
    setMsg('✅ Configuración guardada.');
    setTimeout(() => setMsg(''), 3000);
  };

  // Para serial: guardamos primero y probamos con la config guardada (sin override).
  const probar = async (impresora) => {
    setMsg('Imprimiendo prueba...');
    if (imp.conexion === 'serial') await api.guardarConfig({ impresion: imp });
    const r = await api.testImpresora(imp.conexion === 'serial' ? undefined : impresora);
    setMsg(r.ok ? `✅ Enviado (${r.modo})${r.archivo ? ' · respaldo: ' + r.archivo : ''}` : `❌ No se pudo imprimir (${r.modo || 'error'})`);
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
        <h2 className="h2">Cómo está conectada la impresora</h2>
        <label style={{ display: 'block', marginBottom: 4 }}>
          <input type="radio" name="conexion" checked={(imp.conexion || 'windows') === 'windows'}
            onChange={() => setImp('conexion', 'windows')} />
          {' '}Impresora de Windows (USB o red, ya instalada con su driver)
        </label>
        <label style={{ display: 'block' }}>
          <input type="radio" name="conexion" checked={imp.conexion === 'serial'}
            onChange={() => setImp('conexion', 'serial')} />
          {' '}Puerto serie (COM) — <span style={{ color: 'var(--muted)' }}>para térmicas con cable serial, como la TM-T58</span>
        </label>

        {imp.conexion === 'serial' ? (
          <div style={{ marginTop: 14 }}>
            <h2 className="h2">Puerto y velocidad</h2>
            {!puertos.length && <p style={{ color: 'var(--orange)' }}>⚠ No se detectaron puertos COM. Conectá la impresora y recargá.</p>}
            <label>Puerto: </label>
            <select value={imp.puertoCom || ''} onChange={(e) => setImp('puertoCom', e.target.value)} style={{ minWidth: 120 }}>
              <option value="">— elegir —</option>
              {puertos.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <label style={{ marginLeft: 12 }}>Velocidad (baud): </label>
            <select value={imp.baud || 9600} onChange={(e) => setImp('baud', Number(e.target.value))}>
              {[9600, 19200, 38400, 57600, 115200].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Si no imprime o sale "chino", probá otra velocidad (las TM-T58 suelen ser 9600 o 19200).</p>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <h2 className="h2">Impresora de Windows</h2>
            {!impresoras.length && <p style={{ color: 'var(--orange)' }}>⚠ No se detectaron impresoras. Instalá el driver y recargá.</p>}
            <select value={imp.impresoraComanda || ''} onChange={(e) => setImp('impresoraComanda', e.target.value)} style={{ minWidth: 280 }}>
              <option value="">— (solo guardar en archivo)</option>
              {impresoras.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>
                <input type="radio" name="modo" checked={(imp.modo || 'escpos') === 'escpos'} onChange={() => setImp('modo', 'escpos')} />
                {' '}Térmica de tickets (ESC/POS) — <span style={{ color: 'var(--muted)' }}>destaca plato y mesa en grande</span>
              </label>
              <label style={{ display: 'block' }}>
                <input type="radio" name="modo" checked={imp.modo === 'texto'} onChange={() => setImp('modo', 'texto')} />
                {' '}Impresora común (texto simple)
              </label>
            </div>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <button className="btn-accent" onClick={() => probar(imp.impresoraComanda)}>🖨 Imprimir ticket de prueba</button>
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
