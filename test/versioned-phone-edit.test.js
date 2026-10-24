import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createLocalEnrollment } from '../lib/local-enrollment.js';
import { startDirectVaultExperiment, connectDirectVaultExperiment } from '../lib/direct-vault-tls.js';
import { VaultConflictError } from '../lib/vault-record-contract.js';
import { createDirectTlsIdentities } from '../scripts/test-fixtures/direct-tls-identities.mjs';
import { openHostApprovalConsole } from '../scripts/test-fixtures/host-approval-console.mjs';

const identities = createDirectTlsIdentities();
after(identities.cleanup);
const data = { memberId: 'alex-example', label: 'Library visit', value: 'Monday' };
const read = { version: 2, action: 'read', recordId: 'alex-library' };
async function fixture(t, { unknown = false, contractVersion = 2 } = {}) {
  let current = { revision: crypto.randomUUID(), data }, attempts = 0, commits = 0, tick = 0;
  const store = { contractVersion, read: async () => structuredClone(current), create() { throw Error('Unexpected create'); },
    async edit(id, value, expected) {
      attempts++;
      if (expected !== current.revision) throw new VaultConflictError();
      current = { revision: crypto.randomUUID(), data: value }; commits++;
      if (unknown) throw Error('Synthetic lost acknowledgement');
      return { revision: current.revision };
    } };
  const host = await startDirectVaultExperiment({ identity: identities.hostIdentity, ca: identities.ca, store, contractVersion, now: () => tick });
  const control = createLocalEnrollment(host, { fictionalEdits: true });
  const ordinary = createLocalEnrollment(host);
  t.after(async () => { control.close(); ordinary.close(); await host.close(); });
  const offer = control.decide({ ...control.review(identities.phoneIdentity.fingerprint), allow: true });
  async function connect(offered) {
    const client = await connectDirectVaultExperiment({ port: host.port, identity: identities.phoneIdentity,
      ca: identities.ca, approvedHostFingerprint: host.hostFingerprint, offer: offered });
    t.after(() => client.close());
    return { client, connection: { connectionId: client.connectionId, peerFingerprint: identities.phoneIdentity.fingerprint } };
  }
  return { host, control, ordinary, connect, first: await connect(offer.offer),
    current: () => structuredClone(current), competing: () => { current = { revision: crypto.randomUUID(), data: { ...data, value: 'Thursday' } }; },
    counts: () => ({ attempts, commits }), expire: () => { tick += 60_000; } };
}

test('edit-only approval is opt-in, version-2, connection-bound and expires; reads never grant writes', async t => {
  const f = await fixture(t), { client, connection } = f.first;
  assert.throws(() => f.ordinary.approveFictionalEdit(connection), { code: 'DENIED' });
  assert.throws(() => f.control.approveFictionalEdit({ ...connection, peerFingerprint: identities.outsiderIdentity.fingerprint }), { code: 'DENIED' });
  const readGrant = f.control.approveRead(connection);
  await client.nextApproval();
  const viewed = await client.execute(readGrant, read);
  const change = { ...read, action: 'edit', expectedRevision: viewed.revision, data: { ...data, value: 'Friday' } };
  await assert.rejects(client.execute(readGrant, change), { code: 'DENIED' });
  const editGrant = f.control.approveFictionalEdit(connection);
  assert.equal((await client.nextApproval()).mode, 'edit');
  for (const denied of [read, { ...read, action: 'create', data }, { ...read, action: 'delete', expectedRevision: viewed.revision },
    { ...change, recordId: 'sam-school' }]) await assert.rejects(client.execute(editGrant, denied), { code: 'DENIED' });
  const other = await f.connect();
  await assert.rejects(other.client.execute(editGrant, change), { code: 'DENIED' });
  f.expire();
  await assert.rejects(client.execute(editGrant, change), { code: 'DENIED' });
  assert.deepEqual(f.counts(), { attempts: 0, commits: 0 });
  const legacy = await fixture(t, { contractVersion: 1 });
  assert.throws(() => legacy.control.approveFictionalEdit(legacy.first.connection), { code: 'DENIED' });
});

test('real TLS stale revision conflicts, preserves winner and requires a fresh read before a conditional save', async t => {
  const f = await fixture(t), { client, connection } = f.first;
  const readGrant = f.control.approveRead(connection); await client.nextApproval();
  const initial = await client.execute(readGrant, read);
  f.competing(); const winner = f.current();
  const editGrant = f.control.approveFictionalEdit(connection); await client.nextApproval();
  await assert.rejects(client.execute(editGrant, { ...read, action: 'edit', expectedRevision: initial.revision, data }), { code: 'CONFLICT' });
  assert.deepEqual(f.current(), winner); assert.deepEqual(f.counts(), { attempts: 1, commits: 0 });
  const fresh = await client.execute(readGrant, read);
  const receipt = await client.execute(editGrant, { ...read, action: 'edit', expectedRevision: fresh.revision, data });
  assert.deepEqual(Object.keys(receipt).sort(), ['accessEnded', 'recordId', 'revision', 'status', 'version']);
  assert.equal(receipt.status, 'applied'); assert.equal(receipt.accessEnded, false);
  assert.notEqual(receipt.revision, fresh.revision); assert.deepEqual(f.counts(), { attempts: 2, commits: 1 });
});

test('lost edit receipt commits once, closes grants, and fresh readback never replays the write', async t => {
  const f = await fixture(t, { unknown: true }), { client, connection } = f.first;
  const readGrant = f.control.approveRead(connection); await client.nextApproval();
  const initial = await client.execute(readGrant, read);
  const editGrant = f.control.approveFictionalEdit(connection); await client.nextApproval();
  await assert.rejects(client.execute(editGrant, { ...read, action: 'edit', expectedRevision: initial.revision, data: { ...data, value: 'Friday' } }), { code: 'WRITE_UNKNOWN' });
  const next = await f.connect();
  await assert.rejects(next.client.execute(readGrant, read), { code: 'DENIED' });
  const fresh = f.control.approveRead(next.connection); await next.client.nextApproval();
  const result = await next.client.execute(fresh, read);
  assert.equal(result.data.value, 'Friday'); assert.notEqual(result.revision, initial.revision);
  assert.deepEqual(f.counts(), { attempts: 1, commits: 1 });
});

test('terminal edit approval is independent, fixed and denied by EOF or a read answer', async () => {
  const input = new PassThrough(), output = new PassThrough(); let text = '';
  output.on('data', chunk => { text += chunk; });
  const terminal = openHostApprovalConsole({ input, output, synthetic: true });
  const connection = { peerFingerprint: identities.phoneIdentity.fingerprint, connectionId: 'selected' };
  try {
    const wrong = terminal.edit(connection); input.write('allow\n'); assert.equal(await wrong, false);
    const right = terminal.edit(connection); input.write('edit\n'); assert.equal(await right, true);
    assert.match(text, /no create, delete or read grant/); assert.match(text, /Friday from phone/);
    const eof = terminal.edit(connection); input.end(); assert.equal(await eof, false);
  } finally { terminal.close(); }
});
