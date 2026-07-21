import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast, confirmar, preguntar } from '../ui.jsx';

export default function Ajustes() {
  const [impresoras, setImpresoras] = useState([]);
  const [puertos, setPuertos] = useState([]);
  const [sectores, setSectores] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState('');
  const [tgEstado, setTgEstado] = useState(null);
  const [mozos, setMozos] = useState([]);
  const [nuevoMozo, setNuevoMozo] = useState('');
  const [vozNueva, setVozNueva] = useState(''); // clave de voz a pegar (visible, arranca vacía)

  const refrescarTg = () => api.tgEstado().then(setTgEstado).catch(() => {});
  const cargarMozos = () => api.usuarios().then((u) => setMozos(u.filter((x) => x.rol === 'mozo')));

  useEffect(() => {
    api.impresoras().then(setImpresoras);
    api.puertosCom().then(setPuertos);
    api.sectores().then(setSectores);
    api.config().then(setCfg);
    cargarMozos();
    refrescarTg();
  }, []);

  const agregarMozo = async () => {
    const n = nuevoMozo.trim();
    if (!n) return;
    await api.crearUsuario({ nombre: n, rol: 'mozo' });
    setNuevoMozo(''); cargarMozos();
  };
  const renombrarMozo = async (m) => {
    const n = await preguntar('Nuevo nombre:', m.nombre);
    if (!n || !n.trim()) return;
    await api.editarUsuario(m.id, { nombre: n.trim() }); cargarMozos();
  };
  const borrarMozo = async (m) => {
    if (!(await confirmar(`¿Borrar al mozo "${m.nombre}"?`, { peligro: true, ok: 'Borrar' }))) return;
    await api.borrarUsuario(m.id); cargarMozos();
  };

  if (!cfg) return <p>Cargando...</p>;
  const imp = cfg.impresion;
  const wa = cfg.whatsapp || {};
  const tg = cfg.telegram || {};
  const cocina = cfg.cocina || {};
  const backup = cfg.backup || {};
  const cajaCfg = cfg.caja || {};
  const fact = cfg.facturador || {};

  // Cambiar una opción de impresión y GUARDARLA al instante (no depende del botón de abajo).
  // Todos los controles de impresión son desplegables/casillas, así que es un guardado por clic.
  const setImp = (campo, valor) => {
    const nuevoImp = { ...imp, [campo]: valor };
    setCfg({ ...cfg, impresion: nuevoImp });
    api.guardarConfig({ impresion: nuevoImp })
      .then(() => { setMsg('✅ Impresión guardada.'); setTimeout(() => setMsg(''), 2000); })
      .catch(() => setMsg('❌ No se pudo guardar la impresión (revisá la conexión).'));
  };
  const setWa = (campo, valor) => setCfg({ ...cfg, whatsapp: { ...wa, [campo]: valor } });
  const setTg = (campo, valor) => setCfg({ ...cfg, telegram: { ...tg, [campo]: valor } });
  const setCocina = (campo, valor) => setCfg({ ...cfg, cocina: { ...cocina, [campo]: valor } });
  const setBackup = (campo, valor) => setCfg({ ...cfg, backup: { ...backup, [campo]: valor } });
  const setCajaCfg = (campo, valor) => setCfg({ ...cfg, caja: { ...cajaCfg, [campo]: valor } });
  const setFact = (campo, valor) => setCfg({ ...cfg, facturador: { ...fact, [campo]: valor } });

  const guardar = async () => {
    await api.guardarConfig({ impresion: imp, whatsapp: wa, telegram: tg, cocina, backup, caja: cajaCfg, facturador: fact });
    setVozNueva('');                    // limpiar el campo de la clave de voz
    api.config().then(setCfg);          // recargar (la clave queda enmascarada = guardada)
    setMsg('✅ Configuración guardada.');
    setTimeout(() => setMsg(''), 3000);
  };

  const conectarTg = async () => {
    setMsg('Guardando y conectando el bot...');
    await api.guardarConfig({ telegram: tg });
    const r = await api.tgConectar();
    setTgEstado(r);
    setMsg(r.conectado ? `✅ Bot conectado: @${r.bot}` : `❌ No se pudo conectar (${r.error || 'revisá el token'})`);
  };

  const desconectarTg = async () => {
    await api.tgDesconectar();
    refrescarTg();
    setMsg('Bot detenido.');
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
      {msg && <div className="card" style={{ marginBottom: 12, borderColor: 'var(--accent)' }}>{msg}</div>}

      <h1 className="h1">Ajustes · Mozos</h1>
      <div className="card" style={{ marginBottom: 18 }}>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Cargá los nombres reales de los mozos. Cada uno, al abrir el sistema en su celular, elige su nombre arriba
          (queda guardado en ese celular) y así aparece en la comanda que va a la cocina.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input placeholder="Nombre del mozo (ej. Juan)" value={nuevoMozo}
            onChange={(e) => setNuevoMozo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') agregarMozo(); }} style={{ flex: 1 }} />
          <button className="btn-accent" onClick={agregarMozo}>+ Agregar</button>
        </div>
        {!mozos.length && <p style={{ color: 'var(--muted)' }}>No hay mozos cargados todavía.</p>}
        {mozos.map((m) => (
          <div key={m.id} className="cart-item">
            <span style={{ flex: 1 }}>{m.nombre}</span>
            <button onClick={() => renombrarMozo(m)}>✏ Renombrar</button>{' '}
            <button className="btn-red" onClick={() => borrarMozo(m)}>🗑</button>
          </div>
        ))}
      </div>

      <h1 className="h1">Ajustes · Impresión de comandas</h1>

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
            <h2 className="h2">Impresoras de Windows</h2>
            <p style={{ color: 'var(--green)', fontSize: 12, margin: '0 0 8px' }}>✅ La impresora que elijas acá se <b>guarda sola</b> al instante (no hace falta el botón de abajo).</p>
            {!impresoras.length && <p style={{ color: 'var(--orange)' }}>⚠ No se detectaron impresoras. Instalá el driver y recargá.</p>}

            {/* COMANDAS (cocina) */}
            <label style={{ display: 'block', fontWeight: 700, marginBottom: 2 }}>🍳 Impresora de COMANDAS (cocina)</label>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>Donde salen los pedidos a preparar: salón, delivery y Telegram.</p>
            <select value={imp.impresoraComanda || ''} onChange={(e) => setImp('impresoraComanda', e.target.value)} style={{ minWidth: 260 }}>
              <option value="">— (solo guardar en archivo)</option>
              {impresoras.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <label style={{ marginLeft: 10 }}>Ancho: </label>
            <select value={imp.anchoColumnas || 42} onChange={(e) => setImp('anchoColumnas', Number(e.target.value))}>
              <option value={32}>58mm (32)</option>
              <option value={48}>80mm (48)</option>
              <option value={42}>otro (42)</option>
            </select>
            <button style={{ marginLeft: 10 }} onClick={() => probar(imp.impresoraComanda)}>🖨 Probar</button>

            {/* CUENTAS (caja) */}
            <label style={{ display: 'block', fontWeight: 700, margin: '16px 0 2px' }}>🧾 Impresora de CUENTAS / tickets (caja)</label>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>
              Donde sale la cuenta con el total (y facturas/bebidas). Dejala vacía para usar la misma que las comandas.
            </p>
            <select value={imp.impresoraCuenta || ''} onChange={(e) => setImp('impresoraCuenta', e.target.value)} style={{ minWidth: 260 }}>
              <option value="">— usar la misma que las comandas —</option>
              {impresoras.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <label style={{ marginLeft: 10 }}>Ancho: </label>
            <select value={imp.anchoCuenta || 0} onChange={(e) => setImp('anchoCuenta', Number(e.target.value))}>
              <option value={0}>igual que comandas</option>
              <option value={32}>58mm (32)</option>
              <option value={48}>80mm (48)</option>
            </select>
            <button style={{ marginLeft: 10 }} onClick={() => probar(imp.impresoraCuenta || imp.impresoraComanda)}>🖨 Probar</button>

            {/* BEBIDAS (barra) — opcional, apagado por defecto */}
            <label style={{ display: 'block', fontWeight: 700, margin: '16px 0 2px' }}>
              <input type="checkbox" checked={!!imp.imprimirBebidas} onChange={(e) => setImp('imprimirBebidas', e.target.checked)} />
              {' '}🍺 Imprimir un ticket de BEBIDAS aparte (barra)
            </label>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '0 0 6px' }}>
              Si lo activás, cada pedido con bebidas imprime un ticket extra (solo las bebidas) en la impresora que elijas.
            </p>
            {imp.imprimirBebidas && (
              <div>
                <label>Impresora de bebidas: </label>
                <select value={imp.impresoraBebidas || ''} onChange={(e) => setImp('impresoraBebidas', e.target.value)} style={{ minWidth: 240 }}>
                  <option value="">— usar la de comandas (cocina) —</option>
                  {impresoras.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <label style={{ marginLeft: 10 }}>Ancho: </label>
                <select value={imp.anchoBebidas || 0} onChange={(e) => setImp('anchoBebidas', Number(e.target.value))}>
                  <option value={0}>igual que comandas</option>
                  <option value={32}>58mm (32)</option>
                  <option value={48}>80mm (48)</option>
                </select>
                <button style={{ marginLeft: 10 }} onClick={() => probar(imp.impresoraBebidas || imp.impresoraComanda)}>🖨 Probar</button>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
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

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <input type="checkbox" checked={!!imp.sonidoComanda} onChange={(e) => setImp('sonidoComanda', e.target.checked)} />
          <b>🔔 Sonido (chicharra) al imprimir cada comanda</b>
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '2px 0 0' }}>
          Ideal si la impresora está en la cocina sin PC: la impresora suena sola al salir cada comanda,
          así el cocinero se entera. (Requiere impresora térmica con chicharra, como la Fasticket.)
        </p>

        <div style={{ marginTop: 14 }}>
          <button className="btn-accent" onClick={() => probar(imp.impresoraComanda)}>🖨 Imprimir ticket de prueba</button>
        </div>
      </div>

      <h1 className="h1" style={{ marginTop: 24 }}>Ajustes · Guarniciones</h1>
      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Estas son las guarniciones que aparecen como <b>botones rápidos</b> al cargar un plato que lleva guarnición
          (en Mozo/Delivery). Separá con comas.
        </p>
        <textarea
          value={(cocina.guarniciones || []).join(', ')}
          onChange={(e) => setCocina('guarniciones', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          rows={2} style={{ width: '100%' }}
          placeholder="Papas fritas, Puré, Ensalada mixta, Rúcula con queso, Puré mixto" />
      </div>

      <h1 className="h1" style={{ marginTop: 24 }}>Ajustes · Salsas (pastas)</h1>
      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Estas son las salsas que aparecen como <b>botones rápidos</b> al cargar un plato de una categoría
          marcada como "lleva salsa" (Catálogo → Categorías que se completan con salsa). Separá con comas.
        </p>
        <textarea
          value={(cocina.salsas || []).join(', ')}
          onChange={(e) => setCocina('salsas', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          rows={2} style={{ width: '100%' }}
          placeholder="Salsa roja, Salsa mixta, Bolognesa, Crema y queso" />
      </div>

      <h1 className="h1" style={{ marginTop: 24 }}>Ajustes · WhatsApp</h1>
      <div className="card" style={{ marginBottom: 14, borderColor: wa.habilitado === false ? '' : 'var(--orange)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
          <input type="checkbox" checked={wa.habilitado !== false}
            onChange={(e) => setWa('habilitado', e.target.checked)} />
          Usar WhatsApp
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
          ⚡ <b>Si solo usás Telegram, destildá esto.</b> WhatsApp es pesado y, si está activado, hace
          que el sistema <b>arranque más lento</b> (carga e intenta reconectarse en cada inicio). Apagarlo
          acelera el arranque. Tras cambiarlo, reiniciá el sistema para que tome efecto.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14, opacity: wa.habilitado === false ? 0.5 : 1 }}>
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

      <h1 className="h1" style={{ marginTop: 24 }}>Ajustes · Pedidos por Telegram (con IA)</h1>
      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Mandá un mensaje natural al bot desde tu celular (estés donde estés) y el sistema
          interpreta el pedido, lo carga como <b>delivery</b> e <b>imprime la comanda</b> automáticamente.
          Ejemplo: <i>"2 milanesas napolitanas y una coca para Juan, Belgrano 450, a las 21:30"</i>.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={!!tg.habilitado}
            onChange={(e) => setTg('habilitado', e.target.checked)} />
          Activar el bot de Telegram
        </label>

        <h2 className="h2" style={{ marginTop: 14 }}>1) Token del bot</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Creá un bot escribiéndole a <b>@BotFather</b> en Telegram (comando <code>/newbot</code>) y pegá acá el token que te da.
        </p>
        <input type="text" value={tg.token || ''} onChange={(e) => setTg('token', e.target.value)}
          placeholder="123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxx" style={{ width: '100%', fontFamily: 'monospace' }} />

        <h2 className="h2" style={{ marginTop: 14 }}>2) Clave de IA (Claude)</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          La IA interpreta el mensaje y lo arma como pedido. Pegá tu clave de Anthropic (empieza con <code>sk-ant-</code>).
        </p>
        <input type="password" value={tg.claveIA || ''} onChange={(e) => setTg('claveIA', e.target.value)}
          placeholder="sk-ant-..." style={{ width: '100%', fontFamily: 'monospace' }} />
        <div style={{ marginTop: 10 }}>
          <label style={{ color: 'var(--muted)', fontSize: 13, display: 'block', marginBottom: 4 }}>
            Modelo de IA (qué tan fino interpreta los pedidos):
          </label>
          <select value={tg.modeloIA || 'claude-sonnet-4-6'} onChange={(e) => setTg('modeloIA', e.target.value)}
            style={{ minWidth: 340 }}>
            <option value="claude-haiku-4-5">Haiku — más rápido y barato (interpreta menos fino)</option>
            <option value="claude-sonnet-4-6">Sonnet — RECOMENDADO (mejor interpretación, costo bajo)</option>
            <option value="claude-opus-4-8">Opus — máxima precisión (un poco más caro)</option>
          </select>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={{ color: 'var(--muted)', fontSize: 13, display: 'block', marginBottom: 4 }}>
            🎤 Notas de voz (opcional): clave de <b>Groq</b> (gratis) para transcribir audios.
          </label>
          {tg.claveVoz && /^[•]+$/.test(tg.claveVoz) && vozNueva === '' && (
            <p style={{ color: 'var(--green)', fontSize: 12, margin: '0 0 4px' }}>
              ✅ Ya hay una clave guardada. Dejá esto vacío para no cambiarla, o pegá una nueva para reemplazarla.
            </p>
          )}
          <input type="text" value={vozNueva}
            onChange={(e) => { setVozNueva(e.target.value); setTg('claveVoz', e.target.value); }}
            placeholder="gsk_... (pegá acá la clave de Groq)" style={{ width: '100%', fontFamily: 'monospace' }} />
          <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>
            La vas a ver como texto: fijate que empiece con <code>gsk_</code> y que esté completa (sin espacios).
          </p>
        </div>

        <h2 className="h2" style={{ marginTop: 14 }}>3) Quién puede mandar pedidos</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Por seguridad, solo los IDs autorizados pueden imprimir. Escribíle al bot desde tu celular:
          si no estás autorizado te va a responder con <b>tu ID</b>. Copialo y pegalo acá (separá varios con comas).
          <br />Podés ponerle un <b>nombre</b> a cada uno con <code>ID: Nombre</code> — así la comanda dice quién la pasó.
        </p>
        <input type="text" value={(tg.autorizados || []).join(', ')}
          onChange={(e) => setTg('autorizados', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          placeholder="123456789: Juan, 987654321: Pedro" style={{ width: '100%', fontFamily: 'monospace' }} />

        <h2 className="h2" style={{ marginTop: 14 }}>4) Costo de envío (opcional)</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Si cobrás un cargo fijo de delivery, ponelo acá y se suma al total de cada comanda del bot. Dejá <b>0</b> si no cobrás envío.
        </p>
        <input type="number" min="0" step="100" value={tg.costoEnvio ?? 0}
          onChange={(e) => setTg('costoEnvio', Number(e.target.value))}
          style={{ width: 140 }} /> <span style={{ color: 'var(--muted)' }}>pesos</span>

        <h2 className="h2" style={{ marginTop: 14 }}>5) Antes de imprimir</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={!!tg.confirmar} onChange={(e) => setTg('confirmar', e.target.checked)} />
          Pedir confirmación antes de imprimir (modo confirmación)
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
          Si está activado, el bot te muestra el pedido interpretado y espera que respondas <b>SÍ</b> para imprimir.
          También podés mandar un <b>cambio</b> (ej. "agregá una coca", "sacá la pizza", "cambiá la dirección a...")
          y lo actualiza antes de confirmar. Si está apagado, imprime al instante.
        </p>

        <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-accent" onClick={conectarTg}>🔌 Guardar y conectar bot</button>
          <button onClick={desconectarTg}>⏹ Detener bot</button>
          {tgEstado && (
            <span style={{ color: tgEstado.conectado ? 'var(--green)' : 'var(--muted)' }}>
              {tgEstado.conectado ? `● Conectado: @${tgEstado.bot}` : '○ Desconectado'}
              {tgEstado.error ? ` — ${tgEstado.error}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="h2">💾 Respaldo de datos (importante)</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          El sistema hace una copia de seguridad al arrancar y cada 6 horas. Para no perder nada si se rompe
          o se pierde esta PC, poné una <b>carpeta externa</b> (un pendrive siempre conectado, o una carpeta de
          Google Drive / OneDrive) y ahí se guarda una copia extra automáticamente.
        </p>
        <input type="text" value={backup.rutaExterna || ''} onChange={(e) => setBackup('rutaExterna', e.target.value)}
          placeholder="Ej: E:\respaldos   o   C:\Users\...\Google Drive\SedeSocial"
          style={{ width: '100%', fontFamily: 'monospace' }} />
        <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
          Dejalo vacío para guardar solo en esta PC. Si el pendrive no está conectado en ese momento, el respaldo
          local se hace igual y la copia externa se saltea sin dar error.
        </p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="h2">🕒 Aviso para cerrar caja</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Si pasan más de estas horas con ventas <b>sin cerrar la caja</b>, aparece un cartel recordándolo
          (para que cada turno quede cuadrado por separado). Poné <b>0</b> para no avisar.
        </p>
        <input type="number" min="0" step="1" value={cajaCfg.avisarHoras ?? 8}
          onChange={(e) => setCajaCfg('avisarHoras', Number(e.target.value))}
          style={{ width: 100 }} /> <span style={{ color: 'var(--muted)' }}>horas (ej. 8 = dos turnos por día)</span>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 className="h2">🧾 Facturación AFIP</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Conecta el sistema con el <b>facturador AFIP</b>. Al activarlo, en <b>Caja</b> aparece un botón
          <b> "Facturar"</b> sobre cada pedido que abre el facturador con el total ya cargado.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={!!fact.habilitado} onChange={(e) => setFact('habilitado', e.target.checked)} />
          Mostrar el botón "Facturar" en Caja
        </label>
        <div style={{ marginTop: 10 }}>
          <label style={{ color: 'var(--muted)', fontSize: 13, display: 'block', marginBottom: 4 }}>
            Dirección del facturador (si corre en esta misma PC, dejá <code>http://localhost:5000</code>):
          </label>
          <input type="text" value={fact.url || ''} onChange={(e) => setFact('url', e.target.value)}
            placeholder="http://localhost:5000" style={{ width: '100%', fontFamily: 'monospace' }} />
        </div>
      </div>

      <button className="btn-green" style={{ padding: 13 }} onClick={guardar}>💾 Guardar configuración</button>
    </div>
  );
}
