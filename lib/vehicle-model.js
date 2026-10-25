/** Home's bounded vehicle answer adapter; keys stay on the enrolled host. */
export function createVehicleModel({ apiKey, model = 'gpt-5.4-mini', fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || !/^[a-zA-Z0-9._-]{1,100}$/.test(model)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw Error('Assistant setup unavailable');
  return async ({ messages, instructions, signal }) => {
    if (typeof instructions !== 'string' || !instructions.trim() || instructions.length > 4000
      || !Array.isArray(messages) || messages.length < 1 || messages.length > 9
      || messages.some(message => !message || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string'
        || !message.text.trim() || message.text.length > (message.role === 'user' ? 1000 : 360))
      || messages.at(-1).role !== 'user') throw Error('Invalid assistant request');
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let reader;
    try {
      combined.throwIfAborted();
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, instructions, input: messages.map(({ role, text }) => ({ role, content: text })),
          store: false, tools: [], max_output_tokens: 256, reasoning: { effort: 'none' }, text: { verbosity: 'low' } }),
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw Error(); }
      reader = response.body.getReader();
      const chunks = []; let length = 0;
      for (;;) {
        combined.throwIfAborted();
        const { value, done } = await reader.read(); if (done) break;
        length += value.length; if (length > 64 * 1024) throw Error();
        chunks.push(Buffer.from(value));
      }
      combined.throwIfAborted();
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (result.status !== 'completed' || !Array.isArray(result.output)) throw Error();
      const output = result.output.filter(item => item.type !== 'reasoning');
      if (output.length !== 1 || output[0].type !== 'message' || output[0].role !== 'assistant'
        || output[0].status !== 'completed' || !Array.isArray(output[0].content) || !output[0].content.length
        || output[0].content.some(part => part.type !== 'output_text' || typeof part.text !== 'string')) throw Error();
      const answer = output[0].content.map(part => part.text).join('').trim();
      if (!answer || answer.length > 360 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(answer)) throw Error();
      return answer;
    } catch { throw Error('Assistant provider unavailable'); }
    finally { if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); } }
  };
}
