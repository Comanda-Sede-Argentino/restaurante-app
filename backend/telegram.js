// Bot de Telegram (oficial). El sistema "sale" a buscar los mensajes con long-polling
// (getUpdates) — conexión saliente, no expone la PC a internet.
// Los mensajes de usuarios autorizados se entregan al callback onMensaje.

let estado = { conectado: false, bot: null, error: null, iniciando: false };
let onMensaje = null;
let onCallback = null;
let corriendo = false;
let offset = 0;
let tokenActual = '';
let generacion = 0;

async function tg(token, metodo, params) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  return r.json();
}

// Descarga un archivo de Telegram (foto/audio) y devuelve un Buffer (o null si falla)
async function descargarArchivo(token, fileId) {
  try {
    const info = await tg(token, 'getFile', { file_id: fileId });
    if (!info || !info.ok || !info.result || !info.result.file_path) return null;
    const r = await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

export function getEstado() {
  return { conectado: estado.conectado, bot: estado.bot, error: estado.error, iniciando: estado.iniciando };
}

export function setHandlers({ onMensaje: f, onCallback: g }) { onMensaje = f; if (g) onCallback = g; }

// Envía un mensaje. reply_markup opcional para botones (inline_keyboard).
export async function enviar(chatId, texto, reply_markup) {
  if (!tokenActual) return false;
  try {
    const params = { chat_id: chatId, text: texto };
    if (reply_markup) params.reply_markup = reply_markup;
    await tg(tokenActual, 'sendMessage', params);
    return true;
  } catch { return false; }
}

// Muestra el indicador "escribiendo..." en el chat (fluido, sin mandar un mensaje de más)
export async function enviarAccion(chatId, accion = 'typing') {
  if (!tokenActual) return;
  try { await tg(tokenActual, 'sendChatAction', { chat_id: chatId, action: accion }); } catch { /* ignorar */ }
}

// Edita el texto de un mensaje ya enviado (para sacar los botones o refrescar el pedido)
export async function editar(chatId, messageId, texto, reply_markup) {
  if (!tokenActual || !messageId) return false;
  try {
    const params = { chat_id: chatId, message_id: messageId, text: texto };
    if (reply_markup) params.reply_markup = reply_markup;
    await tg(tokenActual, 'editMessageText', params);
    return true;
  } catch { return false; }
}

export async function iniciar(token) {
  if (corriendo && token === tokenActual) return getEstado();
  // Reiniciar si cambió el token: invalidar el loop anterior
  corriendo = false;
  const miGen = ++generacion;
  await new Promise((r) => setTimeout(r, 200));
  estado = { conectado: false, bot: null, error: null, iniciando: true };
  if (!token) { estado.iniciando = false; estado.error = 'Falta el token del bot'; return getEstado(); }
  tokenActual = token;
  // Verificar el token con getMe, reintentando ante baches transitorios de Telegram (5xx).
  let me = null;
  for (let intento = 0; intento < 3; intento++) {
    try {
      me = await tg(token, 'getMe');
      if (me && me.ok) break;
      // 401 = token realmente inválido. Otros códigos (5xx) = bache temporal: reintentar.
      if (me && me.error_code === 401) {
        estado = { conectado: false, bot: null, error: 'Token inválido', iniciando: false };
        return getEstado();
      }
    } catch (e) {
      me = { ok: false, _err: e.message };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!me || !me.ok) {
    // No pudimos confirmar (Telegram caído/lento). Arrancamos igual: el loop reintenta solo.
    estado = { conectado: true, bot: null, error: 'Conectando (Telegram demorado)...', iniciando: false };
  } else {
    estado = { conectado: true, bot: me.result.username, error: null, iniciando: false };
  }
  corriendo = true;
  loop(token, miGen);
  return getEstado();
}

async function loop(token, miGen) {
  while (corriendo && token === tokenActual && miGen === generacion) {
    try {
      const res = await tg(token, 'getUpdates', { offset, timeout: 30 });
      if (res && res.ok) {
        // Telegram respondió bien: confirmar estado y, si falta, completar el username.
        if (estado.error || !estado.bot) {
          estado.error = null;
          if (!estado.bot) { try { const me = await tg(token, 'getMe'); if (me?.ok) estado.bot = me.result.username; } catch { /* ignorar */ } }
        }
        for (const u of res.result) {
          offset = u.update_id + 1;
          const m = u.message;
          if (m && (m.text || m.photo || m.voice || m.audio)) {
            const chatId = m.chat.id;
            const nombre = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.chat?.title || '';
            let imagen = null, audio = null;
            const texto = m.text || m.caption || '';
            try {
              if (m.photo && m.photo.length) { // foto: bajamos la más grande
                const buf = await descargarArchivo(token, m.photo[m.photo.length - 1].file_id);
                if (buf) imagen = { base64: buf.toString('base64'), mediaType: 'image/jpeg' };
              } else if (m.voice || m.audio) { // nota de voz o audio
                const media = m.voice || m.audio;
                const buf = await descargarArchivo(token, media.file_id);
                if (buf) audio = { base64: buf.toString('base64'), mime: media.mime_type || 'audio/ogg' };
              }
            } catch { /* ignorar */ }
            try { onMensaje && onMensaje({ chatId, nombre, texto, imagen, audio }); } catch { /* ignorar */ }
          } else if (u.callback_query) {
            // El usuario tocó un botón (Confirmar / Cambiar / Cancelar)
            const cq = u.callback_query;
            const chatId = cq.message?.chat?.id;
            const nombre = [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(' ') || '';
            try { await tg(token, 'answerCallbackQuery', { callback_query_id: cq.id }); } catch { /* ignorar */ }
            try { onCallback && onCallback({ chatId, nombre, data: cq.data, messageId: cq.message?.message_id }); } catch { /* ignorar */ }
          }
        }
      }
    } catch (e) {
      estado.error = e.message;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export function detener() { corriendo = false; estado.conectado = false; }
