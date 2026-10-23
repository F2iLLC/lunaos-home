import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalEnrollment } from '../lib/local-enrollment.js';
import { startDirectVaultExperiment, connectDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { createDirectTlsIdentities } from '../scripts/test-fixtures/direct-tls-identities.mjs';

const identities = createDirectTlsIdentities();
after(identities.cleanup);
const peer = identities.phoneIdentity.fingerprint;
const pause = () => { const d = Promise.withResolvers(); return d; };
const store = () => ({ probeId: crypto.randomUUID(), read: async () => ({ memberId: 'alex-example', label: 'Library', value: 'Monday' }),
  create: async () => {}, edit: async () => {} });
const connect = (host, offer) => connectDirectVaultExperiment({ port: host.port, identity: identities.phoneIdentity,
  ca: identities.ca, approvedHostFingerprint: host.hostFingerprint, offer, requestTimeoutMs: 10_000 });
const reviewOffer = control => control.decide({ ...control.review(peer), allow: true }).offer;
const waitFor = async predicate => {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, 'Expected the injected operation to start');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

test('enrollment is durable before success; one-use offers reject replay', async t => {
  const adapter = store(); const commit = pause(); let entered = false; const peers = new Set();
  const registry = { probeId: adapter.probeId, hostFingerprint: identities.hostIdentity.fingerprint,
    load: async () => [...peers], add: async value => { entered = true; await commit.promise; peers.add(value); },
    remove: async value => { peers.delete(value); } };
  const host = await startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store: adapter, pairingRegistry: registry });
  t.after(() => host.close());
  const control = createLocalEnrollment(host, { pairingRegistry: registry });
  const offered = reviewOffer(control);
  const first = connect(host, offered); await waitFor(() => entered);
  assert.deepEqual(control.enrolledDevices(), []);
  await assert.rejects(connect(host, offered), { code: 'DENIED' });
  commit.resolve(); const phone = await first; t.after(() => phone.close());
  assert.deepEqual(control.enrolledDevices(), [{ peerFingerprint: peer, removal: 'enrolled' }]);
  assert.deepEqual([...peers], [peer]);
});

test('ambiguous removal closes access and requires registry readback', async t => {
  const other = 'a'.repeat(64);
  for (const committed of [false, true]) {
    const adapter = store(); const peers = new Set([other]); let reads = 0;
    const registry = { probeId: adapter.probeId, hostFingerprint: identities.hostIdentity.fingerprint,
      load: async () => { reads++; return [...peers]; }, add: async value => { peers.add(value); },
      remove: async value => { if (committed) peers.delete(value); throw Error('lost removal receipt'); } };
    const host = await startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store: adapter, pairingRegistry: registry });
    t.after(() => host.close());
    const control = createLocalEnrollment(host, { pairingRegistry: registry });
    const phone = await connect(host, reviewOffer(control)); t.after(() => phone.close());
    const outcome = await control.removeDevice(peer);
    assert.deepEqual(outcome, { peerFingerprint: peer, removal: 'uncertain' });
    assert.deepEqual(control.enrolledDevices(), [outcome]);
    await assert.rejects(phone.execute(crypto.randomUUID(), { action: 'read', recordId: 'alex-library' }),
      error => ['DENIED', 'UNAVAILABLE'].includes(error.code));
    assert.deepEqual(await control.reconcileRemoval(peer), { peerFingerprint: peer, removal: committed ? 'confirmed' : 'uncertain' });
    assert.deepEqual(control.enrolledDevices(), [
      { peerFingerprint: peer, removal: committed ? 'confirmed' : 'uncertain' },
      { peerFingerprint: other, removal: 'enrolled' },
    ].sort((a, b) => a.peerFingerprint.localeCompare(b.peerFingerprint)));
    assert.deepEqual(host.listPairedPeers(), []); // Readback restores the management inventory, not host access.
    assert.equal(reads, 2); // Startup plus explicit reconciliation; no automatic retry.
  }
});

test('explicit retry needs a fresh readback showing the peer still enrolled', async t => {
  const adapter = store(); const peers = new Set(); const retryCommit = pause();
  let removes = 0; let reads = 0; let retryEntered = false;
  const registry = { probeId: adapter.probeId, hostFingerprint: identities.hostIdentity.fingerprint,
    load: async () => { reads++; return [...peers]; }, add: async value => { peers.add(value); },
    remove: async value => { removes++; if (removes === 1) throw Error('write did not commit');
      retryEntered = true; await retryCommit.promise; peers.delete(value); } };
  const host = await startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store: adapter, pairingRegistry: registry });
  t.after(() => host.close());
  const control = createLocalEnrollment(host, { pairingRegistry: registry });
  const phone = await connect(host, reviewOffer(control)); t.after(() => phone.close());
  assert.deepEqual(await control.removeDevice(peer), { peerFingerprint: peer, removal: 'uncertain' });
  await assert.rejects(control.retryRemoval(peer), { code: 'DENIED' });
  assert.deepEqual(await control.reconcileRemoval(peer), { peerFingerprint: peer, removal: 'uncertain' });
  assert.deepEqual(control.enrolledDevices(), [{ peerFingerprint: peer, removal: 'uncertain' }]);
  const retried = control.retryRemoval(peer);
  await waitFor(() => retryEntered);
  await assert.rejects(control.retryRemoval(peer), { code: 'DENIED' });
  await assert.rejects(control.reconcileRemoval(peer), { code: 'DENIED' });
  retryCommit.resolve();
  assert.deepEqual(await retried, { peerFingerprint: peer, removal: 'confirmed' });
  assert.deepEqual(control.enrolledDevices(), [{ peerFingerprint: peer, removal: 'confirmed' }]);
  await assert.rejects(control.retryRemoval(peer), { code: 'DENIED' });
  assert.deepEqual([...peers], []);
  assert.equal(removes, 2);
  assert.equal(reads, 2);
  await assert.rejects(connect(host), { code: 'UNAVAILABLE' });
});

