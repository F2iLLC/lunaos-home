import { timingSafeEqual } from 'node:crypto';
import { parseUtterance } from './notebook-assistant.js';
import { NOTEBOOK_ANIMATIONS } from './notebook-avatar.js';

export const questionInstructions = `You are Luna, a warm, playful voice companion. Answer the user's question in one or two short sentences, at most 300 characters. Be kind, clear and age appropriate. You can explain things and invent stories. Admit uncertainty. You receive only speech-recognized text, which may be incorrect. Ask for clarification when it is unclear. You have no camera, images or visual access: never describe what the user is holding or claim to see anything; ask them to describe it. You have no browsing, memory, household records or ability to perform actions. Never claim you set or changed timers or other real-world things. Do not ask for private information. No markdown.`;

/** Single-turn, text-only cloud boundary. No transcripts, history, tools or disk output. */
export function createQuestionHandler({ token, answer, speak, voiceId, notebooks, notebookSpeech = false, cooldownMs = 2000 }) {
  if (!/^[a-f0-9]{64}$/.test(token) || typeof answer !== 'function' || typeof speak !== 'function'
    || !/^[A-Za-z0-9]{20,64}$/.test(voiceId)) throw Error('Question relay setup unavailable');
  let busy = false, nextAt = 0;
  return async (req, res) => {
    const deny = code => { res.writeHead(code, { 'Cache-Control': 'no-store' }); res.end(); };
    const supplied = req.headers.authorization;
    const expected = `Bearer ${token}`;
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return deny(401);
    if (req.method !== 'POST' || !['/question', '/confirmation', '/notebook'].includes(req.url)
      || req.headers['content-type'] !== 'application/json') return deny(400);
    const session = req.headers['x-home-session'];
    if (session !== undefined && (typeof session !== 'string' || !/^[a-f0-9-]{32,64}$/.test(session))) return deny(400);
    if (busy || (req.url !== '/notebook' && Date.now() < nextAt)) return deny(429);
    busy = true;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 55_000);
    const disconnected = () => { if (!res.writableEnded) abort.abort(); };
    res.once('close', disconnected);
    try {
      let length = 0; const chunks = [];
      for await (const chunk of req) {
        length += chunk.length; if (length > (req.url === '/notebook' ? 32768 : 4096)) return deny(413);
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || typeof input !== 'object' || Array.isArray(input)) return deny(400);
      abort.signal.throwIfAborted();
      if (req.url === '/notebook') {
        if (!notebooks) return deny(503);
        const result = await notebooks.get(session).request(input);
        const body = JSON.stringify(result);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(body);
        return;
      }
      const confirmation = req.url === '/confirmation';
      if (confirmation) {
        if (Object.keys(input).length !== 1 || input.event !== 'qwen_answers_enabled') return deny(400);
      } else if (Object.keys(input).length !== 1 || typeof input.question !== 'string'
        || !input.question.trim() || input.question.length > 1000 || /[\x00-\x1f]/.test(input.question)) return deny(400);
      nextAt = Date.now() + cooldownMs;
      let outcome;
      if (!confirmation) {
        if (notebooks) outcome = await notebooks.get(session).request({ action: 'say', text: input.question });
        else if (parseUtterance(input.question)) outcome = { handled: true, reply: 'My notebook is unavailable right now.', avatar: { animation: 'puzzled' } };
        // A rejected notebook input must not fall through to a hosted model.
        if (outcome?.status === 'failed' && outcome.handled === undefined) outcome.handled = true;
      }
      const text = confirmation ? 'Qwen answers are on. Say “Hey Luna” to ask a question.'
        : outcome?.handled ? (notebookSpeech ? outcome.reply : 'Please check my notebook on the screen for the result.')
        : await answer({ messages: [{ role: 'user', text: input.question }], instructions: questionInstructions, signal: abort.signal });
      abort.signal.throwIfAborted();
      const wave = await speak({ text, voiceId, signal: abort.signal });
      abort.signal.throwIfAborted();
      if (!Buffer.isBuffer(wave) || wave.length < 44 || wave.length > 2 * 1024 * 1024) throw Error();
      const animation = outcome?.avatar?.animation;
      const listId = outcome?.result?.op === 'delete_list' ? undefined : outcome?.view?.listId ?? outcome?.result?.listId;
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wave.length, 'Cache-Control': 'no-store',
        'X-Home-Reply-Text': Buffer.from(text, 'utf8').toString('base64'),
        ...(outcome?.handled && ['applied', 'read'].includes(outcome.status) && typeof listId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(listId) ? { 'X-Home-Notebook-List': listId } : {}),
        ...(outcome?.handled && Object.hasOwn(NOTEBOOK_ANIMATIONS, animation) ? { 'X-Home-Notebook-Animation': animation } : {}) });
      res.end(wave);
    } catch { if (!res.destroyed && !res.headersSent) deny(abort.signal.aborted ? 504 : 502); }
    finally { clearTimeout(timer); res.off('close', disconnected); busy = false; }
  };
}
