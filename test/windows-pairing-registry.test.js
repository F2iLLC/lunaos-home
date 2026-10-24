import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDirectTlsIdentities } from '../scripts/test-fixtures/direct-tls-identities.mjs';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { openWindowsPairingRegistry } from '../lib/windows-pairing-registry.js';
import { startDirectVaultExperiment, connectDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { createLocalEnrollment } from '../lib/local-enrollment.js';

const windows = { skip: process.platform !== 'win32', timeout: 90_000 };
const identities = createDirectTlsIdentities();
after(identities.cleanup);
const example = { memberId: 'alex-example', label: 'Library visit', value: 'Monday' };

test('version-1 registry reads before a pending removal upgrades custody to version 2', windows, async t => {
  const store = await openWindowsProbeStore({ create: true });
  const registry = openWindowsPairingRegistry({ probeId: store.probeId, hostFingerprint: identities.hostIdentity.fingerprint });
  t.after(async () => { await registry.removeSyntheticRegistry(); await store.removeSyntheticStore(); });
  const peer = identities.phoneIdentity.fingerprint;
  const legacyWriter = String.raw`
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json -AsHashtable
    $plain = [Text.Encoding]::UTF8.GetBytes((@{ version = 1; host = $request.host; peers = @($request.peer) } | ConvertTo-Json -Compress))
    try {
      $purpose = [Text.Encoding]::UTF8.GetBytes('LunaOSHome.FictionalPairing.v1:' + $request.probeId)
      $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $purpose, [Security.Cryptography.DataProtectionScope]::CurrentUser)
      [IO.File]::WriteAllBytes($request.file, $cipher)
    } finally { [Array]::Clear($plain, 0, $plain.Length) }
  `;
  execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', legacyWriter], {
    input: JSON.stringify({ probeId: store.probeId, host: identities.hostIdentity.fingerprint,
      peer, file: path.join(store.directory, 'pairing.bin') }), windowsHide: true });
  assert.deepEqual(await registry.inspect(), { peers: [peer], pending: [] });
  await assert.rejects(registry.beginRemoval(identities.outsiderIdentity.fingerprint), /registry unavailable/);
  await registry.beginRemoval(peer);
  await registry.beginRemoval(peer); // Repeating the marker write cannot create a duplicate.
  assert.deepEqual(await registry.inspect(), { peers: [peer], pending: [peer] });
  assert.deepEqual(await registry.load(), []);
  await assert.rejects(registry.add(peer), /registry unavailable/);
  const ciphertext = await readFile(path.join(store.directory, 'pairing.bin'));
  assert.equal(ciphertext.includes(Buffer.from(peer)), false);
  await registry.remove(peer);
  assert.deepEqual(await registry.inspect(), { peers: [], pending: [] });
});

test('protected enrollment resumes after restart with no old grant and revocation survives restart', windows, async t => {
  const store = await openWindowsProbeStore({ create: true, contractVersion: 2 });
  const registry = openWindowsPairingRegistry({ probeId: store.probeId, hostFingerprint: identities.hostIdentity.fingerprint });
  t.after(async () => { await registry.removeSyntheticRegistry(); await store.removeSyntheticStore(); });
  await store.create('alex-library', example);
  const start = () => startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store, pairingRegistry: registry, contractVersion: 2 });
  const connect = (host, offer) => connectDirectVaultExperiment({ port: host.port, identity: identities.phoneIdentity,
    ca: identities.ca, approvedHostFingerprint: host.hostFingerprint, offer });
  const first = await start();
  const offer = first.approvePairing(identities.phoneIdentity.fingerprint);
  const phone = await connect(first, offer.offer);
  const oldGrant = first.approveAccess(phone.connectionId, 'read-only', { recordIds: ['alex-library'], lifetimeMs: 60_000 });
  const read = { version: 2, action: 'read', recordId: 'alex-library' };
  const viewed = await phone.execute(oldGrant, read);
  assert.deepEqual(viewed.data, example);
  phone.close(); await first.close();
  const cipher = await readFile(path.join(store.directory, 'pairing.bin'));
  assert.equal(cipher.includes(Buffer.from(identities.phoneIdentity.fingerprint)), false);
  const second = await start();
  const resumed = await connect(second);
  await assert.rejects(resumed.execute(oldGrant, read), error => error.code === 'DENIED');
  const fresh = second.approveAccess(resumed.connectionId, 'read-only', { recordIds: ['alex-library'], lifetimeMs: 60_000 });
  assert.deepEqual(await resumed.execute(fresh, read), viewed);
  const setup = second.approveAccess(resumed.connectionId, 'setup', { recordIds: ['alex-library'], lifetimeMs: 60_000 });
  const saved = await resumed.execute(setup, { version: 2, action: 'edit', recordId: 'alex-library',
    expectedRevision: viewed.revision, data: { ...example, value: 'Tuesday' } });
  await assert.rejects(resumed.execute(setup, { version: 2, action: 'edit', recordId: 'alex-library',
    expectedRevision: viewed.revision, data: example }),
  error => error.code === 'CONFLICT' && /Review it again/.test(error.message));
  assert.deepEqual(await store.read('alex-library'), { revision: saved.revision, data: { ...example, value: 'Tuesday' } });
  await second.revokePeer(identities.phoneIdentity.fingerprint);
  resumed.close(); await second.close();
  const third = await start();
  await assert.rejects(connect(third), error => error.code === 'DENIED');
  await third.close();
});

