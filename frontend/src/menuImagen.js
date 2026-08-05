// Genera la imagen del "Menú del día" para historias de Instagram (1080x1920), estilo CDA Sede Social.
// Todo se dibuja en un <canvas> del navegador (sin servidor), así se puede descargar o compartir.
import { LOGO_CDA } from './logoCDA.js';

// Paletas de fondo que van variando (para que cada día se vea distinto). Marca: azul CDA.
const FONDOS = [
  { g1: '#0f172a', g2: '#1e3a8a', accent: '#7fb2ea' }, // azul marca
  { g1: '#0b1b2b', g2: '#0f766e', accent: '#5eead4' }, // teal
  { g1: '#1b1206', g2: '#7c2d12', accent: '#fdba74' }, // naranja cálido
  { g1: '#1e1b4b', g2: '#5b21b6', accent: '#c4b5fd' }, // violeta
  { g1: '#0f172a', g2: '#334155', accent: '#93c5fd' }, // gris azulado
  { g1: '#052e2b', g2: '#065f46', accent: '#6ee7b7' }, // verde
];
export const CANT_FONDOS = FONDOS.length;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function fechaLinda(fecha) {
  const [a, m, d] = (fecha || '').split('-').map(Number);
  if (!a || !m || !d) return '';
  const dow = new Date(a, m - 1, d).getDay();
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${cap(DIAS[dow])} ${d} de ${MESES[m - 1]}`;
}

let _logo = null;
function cargarLogo() {
  return new Promise((res) => {
    if (_logo) return res(_logo);
    const img = new Image();
    img.onload = () => { _logo = img; res(img); };
    img.onerror = () => res(null);
    img.src = LOGO_CDA;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Parte un texto en líneas que entren en maxWidth (según la fuente ya seteada en ctx)
function wrap(ctx, texto, maxWidth) {
  const palabras = (texto || '').split(/\s+/).filter(Boolean);
  const lineas = [];
  let linea = '';
  for (const p of palabras) {
    const prueba = linea ? linea + ' ' + p : p;
    if (ctx.measureText(prueba).width > maxWidth && linea) { lineas.push(linea); linea = p; }
    else linea = prueba;
  }
  if (linea) lineas.push(linea);
  return lineas;
}

// Dibuja la imagen en el canvas. menus = [{nombre}], fecha = 'YYYY-MM-DD', variante = índice de fondo.
export async function dibujarMenuHistoria(canvas, menus, fecha, variante = 0) {
  const W = 1080, H = 1920;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const f = FONDOS[((variante % CANT_FONDOS) + CANT_FONDOS) % CANT_FONDOS];

  // Fondo con gradiente diagonal
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, f.g1); g.addColorStop(1, f.g2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Blobs decorativos del color de acento (dan textura)
  ctx.save();
  ctx.globalAlpha = 0.16; ctx.fillStyle = f.accent;
  ctx.beginPath(); ctx.arc(W * 0.86, H * 0.10, 300, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W * 0.08, H * 0.92, 360, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // Viñeteado suave para que el texto resalte
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  // Logo CDA arriba-izquierda
  const logo = await cargarLogo();
  if (logo && logo.width) {
    const lw = 210, lh = lw * (logo.height / logo.width);
    ctx.drawImage(logo, 56, 60, lw, lh);
  }

  // Título "MENÚ del día"
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 156px Arial, "Arial Black", sans-serif';
  ctx.fillText('MENÚ', W / 2, 415);
  ctx.fillStyle = f.accent;
  ctx.font = 'italic 118px Georgia, "Times New Roman", serif';
  ctx.fillText('del día', W / 2, 540);
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  // Fecha
  const fl = fechaLinda(fecha);
  if (fl) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '42px Georgia, serif'; ctx.fillText(fl, W / 2, 610); }

  // ---- Tarjetas de menús ----
  const validos = (menus || []).filter((m) => (m.nombre || '').trim()).slice(0, 3);
  const margin = 70, cardW = W - margin * 2, pad = 52;
  const areaTop = 680, areaBottom = 1870;
  const labelFont = 'italic 700 54px Georgia, serif';
  const dishFont = '700 60px Georgia, "Times New Roman", serif';
  const lineH = 72;

  // Medir alturas de cada tarjeta según el texto
  const tarjetas = validos.map((m, i) => {
    ctx.font = dishFont;
    const lineas = wrap(ctx, m.nombre.trim(), cardW - pad * 2);
    const alto = pad + 62 /*label*/ + 24 + lineas.length * lineH + pad;
    return { i, lineas, alto };
  });
  const totalAlto = tarjetas.reduce((a, t) => a + t.alto, 0);
  const gap = tarjetas.length > 1 ? Math.min(48, (areaBottom - areaTop - totalAlto) / (tarjetas.length - 1)) : 0;
  let y = areaTop + Math.max(0, (areaBottom - areaTop - totalAlto - gap * (tarjetas.length - 1)) / 2);

  for (const t of tarjetas) {
    // sombra + tarjeta color crema
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    roundRect(ctx, margin, y, cardW, t.alto, 40);
    ctx.fillStyle = '#faf7f0'; ctx.fill();
    ctx.restore();

    // "Menú N:"
    ctx.textAlign = 'left';
    ctx.fillStyle = f.g2;
    ctx.font = labelFont;
    ctx.fillText(`Menú ${t.i + 1}:`, margin + pad, y + pad + 40);

    // Nombre del menú (centrado)
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1a2233';
    ctx.font = dishFont;
    let ty = y + pad + 62 + 24 + 52;
    for (const ln of t.lineas) { ctx.fillText(ln, W / 2, ty); ty += lineH; }

    y += t.alto + gap;
  }

  // Pie de marca
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '700 40px Georgia, serif';
  ctx.fillText('CDA · Sede Social', W / 2, 1905);
}
