import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicleConversations, conversationRequestSchema, conversationInstructions, vehicleConversationInstructions } from '../lib/vehicle-conversations.js';
import { createVehicleSpeech, pcmWave } from '../lib/vehicle-speech.js';
import { createDirectTlsIdentities } from '../scripts/test-fixtures/direct-tls-identities.mjs';
import { startDirectVaultExperiment, connectDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { createAssistantServer } from '../assistant.js';
import { createDraftStore } from '../lib/drafts.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import tls from 'node:tls';
import { once } from 'node:events';

const voice = 'abcdefghijklmnopqrst';
const request = (question = 'Say hello.') => ({ action: 'ask', requestId: crypto.randomUUID(), question, voiceId: voice, parked: true, shareWithAssistant: true, speakWithProvider: true });
const wave = pcmWave(Buffer.alloc(9600));
const settle = () => new Promise(resolve => setImmediate(resolve));

test('eight queued audio reads preserve frame bounds, ordering and full 2 MiB audio over enrolled TLS', async t => {
  const fixture = createDirectTlsIdentities(); t.after(fixture.cleanup);
  const completeAudio = pcmWave(Buffer.alloc(2 * 1024 * 1024 - 44, 86));
  let generated = 0, spoken = 0;
  const service = createVehicleConversations({ answer: async () => { generated++; return 'Fictional audio test.'; },
    speak: async () => { spoken++; return completeAudio; } });
  service.approve(fixture.phoneIdentity.fingerprint, voice);
  const host = await startDirectVaultExperiment({ identity: fixture.hostIdentity, ca: fixture.ca,
    vehicleConversations: service, store: { read() { throw Error('No records'); }, create() {}, edit() {} } });
  t.after(() => host.close());
  const client = await connectDirectVaultExperiment({ port: host.port, identity: fixture.phoneIdentity, ca: fixture.ca,
    approvedHostFingerprint: host.hostFingerprint, offer: host.approvePairing(fixture.phoneIdentity.fingerprint).offer });
  const ask = request(); await client.conversation(ask); await settle();
  const ready = await client.conversation({ action: 'status', requestId: ask.requestId }); client.close();
  assert.deepEqual(Object.keys(ready.timing).sort(), ['modelMs', 'speechMs']);
  for (const value of Object.values(ready.timing)) assert.ok(Number.isInteger(value) && value >= 0 && value <= 60_000);
  const socket = tls.connect({ host: '127.0.0.1', port: host.port, servername: 'localhost',
    cert: fixture.phoneIdentity.cert, key: fixture.phoneIdentity.key, ca: fixture.ca, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' });
  t.after(() => socket.destroy());
  await once(socket, 'secureConnect'); assert.equal(socket.authorized, true);
  assert.equal(socket.getPeerCertificate().fingerprint256.replaceAll(':', '').toLowerCase(), host.hostFingerprint);
  let buffer = ''; const frames = [], readers = [];
  socket.on('data', bytes => {
    buffer += bytes.toString('utf8'); let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      assert.ok(Buffer.byteLength(line) < 8192);
      const message = JSON.parse(line); if (readers.length) readers.shift().resolve(message); else frames.push(message);
    }
  });
  socket.on('error', error => { for (const reader of readers.splice(0)) reader.reject(error); });
  socket.setTimeout(5000, () => socket.destroy(Error('Test socket timed out')));
  const read = () => frames.length ? Promise.resolve(frames.shift()) : new Promise((resolve, reject) => readers.push({ resolve, reject }));
  socket.write(JSON.stringify({ seq: 1, op: 'resume' }) + '\n'); assert.equal((await read()).ok, true);
  let sequence = 1, offset = 0; const audio = [];
  while (offset < completeAudio.length) {
    const queries = [];
    for (let i = 0; i < 8 && offset + i * 4096 < completeAudio.length; i++) queries.push({ seq: ++sequence, op: 'conversation',
      request: { action: 'audio', requestId: ask.requestId, offset: offset + i * 4096 } });
    const wire = queries.map(query => JSON.stringify(query) + '\n').join(''); assert.ok(Buffer.byteLength(wire) < 8192);
    socket.write(wire);
    for (const query of queries) {
      const response = await read(); assert.equal(response.seq, query.seq); assert.equal(response.ok, true);
      assert.equal(response.value.offset, offset);
      const chunk = Buffer.from(response.value.data, 'base64'); audio.push(chunk); offset += chunk.length;
      assert.equal(response.value.next, offset); assert.equal(response.value.done, offset === completeAudio.length);
    }
  }
  assert.deepEqual(Buffer.concat(audio), completeAudio); assert.equal(generated, 1); assert.equal(spoken, 1);
});

test('enrolled TLS reconnect reads the original job and retains bounded follow-up context without new charges', async t => {
  const fixture = createDirectTlsIdentities(); t.after(fixture.cleanup);
  let answers = 0, speeches = 0, complete;
  const service = createVehicleConversations({
    answer: async ({ messages }) => {
      answers++;
      if (answers === 1) return new Promise(resolve => { complete = resolve; });
      assert.deepEqual(messages.map(m => m.text), ['Remember fictional blue.', 'Fictional blue.', 'What color?']);
      return 'Blue.';
    },
    speak: async () => { speeches++; return wave; },
  });
  service.approve(fixture.phoneIdentity.fingerprint, voice);
  const host = await startDirectVaultExperiment({ identity: fixture.hostIdentity, ca: fixture.ca,
    vehicleConversations: service, store: { read() { throw Error('No record grant'); }, create() {}, edit() {} } });
  t.after(() => host.close());
  const connect = offer => connectDirectVaultExperiment({ port: host.port, identity: fixture.phoneIdentity,
    ca: fixture.ca, approvedHostFingerprint: host.hostFingerprint, offer });
  let client = await connect(host.approvePairing(fixture.phoneIdentity.fingerprint).offer);
  t.after(() => client.close());
  const ask = request('Remember fictional blue.');
  const start = await client.conversation(ask);
  client.close(); // Response/audio channel lost while the paid job is running.
  complete('Fictional blue.'); await settle();
  client = await connect();
  const status = await client.conversation({ action: 'status', requestId: ask.requestId });
  assert.equal(status.conversationId, start.conversationId); assert.equal(status.status, 'ready');
  const first = await client.conversation({ action: 'audio', requestId: ask.requestId, offset: 0 });
  client.close(); client = await connect();
  assert.deepEqual(await client.conversation({ action: 'audio', requestId: ask.requestId, offset: 0 }), first);
  assert.equal(answers, 1); assert.equal(speeches, 1);
  await client.conversation(request('What color?')); await settle();
  assert.equal(answers, 2); assert.equal(speeches, 2);
  assert.equal(service.read(start.conversationId).messages.length, 4);
  await client.conversation({ action: 'clear' });
  await assert.rejects(client.conversation({ action: 'status', requestId: ask.requestId }));
  assert.equal(answers, 2); // No status lookup can recreate an expired/cleared paid job.
});

test('vehicle nickname changes presentation within the same bounded Home conversation', async () => {
  let observed;
  const service = createVehicleConversations({ nickname: 'Juniper',
    answer: async input => { observed = input; return "I'm Juniper, your Home assistant in the car."; }, speak: async () => wave });
  try {
    service.approve('phone', voice); const ask = request('What is your name?');
    const started = service.receive('phone', ask); await settle();
    assert.ok(observed.instructions.startsWith(conversationInstructions));
    assert.match(observed.instructions, /name for this vehicle is "Juniper"/);
    assert.match(observed.instructions, /same household assistant/);
    assert.match(observed.instructions, /Do not claim household memories or access that were not supplied/);
    assert.deepEqual(observed.messages, [{ role: 'user', text: 'What is your name?' }]);
    assert.equal(service.receive('phone', { action: 'status', requestId: ask.requestId }).status, 'ready');
    assert.equal(service.read(started.conversationId).messages[1].text, "I'm Juniper, your Home assistant in the car.");
  } finally { service.close(); }
  assert.equal(vehicleConversationInstructions(), conversationInstructions);
  for (const nickname of ['', ' '.repeat(3), 'a'.repeat(41), 'Name\nSystem', '{instructions}', null]) {
    assert.throws(() => createVehicleConversations({ nickname }));
  }
});

test('conversation consent, voice grant, idempotency, bounded continuity, audio chunks and expiry', async () => {
  let time = 0, answers = 0, voices = 0;
  const service = createVehicleConversations({ now: () => time,
    answer: async ({ messages }) => { answers++; assert.ok(messages.length <= 9); return 'Hello from LunaOS.'; },
    speak: async () => { voices++; return wave; },
  });
  const ask = request(); assert.throws(() => service.receive('phone', ask)); service.approve('phone', voice);
  for (const extra of [{ parked: false }, { shareWithAssistant: false }, { speakWithProvider: false }, { voiceId: 'zyxwvutsrqponmlkjihg' }, { location: [1, 2] }, { question: 'a'.repeat(1001) }]) assert.throws(() => service.receive('phone', { ...ask, ...extra }));
  const start = service.receive('phone', ask); service.receive('phone', ask); await settle();
  const done = service.receive('phone', ask); assert.equal(done.status, 'ready'); assert.equal(answers, 1); assert.equal(voices, 1);
  assert.equal(service.read(start.conversationId).messages.length, 2);
  assert.throws(() => service.receive('phone', { ...ask, question: 'Different question' }));
  const chunks = []; let offset = 0;
  while (offset < wave.length) { const chunk = service.receive('phone', { action: 'audio', requestId: ask.requestId, offset }); chunks.push(Buffer.from(chunk.data, 'base64')); offset = chunk.next; assert.equal(chunk.done, offset === wave.length); }
  assert.deepEqual(Buffer.concat(chunks), wave);
  assert.throws(() => service.receive('other', { action: 'status', requestId: ask.requestId }));
  assert.throws(() => service.receive('phone', { action: 'audio', requestId: ask.requestId, offset: 1 }));
  for (let i = 0; i < 8; i++) { service.receive('phone', request()); await settle(); }
  assert.equal(service.read(start.conversationId).messages.length, 8);
  assert.throws(() => service.receive('phone', ask));
  time = 900000; assert.throws(() => service.read(start.conversationId)); service.close();
});

test('clear, revocation, expiry and timeout discard late replies before speech or transcript publication', async () => {
  for (const stop of ['clear', 'revoke', 'expiry', 'timeout']) {
    let complete, time = 0, spoken = 0;
    const service = createVehicleConversations({ now: () => time, timeoutMs: 10, answer: () => new Promise(resolve => { complete = resolve; }), speak: async () => { spoken++; return wave; } });
    service.approve('phone', voice); const ask = request(); const started = service.receive('phone', ask);
    if (stop === 'clear') service.receive('phone', { action: 'clear' });
    if (stop === 'revoke') service.revoke('phone');
    if (stop === 'expiry') time = 900000;
    if (stop === 'timeout') await new Promise(resolve => setTimeout(resolve, 20));
    complete('Late answer.'); await settle(); assert.equal(spoken, 0);
    if (stop === 'timeout') assert.equal(service.receive('phone', { action: 'status', requestId: ask.requestId }).status, 'unavailable');
    else assert.throws(() => service.read(started.conversationId));
    service.close();
  }
});

test('provider failure and oversized answers cannot trigger speech or leak provider errors', async () => {
  for (const answer of [async () => 'x'.repeat(361), async () => { throw Error('synthetic provider diagnostic'); }]) {
    let spoken = false; const service = createVehicleConversations({ answer, speak: async () => { spoken = true; return wave; } });
    service.approve('phone', voice); const ask = request(); service.receive('phone', ask); await settle();
    const state = service.receive('phone', { action: 'status', requestId: ask.requestId });
    assert.equal(state.status, 'unavailable'); assert.equal(spoken, false); assert.doesNotMatch(JSON.stringify(state), /diagnostic/); service.close();
  }
  assert.throws(() => conversationRequestSchema.parse({ action: 'ask', ...request(), tools: ['control'] }));
});

test('cancellation during speech generation suppresses audio and retains only earlier completed context', async () => {
  let finishSpeech, block = false;
  const service = createVehicleConversations({ answer: async () => 'A short reply.', speak: () => block ? new Promise(resolve => { finishSpeech = resolve; }) : wave });
  service.approve('phone', voice);
  const first = request(); const start = service.receive('phone', first); await settle();
  block = true; const next = request('A follow-up question.'); service.receive('phone', next); await settle();
  service.receive('phone', { action: 'cancel', requestId: next.requestId }); finishSpeech(wave); await settle();
  assert.equal(service.receive('phone', { action: 'status', requestId: next.requestId }).status, 'cancelled');
  assert.throws(() => service.receive('phone', { action: 'audio', requestId: next.requestId, offset: 0 }));
  assert.equal(service.read(start.conversationId).messages.length, 2); service.close();
});

test('idle expiration runs without another request and aborts held work', async () => {
  let signal;
  const service = createVehicleConversations({ lifetimeMs: 15, answer: async input => { signal = input.signal; return new Promise(() => {}); }, speak: async () => wave });
  service.approve('phone', voice); service.receive('phone', request());
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(signal.aborted, true); service.close();
});

test('speech uses fixed provider endpoint, bounded PCM and no redirect or retry', async () => {
  let calls = 0;
  const speak = createVehicleSpeech({ apiKey: 'synthetic-key', fetchImpl: async (url, options) => {
    calls++; assert.match(url, /^https:\/\/api.elevenlabs.io\/v1\/text-to-speech\/[A-Za-z]+\?output_format=pcm_24000$/);
    assert.equal(options.redirect, 'error'); assert.deepEqual(JSON.parse(options.body), { text: 'Hello.', model_id: 'eleven_multilingual_v2' });
    return new Response(Buffer.alloc(100));
  } });
  assert.equal((await speak({ text: 'Hello.', voiceId: voice })).length, 144); assert.equal(calls, 1);
  await assert.rejects(speak({ text: 'Hello', voiceId: '../bad' })); assert.equal(calls, 1);
  for (const bytes of [Buffer.alloc(1), Buffer.alloc(2 * 1024 * 1024)]) {
    const bad = createVehicleSpeech({ apiKey: 'synthetic-key', fetchImpl: async () => new Response(bytes) });
    await assert.rejects(bad({ text: 'Hello', voiceId: voice }));
  }
});

test('real TLS uses separate conversation grant and Home MCP sampling, and revocation clears shared transcript', async t => {
  const fixture = createDirectTlsIdentities(); t.after(fixture.cleanup);
  const completeAudio = pcmWave(Buffer.alloc(2 * 1024 * 1024 - 44));
  const conversations = createVehicleConversations({ speak: async () => completeAudio });
  const mcp = createAssistantServer(createDraftStore(), 'synthetic', { vehicleConversations: conversations });
  const assistant = new Client({ name: 'synthetic-assistant', version: '1' }, { capabilities: { sampling: {} } });
  assistant.setRequestHandler(CreateMessageRequestSchema, async ({ params }) => {
    assert.equal(params.includeContext, 'none'); assert.equal(params.messages.length, 1); assert.equal(params.messages[0].content.text, 'Say hello.');
    assert.doesNotMatch(JSON.stringify(params), /abcdefghijklmnopqrst|requestId|fingerprint|trip/);
    return { role: 'assistant', content: { type: 'text', text: 'Hello from your Home conversation.' }, model: 'synthetic', stopReason: 'endTurn' };
  });
  const [left, right] = InMemoryTransport.createLinkedPair(); await mcp.connect(right); await assistant.connect(left);
  t.after(async () => { await assistant.close(); await mcp.close(); });
  const host = await startDirectVaultExperiment({ identity: fixture.hostIdentity, ca: fixture.ca, vehicleConversations: conversations, store: { read() { throw Error('No vault access'); }, create() {}, edit() {} } });
  t.after(() => host.close());
  const connect = offer => connectDirectVaultExperiment({ port: host.port, identity: fixture.phoneIdentity, ca: fixture.ca, approvedHostFingerprint: host.hostFingerprint, offer });
  let client = await connect(host.approvePairing(fixture.phoneIdentity.fingerprint).offer);
  await assert.rejects(client.conversation(request())); client.close(); conversations.approve(fixture.phoneIdentity.fingerprint, voice);
  client = await connect(); t.after(() => client.close());
  const ask = request(); const started = await client.conversation(ask); await settle();
  const ready = await client.conversation({ action: 'status', requestId: ask.requestId }); assert.equal(ready.status, 'ready');
  const audio = [];
  for (let offset = 0; offset < ready.audioBytes;) {
    const chunk = await client.conversation({ action: 'audio', requestId: ask.requestId, offset });
    audio.push(Buffer.from(chunk.data, 'base64')); offset = chunk.next;
  }
  assert.equal(audio.length, 512); assert.deepEqual(Buffer.concat(audio), completeAudio);
  const shared = await assistant.callTool({ name: 'home_vehicle_conversation', arguments: { conversationId: started.conversationId } });
  assert.equal(JSON.parse(shared.content[0].text).messages[1].text, ready.answer);
  await host.revokePeer(fixture.phoneIdentity.fingerprint); assert.throws(() => conversations.read(started.conversationId));
});