test('tamper or changed host identity refuses the registry without overwriting ciphertext', windows, async t => {
  const store = await openWindowsProbeStore({ create: true });
  const registry = openWindowsPairingRegistry({ probeId: store.probeId, hostFingerprint: identities.hostIdentity.fingerprint });
  t.after(async () => { await registry.removeSyntheticRegistry(); await store.removeSyntheticStore(); });
  await registry.add(identities.phoneIdentity.fingerprint);
  const file = path.join(store.directory, 'pairing.bin');
  const committed = await readFile(file);
  const other = openWindowsPairingRegistry({ probeId: store.probeId, hostFingerprint: identities.outsiderIdentity.fingerprint });
  await assert.rejects(other.load(), /registry unavailable/);
  await assert.rejects(startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store, pairingRegistry: other }), /must match/);
  assert.deepEqual(await readFile(file), committed);
  const damaged = Buffer.from(committed); damaged[damaged.length - 1] ^= 1;
  try {
    await writeFile(file, damaged);
    await assert.rejects(registry.load(), /registry unavailable/);
    await assert.rejects(startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store, pairingRegistry: registry }), /registry unavailable/);
    assert.deepEqual(await readFile(file), damaged);
  } finally { await writeFile(file, committed); }
  assert.deepEqual(await registry.load(), [identities.phoneIdentity.fingerprint]);
});

test('failed durable add does not admit a peer or return a successful pairing', windows, async t => {
  const store = await openWindowsProbeStore({ create: true });
  t.after(() => store.removeSyntheticStore());
  const registry = { probeId: store.probeId, hostFingerprint: identities.hostIdentity.fingerprint,
    load: async () => [], add: async () => { throw Error('disk fault'); }, remove: async () => [] };
  const host = await startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store, pairingRegistry: registry });
  t.after(() => host.close());
  const offer = host.approvePairing(identities.phoneIdentity.fingerprint);
  await assert.rejects(connectDirectVaultExperiment({ port: host.port, identity: identities.phoneIdentity,
    ca: identities.ca, approvedHostFingerprint: host.hostFingerprint, offer: offer.offer }),
  error => ['WRITE_UNKNOWN', 'UNAVAILABLE'].includes(error.code));
  assert.equal(host.listConnections().length, 0);
});

