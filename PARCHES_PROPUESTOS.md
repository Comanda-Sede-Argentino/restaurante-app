# Parches propuestos — Sistema Restaurante "Argentino Sede Social"

> Documento de revisión. **Nada está aplicado todavía.** Cada parche muestra el código actual
> y el propuesto. Revisalo, marcá cuáles querés y los aplico con confirmación.
> Generado en una sesión de solo lectura para no pisar la otra ventana.

Leyenda de severidad: 🔴 CRÍTICO · 🟠 IMPORTANTE · 🟡 MENOR

Resumen rápido (orden sugerido de aplicación):

| # | Sev | Archivo | Qué arregla |
|---|-----|---------|-------------|
| B1 | 🔴 | server.js + printer.js + App.jsx | Comanda perdida en silencio (impresora apagada/sin papel/respaldo falla) |
| B2 | 🔴 | server.js | Doble cobro de un pedido ya cobrado |
| B3 | 🟠 | printer.js + textprint.ps1 (nuevo) | Inyección de comando PowerShell en impresión modo "texto" |
| B4 | 🟠 | printer.js + server.js | Secretos (token Telegram + clave Claude) enmascarados en la API |
| B5 | 🟠 | whatsapp.js | Reconexión perpetua sin backoff (riesgo de baneo del número) |
| B6 | 🟠 | telegram.js | Loops solapados → pedidos duplicados |
| B7 | 🟠 | server.js | Rate-limit Telegram + sanitizar cantidades de la IA |
| B8 | 🟡 | ia.js | Timeout en la llamada a Claude |
| B9 | 🟡 | backup.js | Backup atómico (no dejar copia corrupta) |
| F1 | 🔴 | Mozo.jsx | Abrir mesa: reusar pedido + race de carga + manejo de error |
| F2 | 🔴 | OrderTaker.jsx | Doble envío a cocina sin aviso de error |
| F3 | 🟠 | KDS/Caja/Salon/Delivery/Dashboard | Refrescar datos al reconectar Socket.IO |
| F4 | 🟠 | Caja.jsx | Confirmación de cobro + validar recibido |
| F5 | 🟠 | Delivery.jsx | Elegir medio de pago + confirmar (hoy siempre EFECTIVO) |
| F6 | 🟠 | Delivery.jsx + WhatsApp.jsx | setHora con guardas y revertir si falla |
| F7 | 🟡 | OrderTaker.jsx | Persistir borrador del carrito (no perderlo al recargar) |
| F8 | 🟡 | Caja.jsx | Parsear "recibido" con formato argentino |
| F9 | 🟡 | OrderTaker.jsx | Botón "−" del plato: HTML válido / táctil |
| — | 🔵 | (decisión) | Autenticación por rol (no hay ninguna) — ver al final |

---

## BACKEND

### B1 🔴 Comanda perdida en silencio

**Problema:** si la COMANDERA está apagada, sin papel, o falla el respaldo en disco, la comanda no se imprime y **nadie se entera**: el mozo cree que la mandó. Hoy el resultado `ok:false` se ignora y la escritura del respaldo puede tirar toda la impresión.

**B1.a — `printer.js:268` — que el respaldo nunca bloquee la impresión**

Actual:
```js
  const archivo = path.join(OUT_DIR, `${prefijo}_pedido${pedido.id}_${Date.now()}.txt`);
  fs.writeFileSync(archivo, texto, 'latin1');
```
Propuesto:
```js
  const archivo = path.join(OUT_DIR, `${prefijo}_pedido${pedido.id}_${Date.now()}.txt`);
  try { fs.writeFileSync(archivo, texto, 'latin1'); }
  catch (e) { console.error('No se pudo guardar respaldo de comanda:', e.message); }
```

**B1.b — `server.js:233-235` — avisar a las pantallas cuando la impresión falla**

