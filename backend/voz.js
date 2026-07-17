// Transcribe una nota de voz a texto usando Whisper (Groq — gratis, sin tarjeta).
// Es un servicio de audio->texto (Claude no procesa audio). Solo se usa si hay clave configurada.
// El endpoint de Groq es compatible con el de OpenAI (mismo formato de request/respuesta),
// así que si algún día se quiere volver a OpenAI, solo cambia la URL y el modelo.

export async function transcribirAudio(audioBase64, mime, apiKey) {
  const key = (apiKey || '').replace(/[•\s]/g, ''); // limpiar espacios/puntitos por si quedaron pegados
  if (!key) throw new Error('Falta la clave de transcripción (voz)');
  const bytes = Buffer.from(audioBase64, 'base64');
  const form = new FormData();
  // Telegram manda las notas de voz en OGG/opus; Whisper lo acepta.
  form.append('file', new Blob([bytes], { type: mime || 'audio/ogg' }), 'audio.ogg');
  form.append('model', 'whisper-large-v3'); // Whisper large v3 en Groq (buena precisión en español)
  form.append('language', 'es');
  form.append('response_format', 'json');
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 30000);
  let r;
  try {
    r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key },
      body: form,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'La transcripción tardó demasiado' : 'Error de red al transcribir: ' + e.message);
  } finally {
    clearTimeout(to);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('Transcripción error ' + r.status + (t ? ': ' + t.slice(0, 120) : ''));
  }
  const d = await r.json();
  return (d.text || '').trim();
}
