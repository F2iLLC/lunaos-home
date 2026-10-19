import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createDirectTlsIdentities } from '../scripts/test-fixtures/direct-tls-identities.mjs';
import tls from 'node:tls';
import { once } from 'node:events';
import { certificateFingerprint, startDirectVaultExperiment, connectDirectVaultExperiment, DirectVaultError } from '../lib/direct-vault-tls.js';

const fixtures = createDirectTlsIdentities();
const { ca, hostIdentity, phoneIdentity, outsiderIdentity, untrustedIdentity } = fixtures;
after(fixtures.cleanup);
const alex = { memberId: 'alex-example', label: 'Library visit', value: 'Monday' };
const sam = { memberId: 'sam-example', label: 'Library visit', value: 'Tuesday' };
const scope = { recordIds: ['alex-library', 'sam-library'], lifetimeMs: 60_000 };
const readAlex = { action: 'read', recordId: 'alex-library' };
const editAlex = { action: 'edit', recordId: 'alex-library', data: { ...alex, value: 'Wednesday' } };
const isCode = code => error => error instanceof DirectVaultError && error.code === code;
async function setup(t, options = {}) {
  const rows = new Map([['alex-library', alex], ['sam-library', sam]]);
  const writes = [];
  const store = {
    read: async id => rows.get(id),
    create: async (id, data) => { writes.push(id); if (rows.has(id)) throw Error(); rows.set(id, data); },
    edit: async (id, data) => { writes.push(id); if (!rows.has(id)) throw Error(); rows.set(id, data); },
  };
  const host = await startDirectVaultExperiment({ identity: hostIdentity, ca, store, ...options });
  t.after(() => host.close());
  async function connect({ identity = phoneIdentity, offer, ...other } = {}) {
    const client = await connectDirectVaultExperiment({ port: host.port, identity, ca, approvedHostFingerprint: host.hostFingerprint, offer, ...other });
    t.after(() => client.close()); return client;
  }
  async function pair() { return connect(host.approvePairing(phoneIdentity.fingerprint)); }
  return { host, connect, pair, rows, writes, store };
}

test('TLS1.3 pairing authenticates identities but grants no record access', async t => {
  const { host, pair, writes } = await setup(t);
  const client = await pair();
  assert.equal(client.protocol, 'TLSv1.3');
  assert.equal(client.hostFingerprint, hostIdentity.fingerprint);
  assert.deepEqual(host.listConnections(), [{ connectionId: client.connectionId, peerFingerprint: phoneIdentity.fingerprint }]);
  await assert.rejects(client.execute(crypto.randomUUID(), readAlex), isCode('DENIED'));
  const received = client.nextApproval();
  host.approveAccess(client.connectionId, 'read-only', scope);
  const receipt = await received;
  assert.deepEqual(receipt.recordIds, scope.recordIds);
  assert.equal(receipt.mode, 'read-only');
  const grant = receipt.grantId; // Obtained over TLS, not copied from the controller return value.
  assert.deepEqual(await client.execute(grant, readAlex), alex);
  assert.deepEqual(await client.execute(grant, { action: 'read', recordId: 'sam-library' }), sam);
  await assert.rejects(client.execute(grant, editAlex), isCode('DENIED'));
  await assert.rejects(client.execute(grant, { action: 'delete', recordId: 'alex-library' }), isCode('DENIED'));
  assert.equal(writes.length, 0);
});

test('trusted CA does not admit an unapproved certificate or permit a stolen offer', async t => {
  const { host, connect } = await setup(t);
  await assert.rejects(connect({ identity: outsiderIdentity }), isCode('DENIED'));
  const approved = host.approvePairing(phoneIdentity.fingerprint);
  await assert.rejects(connect({ ...approved, identity: outsiderIdentity }), isCode('DENIED'));
  const client = await connect(approved); // Failed wrong-identity use did not burn the correct offer.
  assert.ok(client.connectionId);
  await assert.rejects(connect(approved), isCode('DENIED')); // One use only.
});

test('client requires approved host pin, valid host name and CA trust', async t => {
  const { host, connect } = await setup(t);
  const offer = host.approvePairing(phoneIdentity.fingerprint);
  await assert.rejects(connect({ ...offer, approvedHostFingerprint: outsiderIdentity.fingerprint }), isCode('DENIED'));
  await assert.rejects(connect({ ...offer, servername: 'wrong.invalid' }), isCode('UNAVAILABLE'));
  await assert.rejects(connect({ ...offer, ca: outsiderIdentity.cert }), isCode('UNAVAILABLE'));
  assert.ok((await connect(offer)).connectionId);
});

