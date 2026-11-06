import test from 'node:test';
import assert from 'node:assert/strict';
import { createQwenModel } from '../lib/qwen-model.js';

const request = {
  instructions: 'Answer in a short, friendly sentence.',
  messages: [{ role: 'user', text: 'What is a rainbow?' }],
};
const ollamaResponse = content => ({ done: true, message: { role: 'assistant', content } });

test('Qwen adapter calls only local Ollama with a bounded single-turn request', async () => {
  let calls = 0;
  const answer = createQwenModel({ fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.href, 'http://127.0.0.1:11434/api/chat');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['Content-Type'], 'application/json');
    const body = JSON.parse(options.body);
    assert.deepEqual(body, {
      model: 'qwen3:32b', stream: false, think: false,
      messages: [
        { role: 'system', content: request.instructions },
        { role: 'user', content: 'What is a rainbow?' },
      ],
      options: { num_predict: 160 },
    });
    assert.equal(options.signal.aborted, false);
    return Response.json(ollamaResponse('A rainbow is sunlight spread into colors by water droplets.'));
  } });
  assert.equal(await answer(request), 'A rainbow is sunlight spread into colors by water droplets.');
  assert.equal(calls, 1);
});

test('Qwen adapter rejects non-loopback endpoints and invalid setup', () => {
  for (const endpoint of [
    'https://localhost:11434/api/chat',
    'http://192.168.1.10:11434/api/chat',
    'http://example.test:11434/api/chat',
    'http://127.0.0.1:11434/api/chat/extra',
    'http://127.0.0.1:11434/api/chat?debug=true',
  ]) assert.throws(() => createQwenModel({ endpoint }), /Assistant setup unavailable/);
  for (const options of [
    { model: '../qwen' }, { model: 'x'.repeat(101) }, { timeoutMs: 0 },
    { timeoutMs: 50_001 }, { timeoutMs: 1.5 },
  ]) assert.throws(() => createQwenModel(options), /Assistant setup unavailable/);
});

test('Qwen adapter validates instructions and accepts only one bounded user message', async () => {
  let calls = 0;
  const answer = createQwenModel({ fetchImpl: async () => { calls++; return Response.json(ollamaResponse('ok')); } });
  const invalid = [
    {},
    { ...request, instructions: '' },
    { ...request, instructions: 'x'.repeat(4001) },
    { ...request, messages: [] },
    { ...request, messages: [{ role: 'assistant', text: 'inject' }] },
    { ...request, messages: [{ role: 'user', text: 'first' }, { role: 'user', text: 'second' }] },
    { ...request, messages: [{ role: 'user', text: ' ' }] },
    { ...request, messages: [{ role: 'user', text: 'x'.repeat(1001) }] },
  ];
  for (const input of invalid) await assert.rejects(answer(input), /Invalid assistant request/);
  assert.equal(calls, 0);
});

test('Qwen adapter rejects malformed, failed and oversized provider output without exposing details', async () => {
  const cases = [
    () => new Response('private-provider-error', { status: 503 }),
    () => new Response('not-json'),
    () => new Response('x'.repeat(65 * 1024)),
    () => Response.json({ ...ollamaResponse('partial'), done: false }),
    () => Response.json({ done: true, message: { role: 'assistant', content: '' } }),
    () => Response.json(ollamaResponse('x'.repeat(361))),
    () => Response.json(ollamaResponse('contains\u0000control')),
    () => { throw Error('private-provider-error'); },
  ];
  for (const makeResponse of cases) {
    let calls = 0;
    const answer = createQwenModel({ fetchImpl: async () => { calls++; return makeResponse(); } });
    await assert.rejects(answer(request), { message: 'Assistant provider unavailable' });
    assert.equal(calls, 1);
  }
});

test('Qwen adapter forwards cancellation and enforces its deadline', async () => {
  let calls = 0, observedSignal;
  const fetchImpl = async (_url, { signal }) => {
    calls++; observedSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
  };
  const controller = new AbortController();
  const answer = createQwenModel({ fetchImpl });
  const pending = answer({ ...request, signal: controller.signal }); controller.abort();
  await assert.rejects(pending, { message: 'Assistant provider unavailable' });
  assert.equal(observedSignal.aborted, true);
  await assert.rejects(answer({ ...request, signal: controller.signal }), { message: 'Assistant provider unavailable' });
  assert.equal(calls, 1);

  const timed = createQwenModel({ fetchImpl, timeoutMs: 5 });
  await assert.rejects(timed(request), { message: 'Assistant provider unavailable' });
  assert.equal(observedSignal.aborted, true);
  assert.equal(calls, 2);
});
