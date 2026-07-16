// Conexión a WhatsApp (no oficial, vía Baileys). Se vincula escaneando un QR
// con un número dedicado a pedidos. Corre 100% local (no requiere URL pública).
// Los mensajes entrantes se entregan al callback onMensaje para guardarlos en la
// bandeja de entrada. El estado/QR se exponen para mostrarlos en la web.
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, 'auth_wa');

let sock = null;
let reintentos = 0;
let estado = { conectado: false, numero: null, qr: null, iniciando: false, error: null };
let onMensajeCb = null;
let emit = () => {};

export function getEstado() {
  return { conectado: estado.conectado, numero: estado.numero, qr: estado.qr, iniciando: estado.iniciando, error: estado.error };
}

export function setHandlers({ onMensaje, emitEstado }) {
  onMensajeCb = onMensaje;
  if (emitEstado) emit = emitEstado;
}

function textoDeMensaje(m) {
  const msg = m.message || {};
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.buttonsResponseMessage?.selectedDisplayText ||
    msg.listResponseMessage?.title ||
    ''
  );
}

export async function iniciar() {
  if (estado.iniciando) return getEstado();
  estado.iniciando = true;
  estado.error = null;
  emit(getEstado());
  try {
    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.makeWASocket || baileys.default;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;
    const pino = (await import('pino')).default;

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch { version = undefined; }

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers ? Browsers.appropriate('Sede Social POS') : ['Sede Social POS', 'Chrome', '1.0'],
      printQRInTerminal: false,
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        estado.qr = await QRCode.toDataURL(qr);
        estado.conectado = false;
        emit(getEstado());
      }
      if (connection === 'open') {
        estado.conectado = true;
        estado.qr = null;
        estado.iniciando = false;
        reintentos = 0;
        estado.numero = sock?.user?.id ? sock.user.id.split(':')[0] : null;
        emit(getEstado());
      }
      if (connection === 'close') {
        estado.conectado = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === (DisconnectReason?.loggedOut ?? 401);
        estado.iniciando = false;
        emit(getEstado());
        if (!loggedOut) {
          // Reconectar con backoff exponencial (3s, 6s, 12s... tope 60s)
          const espera = Math.min(60000, 3000 * 2 ** reintentos);
          reintentos++;
          setTimeout(() => iniciar().catch(() => {}), espera);
        } else {
          estado.error = 'Sesión cerrada. Volvé a escanear el QR.';
          estado.numero = null;
          emit(getEstado());
        }
      }
    });

    sock.ev.on('messages.upsert', async (ev) => {
      if (ev.type !== 'notify') return;
      for (const m of ev.messages) {
        try {
          if (!m.message || m.key.fromMe) continue;
          const jid = m.key.remoteJid || '';
          if (jid.endsWith('@g.us') || jid.includes('broadcast') || jid.includes('status')) continue;
          const texto = textoDeMensaje(m).trim();
          if (!texto) continue;
          const telefono = jid.split('@')[0];
          const nombre = m.pushName || telefono;
          onMensajeCb && onMensajeCb({ jid, telefono, nombre, texto });
        } catch (e) { /* ignorar mensaje problemático */ }
      }
    });

    return getEstado();
  } catch (e) {
    estado.iniciando = false;
    estado.error = e.message;
    emit(getEstado());
    console.error('WhatsApp init error:', e.message);
    return getEstado();
  }
}

export async function enviarMensaje(destino, texto) {
  if (!sock || !estado.conectado) return false;
  const jid = destino.includes('@') ? destino : destino.replace(/\D/g, '') + '@s.whatsapp.net';
  try { await sock.sendMessage(jid, { text: texto }); return true; } catch { return false; }
}

export async function desconectar() {
  try { if (sock) await sock.logout(); } catch {}
  estado = { conectado: false, numero: null, qr: null, iniciando: false, error: null };
  sock = null;
  emit(getEstado());
}