test('TLS refuses missing client certificates before any application response', async t => {
  const { host } = await setup(t);
  const socket = tls.connect({ host: '127.0.0.1', port: host.port, servername: 'localhost', ca, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' });
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  let response = '', timedOut = false;
  socket.on('data', data => { response += data; });
  const timeout = setTimeout(() => { timedOut = true; socket.destroy(); }, 2000);
  await new Promise(resolve => socket.once('close', resolve)); clearTimeout(timeout);
  assert.equal(timedOut, false); assert.equal(response, '');
});

test('server TLS rejects a client certificate from an independently untrusted issuer', async t => {
  const { host, connect } = await setup(t);
  const approved = host.approvePairing(certificateFingerprint(untrustedIdentity.cert));
  await assert.rejects(connect({ ...approved, identity: untrustedIdentity }), isCode('UNAVAILABLE'));
});

test('pairing expires at its deadline, can be cancelled and fails on clock rollback', async t => {
  let tick = 0;
  const { host, connect } = await setup(t, { now: () => tick });
  const expired = host.approvePairing(phoneIdentity.fingerprint, 50);
  tick = 50;
  await assert.rejects(connect(expired), isCode('DENIED'));
  const cancelled = host.approvePairing(phoneIdentity.fingerprint);
  host.cancelPairing(cancelled.offer);
  await assert.rejects(connect(cancelled), isCode('DENIED'));
  tick = 49;
  assert.throws(() => host.approvePairing(phoneIdentity.fingerprint), isCode('DENIED'));
});

test('new TLS connection never inherits a grant; revoke and host restart require admission again', async t => {
  const { host, pair, connect, store } = await setup(t);
  const first = await pair();
  const old = host.approveAccess(first.connectionId, 'setup', scope);
  first.close();
  const next = await connect();
  await assert.rejects(next.execute(old, editAlex), isCode('DENIED'));
  const fresh = host.approveAccess(next.connectionId, 'read-only', scope);
  assert.deepEqual(await next.execute(fresh, readAlex), alex);
  host.revokePeer(phoneIdentity.fingerprint);
  await assert.rejects(next.execute(fresh, readAlex));
  await assert.rejects(connect(), isCode('DENIED'));
  const restarted = await startDirectVaultExperiment({ identity: hostIdentity, ca, store });
  t.after(() => restarted.close());
  await assert.rejects(connectDirectVaultExperiment({ port: restarted.port, identity: phoneIdentity, ca, approvedHostFingerprint: hostIdentity.fingerprint }), isCode('DENIED'));
});

test('expiry and explicit grant revocation apply to actual TLS operations', async t => {
  let tick = 0;
  const { host, pair } = await setup(t, { now: () => tick });
  const client = await pair();
  const expired = host.approveAccess(client.connectionId, 'read-only', { ...scope, lifetimeMs: 50 });
  tick = 50;
  await assert.rejects(client.execute(expired, readAlex), isCode('DENIED'));
  const revoked = host.approveAccess(client.connectionId, 'setup', scope);
  host.revokeGrant(revoked);
  await assert.rejects(client.execute(revoked, editAlex), isCode('DENIED'));
});

test('disconnect during a held read drops late content and blocks queued edits', async t => {
  const { host, pair, connect, store, writes } = await setup(t);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  store.read = async () => { entered.resolve(); await release.promise; return alex; };
  const client = await pair();
  const grant = host.approveAccess(client.connectionId, 'setup', scope);
  const reading = assert.rejects(client.execute(grant, readAlex), isCode('UNAVAILABLE'));
  await entered.promise;
  const writing = assert.rejects(client.execute(grant, editAlex), isCode('WRITE_UNKNOWN'));
  client.close();
  await Promise.all([reading, writing]);
  release.resolve();
  const next = await connect();
  await assert.rejects(next.execute(grant, readAlex), isCode('DENIED'));
  const fresh = host.approveAccess(next.connectionId, 'read-only', scope);
  assert.deepEqual(await next.execute(fresh, readAlex), alex);
  assert.equal(writes.length, 0);
});

test('lost acknowledgement after commit is unknown; reconnect permits review, never replays', async t => {
  const { host, connect, store, rows, writes } = await setup(t);
  const committed = Promise.withResolvers(), release = Promise.withResolvers();
  store.edit = async (id, data) => { writes.push(id); rows.set(id, data); committed.resolve(); await release.promise; };
  const client = await connect({ ...host.approvePairing(phoneIdentity.fingerprint), requestTimeoutMs: 200 });
  const grant = host.approveAccess(client.connectionId, 'setup', scope);
  const writing = assert.rejects(client.execute(grant, editAlex), isCode('WRITE_UNKNOWN'));
  await committed.promise;
  await writing;
  release.resolve();
  const next = await connect();
  await assert.rejects(next.execute(grant, editAlex), isCode('DENIED'));
  const fresh = host.approveAccess(next.connectionId, 'read-only', scope);
  assert.deepEqual(await next.execute(fresh, readAlex), editAlex.data);
  assert.equal(writes.length, 1);
});

test('store acknowledgement failure closes authority and never exposes adapter diagnostics', async t => {
  const { host, pair, connect, store } = await setup(t);
  store.edit = async () => { throw Error('private-adapter-diagnostic'); };
  const client = await pair();
  const grant = host.approveAccess(client.connectionId, 'setup', scope);
  await assert.rejects(client.execute(grant, editAlex), error => isCode('WRITE_UNKNOWN')(error) && !error.message.includes('private-adapter'));
  const next = await connect();
  await assert.rejects(next.execute(grant, readAlex), isCode('DENIED'));
});

test('peer revocation while a read is held suppresses its response and queued writes', async t => {
  const { host, pair, store, writes, connect } = await setup(t);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  store.read = async () => { entered.resolve(); await release.promise; return alex; };
  const client = await pair();
  const grant = host.approveAccess(client.connectionId, 'setup', scope);
  const reading = assert.rejects(client.execute(grant, readAlex), isCode('UNAVAILABLE'));
  await entered.promise;
  const writing = assert.rejects(client.execute(grant, editAlex), isCode('WRITE_UNKNOWN'));
  host.revokePeer(phoneIdentity.fingerprint);
  await Promise.all([reading, writing]); release.resolve();
  await assert.rejects(connect(), isCode('DENIED'));
  assert.equal(writes.length, 0);
});

test('idle disconnect and unavailable host do not report successful access', async t => {
  const { host, pair, connect } = await setup(t, { idleMs: 100 });
  const client = await pair();
  const grant = host.approveAccess(client.connectionId, 'read-only', scope);
  await new Promise(resolve => setTimeout(resolve, 200));
  await assert.rejects(client.execute(grant, readAlex), isCode('UNAVAILABLE'));
  const next = await connect();
  await assert.rejects(next.execute(grant, readAlex), isCode('DENIED'));
  await host.close();
  await assert.rejects(connect(), isCode('UNAVAILABLE'));
});

test('wire protocol has no approval/device-ID methods and rejects oversized or replayed frames', async t => {
  const { host } = await setup(t);
  async function raw(payload) {
    const socket = tls.connect({ host: '127.0.0.1', port: host.port, servername: 'localhost', key: phoneIdentity.key, cert: phoneIdentity.cert, ca, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' });
    socket.on('error', () => {});
    t.after(() => socket.destroy());
    await once(socket, 'secureConnect');
    const closed = new Promise(resolve => socket.once('close', resolve));
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; socket.destroy(); }, 2000);
    let response = ''; socket.on('data', data => { response += data; });
    socket.write(payload);
    await closed; clearTimeout(timeout); assert.equal(timedOut, false); return response;
  }
  assert.equal(await raw(JSON.stringify({ seq: 1, op: 'approveAccess', deviceId: 'spoofed' }) + '\n'), '');
  assert.equal(await raw(JSON.stringify({ seq: 1, op: 'resume', deviceId: 'spoofed' }) + '\n'), '');
  assert.equal(await raw('x'.repeat(8193)), '');
  const offer = host.approvePairing(phoneIdentity.fingerprint).offer;
  const frame = JSON.stringify({ seq: 1, op: 'pair', offer }) + '\n';
  assert.equal(await raw(frame + frame), ''); // duplicate rejected before pending work executes
});
