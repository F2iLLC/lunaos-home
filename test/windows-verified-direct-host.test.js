import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { superviseNativeDirectHost } from '../scripts/test-fixtures/native-direct-host.mjs';
import { startWindowsVerifiedDirectHost } from '../lib/windows-verified-direct-host.js';
import { connectDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { createDirectTlsIdentities } from '../scripts/test-fixtures/direct-tls-identities.mjs';

const identities = createDirectTlsIdentities();
after(identities.cleanup);
const example = { memberId: 'alex-example', label: 'Library visit', value: 'Friday protected visit' };
const read = { action: 'read', recordId: 'alex-library' };
const edit = { action: 'edit', recordId: 'alex-library', data: { ...example, value: 'Committed during visit' } };
const scope = { recordIds: ['alex-library'], lifetimeMs: 60_000 };
const denied = error => error.code === 'DENIED';
const unavailable = error => ['DENIED', 'UNAVAILABLE'].includes(error.code);
// Controlled child receipts only. These tests never invoke Windows authentication.
async function fixture(t, store) {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.kill = () => { child.killed = true; };
  let tick = 0; const timers = [];
  const visit = await startWindowsVerifiedDirectHost({ child, store, identity: identities.hostIdentity, ca: identities.ca,
    gateOptions: { now: () => tick, schedule: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; }, cancel: timer => { if (timer) timer.cancelled = true; } },
  });
  t.after(() => visit.close());
  const verify = () => child.stdout.emit('data', Buffer.from('HOME_WINDOWS_MONITOR_READY\nHOME_WINDOWS_VERIFIED\n'));
  const end = () => child.stdout.emit('data', Buffer.from('HOME_WINDOWS_SESSION_ENDED\n'));
  const connect = async (offer) => {
    const client = await connectDirectVaultExperiment({ port: visit.host.port, identity: identities.phoneIdentity, ca: identities.ca, approvedHostFingerprint: visit.host.hostFingerprint, offer, requestTimeoutMs: 10_000 });
    t.after(() => client.close()); return client;
  };
  const pair = () => {
    const review = visit.enrollment.review(identities.phoneIdentity.fingerprint);
    return connect(visit.enrollment.decide({ ...review, allow: true }).offer);
  };
  return { ...visit, child, timers, verify, end, connect, pair, time: value => { tick = value; } };
}
const emptyStore = () => ({ read: async () => example, create: async () => {}, edit: async () => {} });
async function pending(host, count) {
  const deadline = performance.now() + 2000;
  while (host.pendingRequestCount() !== count && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(host.pendingRequestCount(), count);
}

test('pairing never verifies the Windows visit or creates a grant; reconnect requires fresh scope', async t => {
  let reads = 0;
  const f = await fixture(t, { ...emptyStore(), read: async () => { reads++; return example; } });
  const client = await f.pair();
  const selected = { connectionId: client.connectionId, peerFingerprint: identities.phoneIdentity.fingerprint };
  assert.throws(() => f.enrollment.approveRead(selected), denied);
  await assert.rejects(client.execute(crypto.randomUUID(), read), denied);
  assert.equal(reads, 0);
  f.child.stdout.emit('data', Buffer.from('HOME_WINDOWS_MONITOR_READY\n'));
  assert.throws(() => f.enrollment.approveRead(selected), denied);
  f.child.stdout.emit('data', Buffer.from('HOME_WINDOWS_VERIFIED\n'));
  const grant = f.enrollment.approveRead(selected);
  assert.deepEqual(await client.execute(grant, read), example);
  await assert.rejects(client.execute(grant, edit), denied);
  client.close(); const next = await f.connect();
  await assert.rejects(next.execute(grant, read), denied);
  const fresh = f.enrollment.approveRead({ ...selected, connectionId: next.connectionId });
  assert.deepEqual(await next.execute(fresh, read), example);
  f.end();
  await assert.rejects(next.execute(fresh, read), unavailable);
  await assert.rejects(f.connect(), unavailable);
  f.verify(); assert.throws(() => f.gate.requireVerified(), denied);
});

test('cancel, unavailable monitor, malformed receipt, pipe/child failure and both visit timers close remote access', async t => {
  for (const fail of [
    f => f.child.emit('exit', 2), f => f.child.emit('error', Error('controlled child failure')),
    f => f.child.stdout.emit('end'), f => f.child.stdout.emit('error', Error('controlled pipe failure')),
    f => f.child.stdout.emit('data', Buffer.from('HOME_WINDOWS_VERIFIED\n')),
    f => f.child.stdout.emit('data', Buffer.from('HOME_WINDOWS_MONITOR_UNAVAILABLE\n')),
    f => f.child.stdout.emit('data', Buffer.from('verified\n')),
    f => f.timers[0].fn(), f => { f.verify(); f.timers[1].fn(); },
    f => { f.verify(); f.end(); },
  ]) {
    const f = await fixture(t, emptyStore()); const client = await f.pair(); fail(f); f.verify();
    assert.equal(f.child.killed, true);
    assert.throws(() => f.host.approveAccess(client.connectionId, 'setup', scope), denied);
    await assert.rejects(client.execute(crypto.randomUUID(), edit), error => ['DENIED', 'UNAVAILABLE', 'WRITE_UNKNOWN'].includes(error.code));
    await assert.rejects(f.connect(), unavailable);
    await f.close();
  }
});

test('elapsed expiry and invalid clock deny approval without waiting for the timer', async t => {
  for (const time of [300000, -1, Number.NaN]) {
    const f = await fixture(t, emptyStore()); f.verify(); const client = await f.pair(); f.time(time);
    assert.throws(() => f.host.approveAccess(client.connectionId, 'read-only', scope), denied);
    assert.equal(f.child.killed, true);
    await assert.rejects(f.connect(), unavailable);
  }
});

test('session-ended receipt withholds a real decrypted read and cancels an accepted queued mutation', { skip: process.platform !== 'win32' }, async t => {
  const store = await openWindowsProbeStore({ create: true }); t.after(() => store.removeSyntheticStore());
  await store.create('alex-library', example);
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let writes = 0;
  const f = await fixture(t, { read: async id => { const value = await store.read(id); entered.resolve(); await release.promise; return value; }, create: store.create,
    edit: async (...args) => { writes++; return store.edit(...args); } });
  f.verify(); const client = await f.pair(); const grant = f.host.approveAccess(client.connectionId, 'setup', scope);
  const reading = assert.rejects(client.execute(grant, read), unavailable);
  await entered.promise;
  const writing = assert.rejects(client.execute(grant, edit), error => ['DENIED', 'UNAVAILABLE', 'WRITE_UNKNOWN'].includes(error.code));
  await pending(f.host, 2); f.end(); release.resolve();
  await Promise.all([reading, writing]); await pending(f.host, 0);
  assert.equal(writes, 0); assert.deepEqual(await store.read('alex-library'), example);
});

test('deadline observed after decrypt withholds the record even if the timer has not run', async t => {
  let f;
  f = await fixture(t, { ...emptyStore(), read: async () => { f.time(300000); return example; } });
  f.verify(); const client = await f.pair(); const grant = f.host.approveAccess(client.connectionId, 'read-only', scope);
  await assert.rejects(client.execute(grant, read), unavailable);
  assert.equal(f.child.killed, true);
});

test('session end during a real encrypted commit yields UNKNOWN, never replay, then fresh visit readback', { skip: process.platform !== 'win32' }, async t => {
  const store = await openWindowsProbeStore({ create: true }); t.after(() => store.removeSyntheticStore());
  await store.create('alex-library', example);
  const committed = Promise.withResolvers(), release = Promise.withResolvers(); let writes = 0;
  const f = await fixture(t, { read: store.read, create: store.create,
    edit: async (...args) => { writes++; await store.edit(...args); committed.resolve(); await release.promise; } });
  f.verify(); const client = await f.pair(); const grant = f.host.approveAccess(client.connectionId, 'setup', scope);
  const result = assert.rejects(client.execute(grant, edit), error => error.code === 'WRITE_UNKNOWN');
  await committed.promise; f.end(); release.resolve(); await result; await pending(f.host, 0);
  assert.equal(writes, 1);
  const reopened = await openWindowsProbeStore({ probeId: store.probeId });
  const fresh = await fixture(t, reopened); const next = await fresh.pair();
  await assert.rejects(next.execute(grant, read), denied);
  assert.throws(() => fresh.host.approveAccess(next.connectionId, 'read-only', scope), denied);
  fresh.verify(); const readGrant = fresh.host.approveAccess(next.connectionId, 'read-only', scope);
  assert.deepEqual(await next.execute(readGrant, read), edit.data);
  assert.equal(writes, 1);
});

test('supervisor serves only a neutral status page and closes HTTP and TLS on pipe end without awaiting child exit', async t => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => { child.killed = true; };
  let address = ''; child.stdin.on('data', chunk => { address += chunk; });
  const f = await superviseNativeDirectHost(child, { store: emptyStore(), identity: identities.hostIdentity, ca: identities.ca }, { announce() {} });
  t.after(() => f.close());
  const url = new URL(address.trim());
  assert.equal(url.pathname, '/windows-vault'); assert.equal(url.hash.length, 73);
  const response = await fetch(url); const html = await response.text();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(html, /No records are shown here/); assert.doesNotMatch(html, /button|input|alex-work|sam-school/);
  const invalid = await fetch(new URL('/api/windows-preview', url), { method: 'POST', body: JSON.stringify({ verified: true }) });
  assert.equal(invalid.status, 404);
  assert.throws(() => f.gate.requireVerified(), denied);
  child.stdout.end(); await f.ended; await f.close();
  await assert.rejects(fetch(url));
  await assert.rejects(connectDirectVaultExperiment({ port: f.host.port, identity: identities.phoneIdentity, ca: identities.ca, approvedHostFingerprint: f.host.hostFingerprint }), unavailable);
  assert.equal(child.killed, true);
});

test('native child failure during startup refuses supervision and leaves no verification URL', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => { child.killed = true; }; let bytes = 0; child.stdin.on('data', data => { bytes += data.length; });
  const starting = superviseNativeDirectHost(child, { store: emptyStore(), identity: identities.hostIdentity, ca: identities.ca }, { announce() {} });
  child.emit('exit', 2);
  await assert.rejects(starting, /Native visit ended/);
  assert.equal(bytes, 0); assert.equal(child.killed, true);
});
