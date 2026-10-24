import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createVehicleSessions } from '../lib/vehicle-sessions.js';
import { vehicleGreetings } from '../lib/vehicle-greetings.js';
import { createDirectTlsIdentities } from '../scripts/test-fixtures/direct-tls-identities.mjs';
import { startDirectVaultExperiment, connectDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { createAssistantServer } from '../assistant.js';
import { createDraftStore } from '../lib/drafts.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const event = (trip = crypto.randomUUID(), sequence = 1, kind = 'connected') => ({ endpoint: 'vehicle', trip, sequence, event: kind, period: 'morning' });
test('vehicle grants are separate, replies are idempotent, stale events cannot reopen disconnect, grace and lease expire', () => {
  let time = 0; const sessions = createVehicleSessions({ now: () => time });
  const first = event(); assert.throws(() => sessions.receive('phone', first));
  sessions.approve('phone'); const greeting = sessions.receive('phone', first);
  assert.match(greeting.greeting, /Good morning/);
  assert.doesNotMatch(greeting.greeting, /appointment|fuel|ready|destination/);
  assert.deepEqual(sessions.receive('phone', first), greeting);
  assert.throws(() => sessions.receive('phone', event()));
  sessions.receive('phone', event(first.trip, 2, 'disconnected'));
  assert.equal(sessions.receive('phone', first).state, 'reconnecting');
  time = 119_999; assert.equal(sessions.inspect().activeSessions, 1);
  assert.equal(sessions.receive('phone', event(first.trip, 3)).greeting, greeting.greeting);
  time += 180_000; assert.equal(sessions.inspect().activeSessions, 0);
  sessions.setStyle({ style: 'dramatic' });
  assert.match(sessions.receive('phone', event()).greeting, /grand entrance|Naturally/);
  sessions.revoke('phone'); assert.throws(() => sessions.receive('phone', event()));
});

test('vehicle wire contract rejects location, controls, arbitrary context and wrong vehicle', () => {
  const sessions = createVehicleSessions(); sessions.approve('phone');
  for (const extra of [{ location: [1, 2] }, { command: 'accelerate' }, { appointments: 2 }, { name: 'Example' }, { nickname: 'Example' }, { endpoint: 'other' }, { period: 'fake' }])
    assert.throws(() => sessions.receive('phone', { ...event(), ...extra }));
  assert.throws(() => sessions.setStyle({ style: 'invent appointments' }));
});

test('assistant selection is bounded, shared by retries, and cannot speak invented facts or survive revocation', async () => {
  const sessions = createVehicleSessions(); sessions.approve('phone'); let calls = 0;
  sessions.setGreetingSelector(async input => { calls++; assert.deepEqual(Object.keys(input), ['period', 'style']); return { style: 'dramatic', variant: 0 }; });
  const first = event();
  const [a, b] = await Promise.all([sessions.receive('phone', first), sessions.receive('phone', first)]);
  assert.equal(calls, 1); assert.deepEqual(a, b); assert.match(a.greeting, /Naturally/);
  sessions.revoke('phone'); sessions.approve('phone');
  sessions.setGreetingSelector(async () => ({ style: 'warm', variant: 0, appointments: 2 }));
  assert.doesNotMatch((await sessions.receive('phone', event())).greeting, /appointment/);
  sessions.revoke('phone'); sessions.approve('phone');
  let finish; sessions.setGreetingSelector(() => new Promise(resolve => { finish = resolve; }));
  const pending = sessions.receive('phone', event()); await Promise.resolve();
  sessions.revoke('phone'); finish({ style: 'warm', variant: 0 });
  await assert.rejects(pending);
});

test('existing Home MCP server selects greeting through client sampling with no private context', async t => {
  const sessions = createVehicleSessions(); sessions.approve('synthetic-phone');
  const server = createAssistantServer(createDraftStore(), 'synthetic', { vehicleSessions: sessions, assistantStyleSelection: true });
  const client = new Client({ name: 'synthetic-sampling', version: '1' }, { capabilities: { sampling: {} } });
  const [left, right] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  let requests = 0;
  client.setRequestHandler(CreateMessageRequestSchema, async request => {
    requests++; assert.equal(request.params.includeContext, 'none');
    assert.doesNotMatch(JSON.stringify(request.params), /synthetic-phone|trip|appointment/);
    return { role: 'assistant', content: { type: 'text', text: '{"style":"dramatic","variant":0}' }, model: 'synthetic-fixture', stopReason: 'endTurn' };
  });
  await server.connect(right); await client.connect(left);
  await client.callTool({ name: 'home_vehicle_style', arguments: { style: 'warm' } });
  assert.match((await sessions.receive('synthetic-phone', event())).greeting, /Naturally/);
  assert.equal(requests, 1);
});

test('real paired TLS reports vehicle events without granting any vault access', async t => {
  const fixture = createDirectTlsIdentities(); t.after(fixture.cleanup);
  const sessions = createVehicleSessions();
  const store = { read() { throw Error('must not read records'); }, create() {}, edit() {} };
  const host = await startDirectVaultExperiment({ identity: fixture.hostIdentity, ca: fixture.ca, store, vehicleSessions: sessions });
  t.after(() => host.close());
  const connect = offer => connectDirectVaultExperiment({ port: host.port, identity: fixture.phoneIdentity, ca: fixture.ca, approvedHostFingerprint: host.hostFingerprint, offer });
  let client = await connect(host.approvePairing(fixture.phoneIdentity.fingerprint).offer);
  await assert.rejects(client.vehicle(event())); client.close();
  sessions.approve(fixture.phoneIdentity.fingerprint);
  client = await connect(); t.after(() => client.close());
  const first = event(); assert.match((await client.vehicle(first)).greeting, /\{name\}/);
  await assert.rejects(client.execute(crypto.randomUUID(), { action: 'read', recordId: 'alex-library' }));
  assert.equal((await client.vehicle(event(first.trip, 2, 'disconnected'))).state, 'reconnecting');
  await host.revokePeer(fixture.phoneIdentity.fingerprint);
  await assert.rejects(client.vehicle(event(first.trip, 3)));
  assert.equal(sessions.inspect().activeSessions, 0);
});

test('production phone trip state machine runs on the JVM', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'home-vehicle-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  execFileSync('javac', ['-d', directory, 'scripts/android/vehicle/VehicleTrip.java', 'test/java/VehicleTripTest.java'], { windowsHide: true });
  const result = execFileSync('java', ['-cp', directory, 'io.github.f2illc.lunaos.home.vehicle.VehicleTripTest'], { windowsHide: true, encoding: 'utf8' });
  assert.match(result, /passed/);
});