Actual:
```js
  imprimirComandaUnica(p, nuevos)
    .then((r) => io.emit('impresion', { pedido_id: pedidoId, resultado: r }))
    .catch((e) => console.error('Error impresión:', e.message));
```
Propuesto:
```js
  imprimirComandaUnica(p, nuevos)
    .then((r) => {
      io.emit('impresion', { pedido_id: pedidoId, resultado: r });
      if (!r || r.ok === false)
        io.emit('impresion:error', { pedido_id: pedidoId, resultado: r });
    })
    .catch((e) => {
      console.error('Error impresión:', e.message);
      io.emit('impresion:error', { pedido_id: pedidoId, error: e.message });
    });
```

**B1.c — `server.js:458` (Telegram) — mismo aviso**

Actual:
```js
    imprimirComandaUnica(p, p.items).catch((e) => console.error('Error impresión Telegram:', e.message));
```
Propuesto:
```js
    imprimirComandaUnica(p, p.items)
      .then((r) => { if (!r || r.ok === false) io.emit('impresion:error', { pedido_id: pedidoId, resultado: r }); })
      .catch((e) => { console.error('Error impresión Telegram:', e.message); io.emit('impresion:error', { pedido_id: pedidoId, error: e.message }); });
```

**B1.d — `App.jsx` — escuchar el aviso globalmente y mostrar alerta visible**

Dentro del `useEffect` de `App.jsx` (líneas 17-23), agregar el listener:
```js
    const onImpError = (d) =>
      alert('⚠ La comanda del pedido #' + (d.pedido_id ?? '?') +
            ' NO se imprimió. Revisá la COMANDERA (encendida, con papel) y reimprimí desde Cocina.');
    socket.on('impresion:error', onImpError);
```
y en el `return` de limpieza agregar `socket.off('impresion:error', onImpError);`.

---

### B2 🔴 Doble cobro de un pedido

**Problema:** `POST /pedidos/:id/pagar` no verifica que el pedido no esté ya cobrado. Dos clics (o dos cajeros) registran dos pagos del mismo pedido.

**`server.js:299-309`** — agregar guarda al inicio de la transacción.

Actual:
```js
app.post('/api/pedidos/:id/pagar', (req, res) => {
  const pedidoId = req.params.id;
  const pagos = req.body.pagos || [{ medio: 'EFECTIVO', importe: req.body.total }];
  const insPago = db.prepare('INSERT INTO pago (pedido_id, medio, importe) VALUES (?,?,?)');
  const tx = db.transaction(() => {
```
Propuesto:
```js
app.post('/api/pedidos/:id/pagar', (req, res) => {
  const pedidoId = req.params.id;
  const actual = db.prepare('SELECT estado FROM pedido WHERE id=?').get(pedidoId);
  if (!actual) return res.status(404).json({ error: 'No existe' });
  if (actual.estado === 'cobrado') return res.status(409).json({ error: 'El pedido ya fue cobrado' });
  const pagos = req.body.pagos || [{ medio: 'EFECTIVO', importe: req.body.total }];
  const insPago = db.prepare('INSERT INTO pago (pedido_id, medio, importe) VALUES (?,?,?)');
  const tx = db.transaction(() => {
```

---

### B3 🟠 Inyección de comando PowerShell (impresión modo "texto")

**Problema:** `imprimirTextoGDI` arma un string y lo pasa a `powershell -Command`. El nombre de impresora viene de `config.json` (editable por la API sin auth). Mejor usar un `.ps1` con parámetros, igual que `rawprint.ps1`.

**B3.a — crear `backend/textprint.ps1` (archivo nuevo):**
```powershell
param([Parameter(Mandatory=$true)][string]$Printer, [Parameter(Mandatory=$true)][string]$File)
# Imprime un archivo de texto a una impresora de Windows por nombre (driver GDI / Out-Printer).
try {
  if ($Printer) { Get-Content -LiteralPath $File -Encoding Default | Out-Printer -Name $Printer }
  else { Get-Content -LiteralPath $File -Encoding Default | Out-Printer }
  exit 0
} catch { exit 1 }
```

**B3.b — `printer.js:200-211` — usar el .ps1 con `-File`:**