test('re-enrollment reports the live peer instead of a stale removal', async t => {
  const other = 'a'.repeat(64);
  const adapter = store(); const peers = new Set([other]);
  const registry = { probeId: adapter.probeId, hostFingerprint: identities.hostIdentity.fingerprint,
    load: async () => [...peers], add: async value => { peers.add(value); },
    remove: async value => { peers.delete(value); if (value === other) throw Error('lost removal receipt'); } };
  const host = await startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store: adapter, pairingRegistry: registry });
  t.after(() => host.close());
  const control = createLocalEnrollment(host, { pairingRegistry: registry });
  const first = await connect(host, reviewOffer(control)); t.after(() => first.close());
  assert.deepEqual(await control.removeDevice(peer), { peerFingerprint: peer, removal: 'confirmed' });
  const second = await connect(host, reviewOffer(control)); t.after(() => second.close());
  assert.deepEqual(control.enrolledDevices().find(device => device.peerFingerprint === peer),
    { peerFingerprint: peer, removal: 'enrolled' });
  assert.deepEqual(await control.removeDevice(other), { peerFingerprint: other, removal: 'uncertain' });
  assert.deepEqual(await control.reconcileRemoval(other), { peerFingerprint: other, removal: 'confirmed' });
  assert.deepEqual(control.enrolledDevices(), [{ peerFingerprint: peer, removal: 'enrolled' },
    { peerFingerprint: other, removal: 'confirmed' }].sort((a, b) => a.peerFingerprint.localeCompare(b.peerFingerprint)));
  assert.deepEqual(host.listPairedPeers(), []);
});

test('close invalidates every device-state method with default access control', async () => {
  let calls = 0;
  const host = { listPairedPeers: () => { calls++; return [peer]; } };
  const registry = { load: async () => [peer] };
  const control = createLocalEnrollment(host, { pairingRegistry: registry });
  control.close();
  assert.throws(() => control.cancel('unused'), { code: 'DENIED' });
  assert.throws(() => control.enrolledDevices(), { code: 'DENIED' });
  await assert.rejects(control.removeDevice(peer), { code: 'DENIED' });
  await assert.rejects(control.reconcileRemoval(peer), { code: 'DENIED' });
  await assert.rejects(control.retryRemoval(peer), { code: 'DENIED' });
  assert.equal(calls, 0);
});

test('lost pairing receipt is WRITE_UNKNOWN; restart reads custody without replaying offer', async t => {
  const adapter = store(); const peers = new Set(); let adds = 0;
  const registry = { probeId: adapter.probeId, hostFingerprint: identities.hostIdentity.fingerprint,
    load: async () => [...peers], add: async value => { adds++; peers.add(value); throw Error('lost receipt'); },
    remove: async value => { peers.delete(value); } };
  const first = await startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store: adapter, pairingRegistry: registry });
  const control = createLocalEnrollment(first, { pairingRegistry: registry });
  await assert.rejects(connect(first, reviewOffer(control)), { code: 'WRITE_UNKNOWN' });
  assert.deepEqual(first.listPairedPeers(), []);
  await first.close();
  const second = await startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store: adapter, pairingRegistry: registry });
  t.after(() => second.close());
  const phone = await connect(second); t.after(() => phone.close());
  assert.equal(adds, 1);
  assert.deepEqual(second.listPairedPeers(), [peer]);
  assert.equal(phone.hostFingerprint, identities.hostIdentity.fingerprint);
});

test('concurrent removal invalidates an in-flight admission and old reviews', async t => {
  const adapter = store(); const commit = pause(); let entered = false; const peers = new Set();
  const registry = { probeId: adapter.probeId, hostFingerprint: identities.hostIdentity.fingerprint,
    load: async () => [...peers], add: async value => { entered = true; await commit.promise; peers.add(value); },
    remove: async value => { peers.delete(value); } };
  const host = await startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store: adapter, pairingRegistry: registry });
  t.after(() => host.close());
  const control = createLocalEnrollment(host, { pairingRegistry: registry });
  const offer = reviewOffer(control); const joining = connect(host, offer);
  await waitFor(() => entered);
  const stale = control.review(peer);
  // The privileged host can revoke while a pair commit is still pending.
  const removing = host.revokePeer(peer);
  assert.throws(() => control.decide({ ...stale, allow: true }), { code: 'DENIED' });
  commit.resolve(); await removing;
  await assert.rejects(joining, error => ['DENIED', 'UNAVAILABLE'].includes(error.code));
  assert.deepEqual([...peers], []);
  assert.deepEqual(host.listPairedPeers(), []);
});
