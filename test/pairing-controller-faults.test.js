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
  for (const committed of [false, true]) {
    const adapter = store(); const peers = new Set(); let reads = 0;
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
    assert.equal(reads, 2); // Startup plus explicit reconciliation; no automatic retry.
  }
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