test('durable pending removal blocks restart admission until explicit readback and retry', windows, async t => {
  for (const committed of [false, true]) {
    const store = await openWindowsProbeStore({ create: true });
    const durable = openWindowsPairingRegistry({ probeId: store.probeId,
      hostFingerprint: identities.hostIdentity.fingerprint });
    let host, restarted, reenrolled, phone, nextPhone;
    t.after(async () => {
      phone?.close(); nextPhone?.close();
      try { await reenrolled?.close(); }
      finally {
        try { await restarted?.close(); }
        finally {
          try { await host?.close(); }
          finally {
            try { await durable.removeSyntheticRegistry(); }
            finally { await store.removeSyntheticStore(); }
          }
        }
      }
    });
    let removals = 0;
    const registry = { ...durable, remove: async fingerprint => {
      removals++;
      if (committed) await durable.remove(fingerprint);
      throw Error('fictional lost removal receipt');
    } };
    const start = selected => startDirectVaultExperiment({ identity: identities.hostIdentity,
      ca: identities.ca, store, pairingRegistry: selected });
    host = await start(registry);
    const control = createLocalEnrollment(host, { pairingRegistry: registry });
    const offer = control.decide({ ...control.review(identities.phoneIdentity.fingerprint), allow: true });
    phone = await connectDirectVaultExperiment({ port: host.port, identity: identities.phoneIdentity,
      ca: identities.ca, approvedHostFingerprint: host.hostFingerprint, offer: offer.offer });
    assert.deepEqual(await durable.load(), [identities.phoneIdentity.fingerprint]);
    assert.deepEqual(await control.removeDevice(identities.phoneIdentity.fingerprint),
      { peerFingerprint: identities.phoneIdentity.fingerprint, removal: 'uncertain' });
    assert.deepEqual(host.listPairedPeers(), []);
    assert.deepEqual(await control.reconcileRemoval(identities.phoneIdentity.fingerprint),
      { peerFingerprint: identities.phoneIdentity.fingerprint, removal: committed ? 'confirmed' : 'uncertain',
        ...(!committed && { custody: 'quarantined' }) });
    assert.equal(removals, 1);
    control.close();
    phone.close();
    await host.close();
    host = undefined;
    restarted = await start(durable);
    assert.deepEqual(restarted.listPairedPeers(), []);
    assert.deepEqual(restarted.listPendingRemovals(), committed ? [] : [identities.phoneIdentity.fingerprint]);
    const restartedControl = createLocalEnrollment(restarted, { pairingRegistry: durable });
    if (!committed) {
      assert.deepEqual(restartedControl.enrolledDevices(), [
        { peerFingerprint: identities.phoneIdentity.fingerprint, removal: 'uncertain', custody: 'quarantined' }]);
      assert.throws(() => restarted.approvePairing(identities.phoneIdentity.fingerprint), { code: 'DENIED' });
      await assert.rejects(connectDirectVaultExperiment({ port: restarted.port, identity: identities.phoneIdentity,
        ca: identities.ca, approvedHostFingerprint: restarted.hostFingerprint }), { code: 'DENIED' });
      assert.deepEqual(await restartedControl.reconcileRemoval(identities.phoneIdentity.fingerprint),
        { peerFingerprint: identities.phoneIdentity.fingerprint, removal: 'uncertain', custody: 'quarantined' });
      assert.deepEqual(await restartedControl.retryRemoval(identities.phoneIdentity.fingerprint),
        { peerFingerprint: identities.phoneIdentity.fingerprint, removal: 'confirmed' });
      assert.throws(() => restarted.approvePairing(identities.phoneIdentity.fingerprint), { code: 'DENIED' });
    }
    restartedControl.close();
    await restarted.close();
    restarted = undefined;
    assert.deepEqual(await durable.inspect(), { peers: [], pending: [] });
    reenrolled = await start(durable);
    const newReview = createLocalEnrollment(reenrolled, { pairingRegistry: durable });
    const newOffer = newReview.decide({ ...newReview.review(identities.phoneIdentity.fingerprint), allow: true });
    nextPhone = await connectDirectVaultExperiment({ port: reenrolled.port, identity: identities.phoneIdentity,
      ca: identities.ca, approvedHostFingerprint: reenrolled.hostFingerprint, offer: newOffer.offer });
    assert.deepEqual(reenrolled.listPairedPeers(), [identities.phoneIdentity.fingerprint]);
    newReview.close();
  }
});

test('lost pending-marker receipt distinguishes quarantine from restart access still possible', windows, async t => {
  for (const markerCommitted of [false, true]) {
    const store = await openWindowsProbeStore({ create: true });
    const durable = openWindowsPairingRegistry({ probeId: store.probeId,
      hostFingerprint: identities.hostIdentity.fingerprint });
    let host, restarted;
    t.after(async () => {
      try { await restarted?.close(); }
      finally {
        try { await host?.close(); }
        finally {
          try { await durable.removeSyntheticRegistry(); }
          finally { await store.removeSyntheticStore(); }
        }
      }
    });
    const peer = identities.phoneIdentity.fingerprint;
    await durable.add(peer);
    const registry = { ...durable, beginRemoval: async fingerprint => {
      if (markerCommitted) await durable.beginRemoval(fingerprint);
      throw Error('fictional lost pending-marker receipt');
    } };
    const start = selected => startDirectVaultExperiment({ identity: identities.hostIdentity,
      ca: identities.ca, store, pairingRegistry: selected });
    host = await start(registry);
    const control = createLocalEnrollment(host, { pairingRegistry: registry });
    assert.deepEqual(await control.removeDevice(peer), { peerFingerprint: peer, removal: 'uncertain' });
    assert.deepEqual(await control.reconcileRemoval(peer), { peerFingerprint: peer, removal: 'uncertain',
      custody: markerCommitted ? 'quarantined' : 'restart-access-possible' });
    control.close();
    await host.close(); host = undefined;
    restarted = await start(durable);
    assert.deepEqual(restarted.listPairedPeers(), markerCommitted ? [] : [peer]);
    assert.deepEqual(restarted.listPendingRemovals(), markerCommitted ? [peer] : []);
  }
});
