// Transcribe una nota de voz a texto usando Whisper (OpenAI).
// Es un servicio de audio->texto (Claude no procesa audio). Solo se usa si hay clave configurada.

export async function transcribirAudio(audioBase64, mime, apiKey) {
  if (!apiKey) throw new Error('Falta la clave de transcripción (voz)');
  const bytes = Buffer.from(audioBase64, 'base64');
  const form = new FormData();
  // Telegram manda las notas de voz en OGG/opus; Whisper lo acepta.
  form.append('file', new Blob([bytes], { type: mime || 'audio/ogg' }), 'audio.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'es');
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 30000);
  let r;
  try {
    r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
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
