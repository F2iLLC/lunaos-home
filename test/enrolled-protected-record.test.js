import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createLocalEnrollment } from '../lib/local-enrollment.js';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { startDirectVaultExperiment, connectDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { createDirectTlsIdentities } from '../scripts/test-fixtures/direct-tls-identities.mjs';
import { openHostApprovalConsole } from '../scripts/test-fixtures/host-approval-console.mjs';

const fixtures = createDirectTlsIdentities();
after(fixtures.cleanup);
const record = { memberId: 'alex-example', label: 'Library visit', value: 'Monday' };
const read = { action: 'read', recordId: 'alex-library' };
const code = expected => error => error.code === expected;
async function setup(t, store, now) {
  const host = await startDirectVaultExperiment({ identity: fixtures.hostIdentity, ca: fixtures.ca, store });
  const control = createLocalEnrollment(host, { now });
  t.after(async () => { control.close(); await host.close(); });
  const connect = async (offer, identity = fixtures.phoneIdentity) => {
    const client = await connectDirectVaultExperiment({ port: host.port, identity, ca: fixtures.ca, approvedHostFingerprint: host.hostFingerprint, offer, requestTimeoutMs: 10_000 });
    t.after(() => client.close()); return client;
  };
  const approve = () => control.decide({ ...control.review(fixtures.phoneIdentity.fingerprint), allow: true });
  return { host, control, connect, approve };
}

test('local review is separate from TLS trust and refuses denied, mismatched, cancelled and expired decisions', async t => {
  let tick = 0, reads = 0;
  const { host, control, connect, approve } = await setup(t, { read: async () => { reads++; return record; }, create() {}, edit() {} }, () => tick);
  await assert.rejects(connect(), code('DENIED'));
  for (const decision of ['deny', 'peer', 'host', 'cancel', 'expire']) {
    const review = control.review(fixtures.phoneIdentity.fingerprint);
    const answer = { ...review, allow: true };
    if (decision === 'deny') answer.allow = false;
    if (decision === 'peer') answer.peerFingerprint = fixtures.outsiderIdentity.fingerprint;
    if (decision === 'host') answer.hostFingerprint = fixtures.outsiderIdentity.fingerprint;
    if (decision === 'cancel') control.cancel(review.requestId);
    if (decision === 'expire') tick += 60_000;
    assert.throws(() => control.decide(answer), code('DENIED'));
    assert.throws(() => control.decide({ ...review, allow: true }), code('DENIED'));
    assert.equal(host.listConnections().length, 0);
  }
  const accepted = approve();
  await assert.rejects(connect(accepted.offer, fixtures.outsiderIdentity), code('DENIED'));
  const client = await connect(accepted.offer);
  await assert.rejects(client.execute(crypto.randomUUID(), read), code('DENIED'));
  assert.throws(() => control.approveRead({ connectionId: client.connectionId, peerFingerprint: fixtures.outsiderIdentity.fingerprint }), code('DENIED'));
  const grant = control.approveRead({ connectionId: client.connectionId, peerFingerprint: fixtures.phoneIdentity.fingerprint });
  assert.deepEqual(await client.execute(grant, read), record);
  assert.equal(reads, 1);
  tick--;
  assert.throws(() => control.review(fixtures.phoneIdentity.fingerprint), code('DENIED'));
});

test('removing a device invalidates its pending pairing review', async t => {
  const { host, control, connect, approve } = await setup(t, { read: async () => record, create() {}, edit() {} });
  const first = await connect(approve().offer);
  const stale = control.review(fixtures.phoneIdentity.fingerprint);
  host.revokePeer(fixtures.phoneIdentity.fingerprint);
  await assert.rejects(first.execute(crypto.randomUUID(), read), code('UNAVAILABLE'));
  assert.throws(() => control.decide({ ...stale, allow: true }), code('DENIED'));
  assert.throws(() => control.decide({ ...stale, allow: true }), code('DENIED'));
  const fresh = control.review(fixtures.phoneIdentity.fingerprint);
  await connect(control.decide({ ...fresh, allow: true }).offer);
});

test('local terminal displays exact identities and scope, with deny as the default', async () => {
  const input = new PassThrough(), output = new PassThrough(); let display = '';
  output.on('data', chunk => { display += chunk; });
  const console = openHostApprovalConsole({ input, output, synthetic: true });
  try {
    const review = { requestId: 'review', peerFingerprint: fixtures.phoneIdentity.fingerprint, hostFingerprint: fixtures.hostIdentity.fingerprint };
    const ready = console.readyForEnrollment(); input.write('\n');
    assert.equal(await ready, true);
    const denied = console.enrollment(review); input.write('no\n');
    assert.deepEqual(await denied, { ...review, allow: false });
    const accepted = console.enrollment(review); input.write('allow\n');
    assert.deepEqual(await accepted, { ...review, allow: true });
    const scoped = console.read({ peerFingerprint: review.peerFingerprint, connectionId: 'selected-connection' }); input.write('allow\n');
    assert.equal(await scoped, true);
    assert.ok(display.includes(review.peerFingerprint) && display.includes(review.hostFingerprint));
    assert.match(display, /Press Enter to start the 60-second identity review/);
    assert.match(display, /selected-connection/); assert.match(display, /Alex \/ Library visit read-only for 60 seconds/);
    console.devices([{ peerFingerprint: review.peerFingerprint, removal: 'enrolled' }]);
    assert.match(display, new RegExp(`${review.peerFingerprint}: enrolled`));
    const remove = console.removal(review.peerFingerprint); input.write('remove\n');
    assert.equal(await remove, true);
    const eof = console.read({ peerFingerprint: review.peerFingerprint, connectionId: 'closed-input' });
    input.end(); assert.equal(await eof, false);
  } finally { console.close(); }
});

test('TLS reads the reopened DPAPI record and refuses stale grants, writes, tamper and unavailable storage', { skip: process.platform !== 'win32' }, async t => {
  let store = await openWindowsProbeStore({ create: true });
  await store.create('alex-library', record);
  const changed = { ...record, value: 'Thursday from protected storage' };
  await store.edit('alex-library', changed);
  store = await openWindowsProbeStore({ probeId: store.probeId });
  const { control, connect, approve } = await setup(t, store);
  t.after(() => store.removeSyntheticStore());
  const client = await connect(approve().offer);
  const grant = control.approveRead({ connectionId: client.connectionId, peerFingerprint: fixtures.phoneIdentity.fingerprint });
  assert.deepEqual(await client.execute(grant, read), changed);
  for (const action of ['edit', 'create', 'delete']) await assert.rejects(client.execute(grant, { action, recordId: 'alex-library', ...(action === 'delete' ? {} : { data: record }) }), code('DENIED'));
  client.close();
  const next = await connect();
  await assert.rejects(next.execute(grant, read), code('DENIED'));
  const fresh = control.approveRead({ connectionId: next.connectionId, peerFingerprint: fixtures.phoneIdentity.fingerprint });
  const file = path.join(store.directory, 'records.bin'), bytes = await readFile(file);
  assert.equal(bytes.includes(Buffer.from(changed.value)), false);
  const damaged = Buffer.from(bytes); damaged[Math.floor(damaged.length / 2)] ^= 1;
  try {
    await writeFile(file, damaged);
    await assert.rejects(next.execute(fresh, read), code('READ_FAILED'));
    assert.deepEqual(await readFile(file), damaged);
  } finally { await writeFile(file, bytes); }
  await rename(file, file + '.held');
  try { await assert.rejects(next.execute(fresh, read), code('READ_FAILED')); }
  finally { await rename(file + '.held', file); }
  assert.deepEqual(await next.execute(fresh, read), changed);
});

test('lost acknowledgement of a real encrypted commit is unknown and never replayed', { skip: process.platform !== 'win32' }, async t => {
  const store = await openWindowsProbeStore({ create: true });
  await store.create('alex-library', record); let writes = 0;
  const { host, connect, approve } = await setup(t, {
    lifecycleStore: store, read: id => store.read(id), create: (id, data) => store.create(id, data),
    edit: async (id, data) => { writes++; await store.edit(id, data); throw Error('Synthetic lost acknowledgement'); },
  });
  t.after(() => store.removeSyntheticStore());
  const client = await connect(approve().offer);
  // Privileged fault-injection test only; the enrollment controller offers read-only.
  const grant = host.approveAccess(client.connectionId, 'setup', { recordIds: ['alex-library'], lifetimeMs: 60_000 });
  await assert.rejects(client.execute(grant, { action: 'edit', recordId: 'alex-library', data: { ...record, value: 'Committed once' } }), code('WRITE_UNKNOWN'));
  const next = await connect();
  await assert.rejects(next.execute(grant, read), code('DENIED'));
  const fresh = host.approveAccess(next.connectionId, 'read-only', { recordIds: ['alex-library'], lifetimeMs: 60_000 });
  assert.equal((await next.execute(fresh, read)).value, 'Committed once');
  assert.equal(writes, 1);
});
