/** Server-side speech adapter. Never copies the provider key to the phone. */
export function pcmWave(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length < 2 || pcm.length % 2 || pcm.length > 2 * 1024 * 1024 - 44) throw Error('Invalid speech audio');
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
export function createVehicleSpeech({ apiKey, fetchImpl = fetch, model = 'eleven_multilingual_v2' }) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || !/^[a-z0-9_]{1,80}$/.test(model)) throw Error('Speech setup unavailable');
  return async ({ text, voiceId, signal }) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 360 || !/^[A-Za-z0-9]{20,64}$/.test(voiceId)) throw Error('Invalid speech request');
    const timeout = AbortSignal.timeout(25_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_24000`, {
      method: 'POST', redirect: 'error', signal: combined,
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/pcm' },
      body: JSON.stringify({ text, model_id: model }),
    });
    if (!response.ok || !response.body) throw Error('Speech provider unavailable');
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      for (;;) {
        combined.throwIfAborted(); const { value, done } = await reader.read(); if (done) break;
        length += value.length; if (length > 2 * 1024 * 1024 - 44) throw Error('Speech too large');
        chunks.push(Buffer.from(value));
      }
      return pcmWave(Buffer.concat(chunks));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  };
}