Actual:
```js
function imprimirTextoGDI(texto, impresora) {
  return new Promise((resolve) => {
    const tmp = path.join(OUT_DIR, `_tmp_${Date.now()}_${Math.floor(Math.random() * 1e6)}.txt`);
    fs.writeFileSync(tmp, texto, 'latin1');
    const cmd = impresora
      ? `Get-Content -LiteralPath '${tmp}' -Encoding Default | Out-Printer -Name '${impresora.replace(/'/g, "''")}'`
      : `Get-Content -LiteralPath '${tmp}' -Encoding Default | Out-Printer`;
    const ps = spawn('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true });
    ps.on('close', (code) => { fs.unlink(tmp, () => {}); resolve(code === 0); });
    ps.on('error', () => resolve(false));
  });
}
```
Propuesto:
```js
function imprimirTextoGDI(texto, impresora) {
  return new Promise((resolve) => {
    const tmp = path.join(OUT_DIR, `_tmp_${Date.now()}_${Math.floor(Math.random() * 1e6)}.txt`);
    fs.writeFileSync(tmp, texto, 'latin1');
    const ps1 = path.join(__dirname, 'textprint.ps1');
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-File', tmp];
    if (impresora) { args.splice(6, 0, '-Printer', impresora); }
    const ps = spawn('powershell', args, { windowsHide: true });
    ps.on('close', (code) => { fs.unlink(tmp, () => {}); resolve(code === 0); });
    ps.on('error', () => resolve(false));
  });
}
```
> Nota: el parámetro `-File` del script (la ruta del .txt) y `-File` de PowerShell coinciden de nombre pero
> no chocan porque el primero es de `powershell.exe` y el `-Printer/-File` posteriores van al script. Si
> preferís evitar la ambigüedad, renombro el parámetro del script a `-Texto`. Decime.

---

### B4 🟠 Secretos enmascarados en la API

**Problema:** `GET /api/config` devuelve el token de Telegram y la clave de Claude en claro. Cualquiera en la red los lee. Hay que enmascararlos al salir y no pisarlos al guardar si vuelven enmascarados.

**B4.a — `printer.js`** — agregar after `setConfig` (o donde prefieras) una versión pública y proteger el merge:

Actual `setConfig` (líneas 64-71):
```js
export function setConfig(nuevo) {
  const c = getConfig();
  c.impresion = { ...c.impresion, ...(nuevo.impresion || {}) };
  c.whatsapp = { ...c.whatsapp, ...(nuevo.whatsapp || {}) };
  c.telegram = { ...c.telegram, ...(nuevo.telegram || {}) };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
  return c;
}
```
Propuesto:
```js
const MASK = '••••••••';

export function setConfig(nuevo) {
  const c = getConfig();
  c.impresion = { ...c.impresion, ...(nuevo.impresion || {}) };
  c.whatsapp = { ...c.whatsapp, ...(nuevo.whatsapp || {}) };
  const tg = { ...c.telegram, ...(nuevo.telegram || {}) };
  // No sobreescribir los secretos si llegan enmascarados desde el frontend
  if (tg.token === MASK) tg.token = c.telegram.token;
  if (tg.claveIA === MASK) tg.claveIA = c.telegram.claveIA;
  c.telegram = tg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
  return getConfigPublic();
}

// Igual que getConfig pero con los secretos enmascarados (para el frontend)
export function getConfigPublic() {
  const c = getConfig();
  return {
    ...c,
    telegram: {
      ...c.telegram,
      token: c.telegram.token ? MASK : '',
      claveIA: c.telegram.claveIA ? MASK : '',
    },
  };
}
```

**B4.b — `server.js:242`** — devolver la versión pública:

Primero agregar `getConfigPublic` al import (línea 8-10):
```js
import {
  imprimirComandaUnica, imprimirCuenta, listarImpresoras, listarPuertosCom, getConfig, getConfigPublic, setConfig,
} from './printer.js';
```
Luego, `server.js:242`:
```js
app.get('/api/config', (req, res) => res.json(getConfig()));
```
→
```js
app.get('/api/config', (req, res) => res.json(getConfigPublic()));
```
> El resto del backend (arranque de WhatsApp/Telegram, `parsearPedidoIA`) sigue usando `getConfig()`
> con los secretos reales. El frontend de Ajustes ya muestra los campos como editables; al ver
> `••••••••` el usuario sabe que ya hay una clave cargada y, si no la toca, no se pierde.

---

### B5 🟠 WhatsApp: reconexión con backoff

**Problema:** `whatsapp.js:85-87` reintenta cada 3 s para siempre. Con WiFi inestable: reconexiones infinitas y riesgo de baneo del número.

**B5.a — agregar contador (cerca de la línea 12-13):**
```js
let reintentos = 0;
```

**B5.b — `whatsapp.js:72-78` — resetear al conectar:**

Actual:
```js
      if (connection === 'open') {
        estado.conectado = true;
        estado.qr = null;
        estado.iniciando = false;
        estado.numero = sock?.user?.id ? sock.user.id.split(':')[0] : null;
        emit(getEstado());
      }
