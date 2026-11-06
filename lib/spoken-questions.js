import { timingSafeEqual } from 'node:crypto';

export const questionInstructions = `You are Luna, a warm, playful voice companion. Answer the user's question in one or two short sentences, at most 300 characters. Be kind, clear and age appropriate. You can explain things and invent stories. Admit uncertainty. You have no browsing, memory, household records or ability to perform actions. Never claim you set or changed timers or other real-world things. Do not ask for private information. No markdown.`;

/** Single-turn, text-only cloud boundary. No transcripts, history, tools or disk output. */
export function createQuestionHandler({ token, answer, speak, voiceId }) {
  if (!/^[a-f0-9]{64}$/.test(token) || typeof answer !== 'function' || typeof speak !== 'function'
    || !/^[A-Za-z0-9]{20,64}$/.test(voiceId)) throw Error('Question relay setup unavailable');
  let busy = false, nextAt = 0;
  return async (req, res) => {
    const deny = code => { res.writeHead(code, { 'Cache-Control': 'no-store' }); res.end(); };
    const supplied = req.headers.authorization;
    const expected = `Bearer ${token}`;
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return deny(401);
    if (req.method !== 'POST' || !['/question', '/confirmation'].includes(req.url)
      || req.headers['content-type'] !== 'application/json') return deny(400);
    if (busy || Date.now() < nextAt) return deny(429);
    busy = true;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 55_000);
    const disconnected = () => { if (!res.writableEnded) abort.abort(); };
    res.once('close', disconnected);
    try {
      let length = 0; const chunks = [];
      for await (const chunk of req) {
        length += chunk.length; if (length > 4096) return deny(413);
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const confirmation = req.url === '/confirmation';
      if (confirmation) {
        if (Object.keys(input).length !== 1 || input.event !== 'qwen_answers_enabled') return deny(400);
      } else if (Object.keys(input).length !== 1 || typeof input.question !== 'string'
        || !input.question.trim() || input.question.length > 1000 || /[\x00-\x1f]/.test(input.question)) return deny(400);
      nextAt = Date.now() + 2000;
      const text = confirmation ? 'Qwen answers are on. Say “Hey Luna” to ask a question.'
        : await answer({ messages: [{ role: 'user', text: input.question }], instructions: questionInstructions, signal: abort.signal });
      abort.signal.throwIfAborted();
      const wave = await speak({ text, voiceId, signal: abort.signal });
      abort.signal.throwIfAborted();
      if (!Buffer.isBuffer(wave) || wave.length < 44 || wave.length > 2 * 1024 * 1024) throw Error();
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wave.length, 'Cache-Control': 'no-store' });
      res.end(wave);
    } catch { if (!res.destroyed && !res.headersSent) deny(abort.signal.aborted ? 504 : 502); }
    finally { clearTimeout(timer); res.off('close', disconnected); busy = false; }
  };
}
