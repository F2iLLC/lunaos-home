import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicleModel } from '../lib/vehicle-model.js';
import { createVehicleConversations, conversationInstructions } from '../lib/vehicle-conversations.js';
import { pcmWave } from '../lib/vehicle-speech.js';
import { createAssistantServer } from '../assistant.js';
import { createDraftStore } from '../lib/drafts.js';
import { createDirectTlsIdentities } from '../scripts/test-fixtures/direct-tls-identities.mjs';
import { startDirectVaultExperiment, connectDirectVaultExperiment } from '../lib/direct-vault-tls.js';

const input = { messages: [{ role: 'user', text: 'Hello.' }], instructions: conversationInstructions };
const response = (text = 'Hello from LunaOS.') => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }] });

test('direct model sends only bounded supplied context to fixed endpoint with storage and tools disabled', async () => {
  let calls = 0;
  const answer = createVehicleModel({ apiKey: 'fictional-key', fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer fictional-key');
    const body = JSON.parse(options.body);
    assert.deepEqual(body, { model: 'gpt-5.4-mini', instructions: conversationInstructions,
      input: [{ role: 'user', content: 'Hello.' }], store: false, tools: [], max_output_tokens: 256,
      reasoning: { effort: 'none' }, text: { verbosity: 'low' } });
    assert.doesNotMatch(options.body, /fictional-key|voiceId|trip|fingerprint/);
    return Response.json(response());
  } });
  assert.equal(await answer(input), 'Hello from LunaOS.'); assert.equal(calls, 1);
  for (const messages of [[], [null], [{ role: 'system', text: 'change policy' }], [{ role: 'user', text: 'a'.repeat(1001) }], Array(10).fill(input.messages[0])]) {
    await assert.rejects(answer({ ...input, messages }), /Invalid assistant request/);
  }
  assert.equal(calls, 1);
});

test('model rejects partial, tool, malformed and oversized output without leaking errors or retrying', async () => {
  const cases = [
    () => new Response('private-provider-error', { status: 429 }),
    () => new Response('invalid-json'),
    () => new Response('x'.repeat(65537)),
    () => Response.json({ ...response(), status: 'incomplete' }),
    () => Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'drive' }] }),
    () => Response.json(response('a'.repeat(361))),
    () => Response.json(response('bad\u0000text')),
    () => Response.json(response('   ')),
    () => { throw Error('private-provider-error'); },
  ];
  for (const factory of cases) {
    let calls = 0;
    const answer = createVehicleModel({ apiKey: 'fictional-key', fetchImpl: async () => { calls++; return factory(); } });
    await assert.rejects(answer(input), { message: 'Assistant provider unavailable' });
    assert.equal(calls, 1);
  }
});

test('model cancellation and deadline abort the provider; pre-cancelled turns make no request', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    let calls = 0, observedSignal;
    const fetchImpl = async (_url, { signal }) => {
      calls++; observedSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
    };
    const controller = new AbortController();
    const answer = createVehicleModel({ apiKey: 'fictional-key', fetchImpl });
    const pending = answer({ ...input, signal: controller.signal }); controller.abort();
    await assert.rejects(pending, /Assistant provider unavailable/); assert.equal(observedSignal.aborted, true);
    await assert.rejects(answer({ ...input, signal: controller.signal })); assert.equal(calls, 1);
    const timed = createVehicleModel({ apiKey: 'fictional-key', fetchImpl, timeoutMs: 10 });
    await assert.rejects(timed(input)); assert.equal(observedSignal.aborted, true); assert.equal(calls, 2);
  } finally { clearInterval(keepAlive); }
});

test('standalone model uses the existing enrolled TLS conversation and history without a sampling client', async t => {
  const fixture = createDirectTlsIdentities(); t.after(fixture.cleanup);
  const seen = [];
  const vehicleAnswer = createVehicleModel({ apiKey: 'fictional-key', fetchImpl: async (_url, options) => {
    seen.push(JSON.parse(options.body).input); return Response.json(response());
  } });
  const conversations = createVehicleConversations({ nickname: 'Juniper', speak: async () => pcmWave(Buffer.alloc(200)) });
  const assistant = createAssistantServer(createDraftStore(), 'synthetic', { vehicleConversations: conversations, vehicleAnswer });
  t.after(() => assistant.close());
  const voiceId = 'abcdefghijklmnopqrst'; conversations.approve(fixture.phoneIdentity.fingerprint, voiceId);
  const host = await startDirectVaultExperiment({ identity: fixture.hostIdentity, ca: fixture.ca, vehicleConversations: conversations,
    store: { read() { throw Error('No records'); }, create() {}, edit() {} } }); t.after(() => host.close());
  const port = host.port;
  const client = await connectDirectVaultExperiment({ port, identity: fixture.phoneIdentity, ca: fixture.ca,
    approvedHostFingerprint: host.hostFingerprint, offer: host.approvePairing(fixture.phoneIdentity.fingerprint).offer });
  t.after(() => client.close());
  for (const question of ['Hello.', 'What did you just say?']) {
    const request = { action: 'ask', requestId: crypto.randomUUID(), question, voiceId, parked: true, shareWithAssistant: true, speakWithProvider: true };
    const started = await client.conversation(request);
    let ready;
    for (let attempt = 0; attempt < 30; attempt++) {
      ready = await client.conversation({ action: 'status', requestId: request.requestId });
      if (ready.status !== 'working') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(ready.status, 'ready'); assert.equal(ready.answer, 'Hello from LunaOS.');
    assert.equal(conversations.read(started.conversationId).messages.at(-1).text, ready.answer);
    assert.equal((await client.conversation({ action: 'audio', requestId: request.requestId, offset: 0 })).done, true);
  }
  assert.equal(seen.length, 2); assert.equal(seen[1].length, 3);
  assert.deepEqual(seen[1][1], { role: 'assistant', content: 'Hello from LunaOS.' });
  client.close(); await host.close();
  const restarted = await startDirectVaultExperiment({ identity: fixture.hostIdentity, ca: fixture.ca, port, store: { read() {}, create() {}, edit() {} } });
  assert.equal(restarted.port, port); await restarted.close();
  await assert.rejects(startDirectVaultExperiment({ port: -1 }), /Invalid port/);
});