```
Propuesto (agregar `reintentos = 0;`):
```js
      if (connection === 'open') {
        estado.conectado = true;
        estado.qr = null;
        estado.iniciando = false;
        reintentos = 0;
        estado.numero = sock?.user?.id ? sock.user.id.split(':')[0] : null;
        emit(getEstado());
      }
```

**B5.c — `whatsapp.js:85-87` — backoff exponencial con tope 60 s:**

Actual:
```js
        if (!loggedOut) {
          // Reconectar automáticamente
          setTimeout(() => iniciar().catch(() => {}), 3000);
        } else {
```
Propuesto:
```js
        if (!loggedOut) {
          // Reconectar con backoff exponencial (3s, 6s, 12s... tope 60s)
          const espera = Math.min(60000, 3000 * 2 ** reintentos);
          reintentos++;
          setTimeout(() => iniciar().catch(() => {}), espera);
        } else {
```

---

### B6 🟠 Telegram: evitar loops solapados (pedidos duplicados)

**Problema:** al reiniciar/cambiar token puede quedar más de un `loop` haciendo `getUpdates` → updates procesados dos veces → comandas duplicadas. Se resuelve con un contador de generación.

**B6.a — `telegram.js:8-9` — agregar generación:**
```js
let offset = 0;
let tokenActual = '';
let generacion = 0;
```

**B6.b — `telegram.js:31-35` y `:61-62` — marcar generación al iniciar:**

Actual (31-35):
```js
export async function iniciar(token) {
  if (corriendo && token === tokenActual) return getEstado();
  // Reiniciar si cambió el token
  corriendo = false;
  await new Promise((r) => setTimeout(r, 200));
```
Propuesto:
```js
export async function iniciar(token) {
  if (corriendo && token === tokenActual) return getEstado();
  // Reiniciar si cambió el token: invalidar el loop anterior
  corriendo = false;
  const miGen = ++generacion;
  await new Promise((r) => setTimeout(r, 200));
```
Actual (61-62):
```js
  corriendo = true;
  loop(token);
```
Propuesto:
```js
  corriendo = true;
  loop(token, miGen);
```

**B6.c — `telegram.js:66-67` — que el loop verifique su generación:**

Actual:
```js
async function loop(token) {
  while (corriendo && token === tokenActual) {
```
Propuesto:
```js
async function loop(token, miGen) {
  while (corriendo && token === tokenActual && miGen === generacion) {
```

---

### B7 🟠 Rate-limit Telegram + sanitizar cantidades de la IA

**Problema:** sin límite, un chat autorizado puede disparar muchas llamadas pagas a Claude; y la IA podría devolver cantidades absurdas (0, negativas, enormes) que van directo a la comanda y el total.

**B7.a — `server.js`** — agregar cerca del bloque Telegram (antes de `tg.setHandlers`, ~línea 412) un limitador y un sanitizador:
```js
const ultimoPedidoTg = new Map(); // chatId -> timestamp del último pedido
const clampCant = (n) => Math.max(1, Math.min(50, Math.round(Number(n) || 1)));
```

**B7.b — `server.js:421` — chequear rate-limit tras autorizar:**

Actual (417-421):
```js
    if (!autorizados.includes(String(chatId))) {
      tg.enviar(chatId, `🔒 No estás autorizado para enviar pedidos.\nTu ID de Telegram es: ${chatId}\nPedile al administrador que lo agregue en Ajustes → Telegram.`);
      return;
    }
    tg.enviar(chatId, '🤖 Recibido, interpretando el pedido...');
```
Propuesto:
```js
    if (!autorizados.includes(String(chatId))) {
      tg.enviar(chatId, `🔒 No estás autorizado para enviar pedidos.\nTu ID de Telegram es: ${chatId}\nPedile al administrador que lo agregue en Ajustes → Telegram.`);
      return;
    }
    const ahoraTg = Date.now();
    if (ahoraTg - (ultimoPedidoTg.get(String(chatId)) || 0) < 8000) {
      tg.enviar(chatId, '⏳ Esperá unos segundos antes de mandar otro pedido.');
      return;
    }
    ultimoPedidoTg.set(String(chatId), ahoraTg);
    tg.enviar(chatId, '🤖 Recibido, interpretando el pedido...');
```

**B7.c — `server.js:436` — sanitizar la cantidad:**

Actual:
```js
      return {
        plato_id: plato.id, nombre: plato.nombre, cantidad: it.cantidad || 1,
        precio_unit: plato.precio, observacion: it.observacion || null,
        sector_id: plato.sector_id, sector_nombre: plato.sector,
      };
```
Propuesto:
```js
      return {
        plato_id: plato.id, nombre: plato.nombre, cantidad: clampCant(it.cantidad),
        precio_unit: plato.precio, observacion: it.observacion || null,
        sector_id: plato.sector_id, sector_nombre: plato.sector,
      };
```

---

### B8 🟡 Timeout en la llamada a Claude

**Problema:** `ia.js` no tiene timeout; si la red de la sede se corta a mitad, el pedido de Telegram queda colgado en "interpretando...".

**`ia.js:52-64`**

Actual:
```js
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('IA error ' + r.status + ': ' + t.slice(0, 200));
  }
```
Propuesto:
```js
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'La IA tardó demasiado en responder' : 'Error de red al consultar la IA: ' + e.message);
  } finally {
    clearTimeout(to);
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error('IA error ' + r.status + ': ' + t.slice(0, 200));
  }
```

---

### B9 🟡 Backup atómico

**Problema:** si `db.backup` falla a mitad (disco lleno) puede dejar un `.db` parcial que cuenta como copia válida y desplaza una buena.

**`backup.js:19-21`**

Actual:
```js
export async function hacerBackup() {
  const dest = path.join(DIR, `restaurante-${sello()}.db`);
  await db.backup(dest); // backup online seguro (no corta el uso)
```
Propuesto:
```js
export async function hacerBackup() {
  const dest = path.join(DIR, `restaurante-${sello()}.db`);
  const tmp = dest + '.tmp';
  await db.backup(tmp); // backup online seguro (no corta el uso)
  fs.renameSync(tmp, dest); // publicar solo si terminó OK
```
> Conviene además excluir `*.tmp` del listado (línea 24-25 ya filtra por `.db`, así que el `.tmp` no entra; ok).

---

## FRONTEND

### F1 🔴 Mozo: abrir mesa correctamente

**Problema:** `abrirMesa` corre antes de que `mesas` cargue (pierde nº de mesa), siempre llama a crear (el backend deduplica, pero conviene reusar) y no maneja errores.

**`Mozo.jsx:20-29`**

Actual:
```js
  useEffect(() => {
    if (mesaId) abrirMesa(Number(mesaId));
  }, [mesaId]);

  const abrirMesa = async (id) => {
    const m = mesas.find((x) => x.id === id) || { id };
    const p = await api.crearPedido({ tipo: 'salon', mesa_id: id, mozo_nombre: mozo || 'Mozo' });
    const full = await api.pedido(p.id);
    setPedido(full);
  };
```
Propuesto:
```js
  useEffect(() => {
    if (mesaId && mesas.length) abrirMesa(Number(mesaId));
  }, [mesaId, mesas.length]);

  const abrirMesa = async (id) => {
    const m = mesas.find((x) => x.id === id);
    try {
      let p;
      if (m?.pedido) {
        p = await api.pedido(m.pedido.id);            // reusar el pedido abierto de la mesa
      } else {
        const nuevo = await api.crearPedido({ tipo: 'salon', mesa_id: id, mozo_nombre: mozo || 'Mozo' });
        p = await api.pedido(nuevo.id);
      }
      setPedido(p);
    } catch (e) {
      alert('No se pudo abrir la mesa: ' + e.message);
    }
  };
```

---

### F2 🔴 OrderTaker: doble envío sin aviso

**Problema:** si `agregarItems` falla, no hay `catch`: el carrito no se limpia ni se avisa, el mozo vuelve a tocar "Enviar" y duplica.

**`OrderTaker.jsx:53-62`**

Actual:
```js
  const enviar = async () => {
    if (!cart.length) return;
    setEnviando(true);
    try {
      const items = cart.map((x) => ({ ...x, observacion: obsItem[x.plato_id] || null }));
      await api.agregarItems(pedido.id, items);
      setCart([]); setObsItem({}); setCartOpen(false);
      onEnviado && onEnviado();
    } finally { setEnviando(false); }
  };
```
Propuesto:
```js
  const enviar = async () => {
    if (!cart.length || enviando) return;
    setEnviando(true);
    try {
      const items = cart.map((x) => ({ ...x, observacion: obsItem[x.plato_id] || null }));
      await api.agregarItems(pedido.id, items);
      setCart([]); setObsItem({}); setCartOpen(false);
      onEnviado && onEnviado();
    } catch (e) {
      alert('⚠ No se pudo enviar la comanda. Revisá la conexión y volvé a intentar.\n(El pedido NO se envió, no se duplicó nada.)\n\n' + e.message);
    } finally { setEnviando(false); }
  };
```

---

### F3 🟠 Refrescar al reconectar Socket.IO

**Problema:** si una pantalla pierde el socket y se reconecta, se pierde lo emitido durante el corte. Hay que recargar en el evento `connect`. Se aplica el mismo patrón en 5 pantallas: agregar el listener `connect` y su `off`.

**KDS.jsx:26-37** — actual:
```js
    const reload = () => cargar();
    socket.on('item:nuevo', reload);
    socket.on('item:estado', reload);
    socket.on('pedido:cobrado', reload);
    const tick = setInterval(() => force((x) => x + 1), 30000); // refrescar cronómetros
    return () => {
      socket.off('item:nuevo', reload);
      socket.off('item:estado', reload);
      socket.off('pedido:cobrado', reload);
      clearInterval(tick);
    };
```
Propuesto: agregar `socket.on('connect', reload);` debajo de los otros `on`, y `socket.off('connect', reload);` en el cleanup.

**Caja.jsx:15-23**, **Salon.jsx:12-20**, **Delivery.jsx:15-23** — mismo cambio: agregar `socket.on('connect', reload);` y su `off`.

**Dashboard.jsx:8-12** — actual:
```js
    api.dashboard().then(setD);
    const on = (data) => setD(data);
    socket.on('dashboard:update', on);
    const tick = setInterval(() => api.dashboard().then(setD), 15000);
    return () => { socket.off('dashboard:update', on); clearInterval(tick); };
```
Propuesto:
```js
    api.dashboard().then(setD);
    const on = (data) => setD(data);
    const reload = () => api.dashboard().then(setD);
    socket.on('dashboard:update', on);
    socket.on('connect', reload);
    const tick = setInterval(reload, 15000);
    return () => { socket.off('dashboard:update', on); socket.off('connect', reload); clearInterval(tick); };
```

---

### F4 🟠 Caja: confirmar cobro + validar recibido

**Problema:** cobra con un clic, sin confirmar y sin chequear que el efectivo cubra el total.

**`Caja.jsx:26-29`**

Actual:
```js
  const cobrar = async () => {
    await api.pagar(sel.id, [{ medio, importe: sel.total }]);
    setSel(null); setRecibido(''); cargar();
  };
```
Propuesto:
```js
  const cobrar = async () => {
    if (!sel) return;
    if (medio === 'EFECTIVO' && recibido && Number(recibido.replace(/\./g, '').replace(',', '.')) < sel.total) {
      if (!window.confirm('Lo recibido es MENOR al total. ¿Cobrar igual?')) return;
    }
    if (!window.confirm(`Confirmar cobro de ${money(sel.total)} en ${medio}?`)) return;
    try {
      await api.pagar(sel.id, [{ medio, importe: sel.total }]);
      setSel(null); setRecibido(''); cargar();
    } catch (e) {
      alert(e.message.includes('409') ? 'Ese pedido ya fue cobrado.' : 'No se pudo cobrar: ' + e.message);
      cargar();
    }
  };
```

---

### F5 🟠 Delivery: elegir medio de pago + confirmar

**Problema:** `cobrar` siempre registra EFECTIVO y sin confirmación; un toque accidental cierra el pedido.

**F5.a — `Delivery.jsx:6-8`** — agregar estado y constante de medios:

Actual:
```js
export default function Delivery() {
  const [pedido, setPedido] = useState(null);
  const [cli, setCli] = useState({ cliente_nombre: '', cliente_telefono: '', cliente_direccion: '', hora_entrega: '' });
  const [activos, setActivos] = useState([]);
```
Propuesto (agregar línea de medios arriba del componente y un estado):
```js
const MEDIOS = ['EFECTIVO', 'TARJETA DÉBITO', 'TARJETA CRÉDITO', 'QR / TRANSFERENCIA'];

export default function Delivery() {
  const [pedido, setPedido] = useState(null);
  const [cli, setCli] = useState({ cliente_nombre: '', cliente_telefono: '', cliente_direccion: '', hora_entrega: '' });
  const [activos, setActivos] = useState([]);
  const [medio, setMedio] = useState('EFECTIVO');
```

**F5.b — `Delivery.jsx:39-45`** — usar el medio elegido + confirmar:

Actual:
```js
  const cobrar = async () => {
    const p = await api.pedido(pedido.id);
    await api.pagar(p.id, [{ medio: 'EFECTIVO', importe: p.total }]);
    setPedido(null);
    setCli({ cliente_nombre: '', cliente_telefono: '', cliente_direccion: '' });
    cargarActivos();
  };
```
Propuesto:
```js
  const cobrar = async () => {
    const p = await api.pedido(pedido.id);
    if (!window.confirm(`Cobrar ${money(p.total)} en ${medio}?`)) return;
    try {
      await api.pagar(p.id, [{ medio, importe: p.total }]);
      setPedido(null);
      setCli({ cliente_nombre: '', cliente_telefono: '', cliente_direccion: '', hora_entrega: '' });
      cargarActivos();
    } catch (e) {
      alert(e.message.includes('409') ? 'Ese pedido ya fue cobrado.' : 'No se pudo cobrar: ' + e.message);
      cargarActivos();
    }
  };
```

**F5.c — `Delivery.jsx:54`** — agregar selector de medio junto al botón Cobrar:

Actual:
```js
          {pedido.total > 0 && <button className="btn-green" onClick={cobrar}>💵 Cobrar {money(pedido.total)}</button>}
```
Propuesto:
```js
          {pedido.total > 0 && (
            <>
              <select value={medio} onChange={(e) => setMedio(e.target.value)}>
                {MEDIOS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <button className="btn-green" onClick={cobrar}>💵 Cobrar {money(pedido.total)}</button>
            </>
          )}
```

---

### F6 🟠 setHora con guardas y revertir si falla

**Problema:** `setHora` usa `pedido.id` sin chequear null y no revierte la actualización optimista si la API falla. Aplica a Delivery y WhatsApp.

**`Delivery.jsx:34-37`** y **`WhatsApp.jsx:38-41`** (mismo código), actual:
```js
  const setHora = async (hora) => {
    setPedido((p) => ({ ...p, hora_entrega: hora }));
    await api.actualizarPedido(pedido.id, { hora_entrega: hora });
  };
```
Propuesto:
```js
  const setHora = async (hora) => {
    if (!pedido) return;
    const prev = pedido.hora_entrega;
    setPedido((p) => ({ ...p, hora_entrega: hora }));
    try {
      await api.actualizarPedido(pedido.id, { hora_entrega: hora });
    } catch {
      setPedido((p) => ({ ...p, hora_entrega: prev }));
      alert('No se pudo guardar la hora de entrega.');
    }
  };
```

---

### F7 🟡 OrderTaker: persistir el borrador del carrito

**Problema:** el carrito vive solo en estado React; si la tablet recarga antes de "Enviar", se pierde todo lo cargado.

**`OrderTaker.jsx:12-19`** — guardar/restaurar por `pedido.id` en `localStorage`.

Actual:
```js
  const [cart, setCart] = useState([]);
  const [obsItem, setObsItem] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    api.platos({}).then(setTodos);
  }, []);
```
Propuesto:
```js
  const draftKey = pedido?.id ? 'cart_draft_' + pedido.id : null;
  const [cart, setCart] = useState(() => {
    try { return draftKey ? JSON.parse(localStorage.getItem(draftKey)) || [] : []; } catch { return []; }
  });
  const [obsItem, setObsItem] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    api.platos({}).then(setTodos);
  }, []);

  // Guardar el borrador del carrito por pedido (sobrevive a recargas de la tablet)
  useEffect(() => {
    if (!draftKey) return;
    if (cart.length) localStorage.setItem(draftKey, JSON.stringify(cart));
    else localStorage.removeItem(draftKey);
  }, [cart, draftKey]);
```
> Y en `enviar` (F2), después de `setCart([])`, agregar `if (draftKey) localStorage.removeItem(draftKey);` para limpiar al confirmar.

---

### F8 🟡 Caja: parsear "recibido" con formato argentino

**Problema:** `Number("1.000,50")` da `NaN`. Si el cajero tipea con separadores locales, el vuelto sale mal. (El cálculo de `vuelto` está en `Caja.jsx:30`.)

Actual:
```js
  const vuelto = medio === 'EFECTIVO' && recibido ? Number(recibido) - (sel?.total || 0) : null;
```
Propuesto:
```js
  const numAR = (s) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
  const vuelto = medio === 'EFECTIVO' && recibido ? numAR(recibido) - (sel?.total || 0) : null;
```
> (Si se aplica esto, usar `numAR(recibido)` también en la validación de F4 para que sea consistente.)

---

### F9 🟡 OrderTaker: botón "−" del plato

**Problema:** `OrderTaker.jsx:80-85` mete un `<span onClick>` dentro de un `<button>` (HTML inválido) y el blanco táctil es chico.

Actual:
```js
                {qty > 0 && (
                  <span
                    className="plato-minus"
                    onClick={(e) => { e.stopPropagation(); dec(p.id); }}
                  >−</span>
                )}
```
Propuesto (cambiar el `<button>` exterior por `<div role="button">` para que sea HTML válido — requiere ajustar la línea 78). Como es un cambio un poco más invasivo de markup/estilos, lo dejo señalado pero **lo aplico solo si lo confirmás**, para no tocar el CSS de `.plato-btn`. Alternativa mínima sin tocar markup: mover el `−` a una esquina con `pointer-events` propio. Decime si querés que lo encare.

---

## DECISIÓN PENDIENTE (no es un parche directo)

### 🔵 Autenticación / roles
Hoy **ningún endpoint pide autenticación**: cualquiera en la red local (o con el link del celular) puede cobrar, anular pedidos, leer `/api/config` o cambiar la configuración. Para un local con WiFi cerrado puede ser aceptable, pero es un riesgo real (un cliente conectado al WiFi podría tocar la caja).

Opciones, de menor a mayor esfuerzo:
1. **PIN simple** para las pantallas sensibles (Caja, Ajustes, Catálogo) guardado en `localStorage`.
2. **Login por usuario** (ya existe la tabla `usuario` con campo `pin`) y middleware que valide rol en el backend.
3. Dejarlo como está y **cerrar la red** (WiFi separado solo para el sistema).

No escribo el parche hasta que elijas el enfoque, porque cambia bastante código.

---

## Notas
- La integración con Claude en `ia.js` está **correcta** (modelo `claude-haiku-4-5` vigente, `tool_use` forzado, headers OK). No requiere cambios salvo el timeout (B8).
- Mejoras opcionales no incluidas como parche: cache de prompt del menú en la IA (solo vale si el menú supera ~2k tokens), `key` por id en tablas del Dashboard (cosmético), normalizar timestamps de KDS a epoch (hoy funciona porque cliente y server están en la misma máquina/zona).
