/** Bounded Ollama chat adapter for a Qwen model hosted on the Mac Studio. */
export function createQwenModel({ endpoint = 'http://127.0.0.1:11434/api/chat', model = 'qwen3:32b', fetchImpl = fetch, timeoutMs = 45_000 } = {}) {
  let url;
  try { url = new URL(endpoint); } catch { throw Error('Assistant setup unavailable'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/api/chat' || url.search || url.hash
    || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 50_000) throw Error('Assistant setup unavailable');
  return async ({ messages, instructions, signal }) => {
    if (typeof instructions !== 'string' || !instructions.trim() || instructions.length > 4000
      || !Array.isArray(messages) || messages.length !== 1 || messages[0]?.role !== 'user'
      || typeof messages[0].text !== 'string' || !messages[0].text.trim() || messages[0].text.length > 1000) throw Error('Invalid assistant request');
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let reader;
    try {
      combined.throwIfAborted();
      const response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: combined,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, think: false, messages: [
          { role: 'system', content: instructions }, { role: 'user', content: messages[0].text },
        ], options: { num_predict: 160 } }),
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw Error(); }
      reader = response.body.getReader(); const chunks = []; let length = 0;
      for (;;) {
        combined.throwIfAborted(); const { value, done } = await reader.read(); if (done) break;
        length += value.length; if (length > 64 * 1024) throw Error(); chunks.push(Buffer.from(value));
      }
      combined.throwIfAborted();
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const answer = result.message?.content?.trim();
      if (result.done !== true || typeof answer !== 'string' || !answer || answer.length > 360
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(answer)) throw Error();
      return answer;
    } catch { throw Error('Assistant provider unavailable'); }
    finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
  };
}