test('vehicle audio lead-in primes the route for four seconds without dropping the first spoken samples', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'home-vehicle-audio-')); t.after(() => rm(directory, { recursive: true, force: true }));
  execFileSync('javac', ['-d', directory, 'scripts/android/vehicle/VehicleLeadIn.java', 'test/java/VehicleLeadInTest.java'], { windowsHide: true });
  const result = execFileSync('java', ['-cp', directory, 'io.github.f2illc.lunaos.home.vehicle.VehicleLeadInTest'], { windowsHide: true, encoding: 'utf8' });
  assert.match(result, /passed/);
});

test('all twelve greetings match across phone/backend and never repeat on consecutive trips', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'home-vehicle-greetings-')); t.after(() => rm(directory, { recursive: true, force: true }));
  execFileSync('javac', ['-d', directory, 'scripts/android/vehicle/VehicleGreetings.java', 'scripts/android/vehicle/VehiclePassengers.java', 'test/java/VehicleGreetingsTest.java'], { windowsHide: true });
  const catalog = Object.values(vehicleGreetings).flat();
  assert.equal(new Set(catalog).size, 12);
  const examples = ['morning', 'afternoon', 'evening'].flatMap(period => catalog.map(line => line.replace('{period}', period)));
  const result = execFileSync('java', ['-cp', directory, 'io.github.f2illc.lunaos.home.vehicle.VehicleGreetingsTest', ...examples], { windowsHide: true, encoding: 'utf8' });
  assert.match(result, /passed/);
});

test('route changes during async seek cannot authorize unmuting or survive cancellation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'home-vehicle-route-')); t.after(() => rm(directory, { recursive: true, force: true }));
  execFileSync('javac', ['-d', directory, 'scripts/android/vehicle/VehiclePlaybackGate.java', 'test/java/VehiclePlaybackGateTest.java'], { windowsHide: true });
  const result = execFileSync('java', ['-cp', directory, 'io.github.f2illc.lunaos.home.vehicle.VehiclePlaybackGateTest'], { windowsHide: true, encoding: 'utf8' });
  assert.match(result, /passed/);
});
