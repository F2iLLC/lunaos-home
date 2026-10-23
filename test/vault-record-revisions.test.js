import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultSessionService } from '../lib/vault-sessions.js';
import { VaultConflictError } from '../lib/vault-record-contract.js';

const alex = { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' };
const sam = { memberId: 'sam-example', label: 'School', value: 'Meadow School' };
const scope = { recordIds: ['alex-work', 'sam-school'], lifetimeMs: 1000 };
const request = (action, extra = {}) => ({ version: 2, recordId: 'alex-work', action, ...extra });

function fixture(t) {
  const rows = new Map();
  const calls = [];
  let tick = 0;
  const store = {
    contractVersion: 2,
    async read(id) { calls.push('read'); return structuredClone(rows.get(id) ?? null); },
    async create(id, data) {
      calls.push('create');
      if (rows.has(id)) throw new VaultConflictError();
      const revision = crypto.randomUUID();
      rows.set(id, { revision, data: structuredClone(data) });
      return { revision };
    },
    async edit(id, data, expectedRevision) {
      calls.push('edit');
      if (!rows.has(id) || rows.get(id).revision !== expectedRevision) throw new VaultConflictError();
      const revision = crypto.randomUUID();
      rows.set(id, { revision, data: structuredClone(data) });
      return { revision };
    },
    async delete(id, expectedRevision) {
      calls.push('delete');
      if (!rows.has(id) || rows.get(id).revision !== expectedRevision) throw new VaultConflictError();
      rows.delete(id);
      return { revision: expectedRevision };
    },
  };
  const service = createVaultSessionService({ store, contractVersion: 2, now: () => tick });
  t.after(() => service.shutdown());
  service.admitDevice('windows-example');
  const local = service.openConnection({ deviceId: 'windows-example' });
  const grant = service.approveSetup(local, scope);
  return { store, rows, calls, service, local, grant, setTime: value => { tick = value; } };
}

test('two readers submit simultaneous edits; only the first reviewed revision can commit', async t => {
  const { service, local, grant, rows } = fixture(t);
  const created = await local.execute(grant, request('create', { data: alex }));
  await local.execute(grant, request('create', { recordId: 'sam-school', data: sam }));
  const other = service.openConnection({ deviceId: 'windows-example' });
  const otherGrant = service.approveSetup(other, scope);
  const firstView = await local.execute(grant, request('read'));
  const secondView = await other.execute(otherGrant, request('read'));
  assert.equal(firstView.revision, created.revision);
  assert.deepEqual(firstView, secondView);
  const result = await Promise.allSettled([
    local.execute(grant, request('edit', { expectedRevision: firstView.revision, data: { ...alex, value: 'Reviewed local edit' } })),
    other.execute(otherGrant, request('edit', { expectedRevision: secondView.revision, data: { ...alex, value: 'Outdated edit' } })),
  ]);
  assert.equal(result[0].status, 'fulfilled');
  assert.equal(result[1].status, 'rejected');
  assert.equal(result[1].reason.code, 'CONFLICT');
  assert.notEqual(result[0].value.revision, firstView.revision);
  assert.deepEqual(Object.keys(result[0].value).sort(), ['accessEnded', 'recordId', 'revision', 'status', 'version']);
  assert.equal(rows.get('alex-work').data.value, 'Reviewed local edit');
  assert.deepEqual(rows.get('sam-school').data, sam);
  // A conflict does not refresh/retry, leak the current value, or destroy a valid read grant.
  assert.deepEqual(Object.keys(result[1].reason), ['code']);
  const refreshed = await other.execute(otherGrant, request('read'));
  assert.equal(refreshed.revision, result[0].value.revision);
});

test('stale deletion and duplicate creation preserve data; recreated IDs reject old revisions', async t => {
  const { service, local, grant, rows } = fixture(t);
  const created = await local.execute(grant, request('create', { data: alex }));
  await assert.rejects(local.execute(grant, request('create', { data: sam })), { code: 'CONFLICT' });
  const updated = await local.execute(grant, request('edit', { expectedRevision: created.revision, data: alex }));
  assert.notEqual(updated.revision, created.revision, 'even a same-value save advances the revision');
  const deletion = service.approveDelete(local, scope);
  await assert.rejects(local.execute(deletion, request('delete', { expectedRevision: created.revision })), { code: 'CONFLICT' });
  assert.deepEqual(rows.get('alex-work').data, alex);
  const removed = await local.execute(deletion, request('delete', { expectedRevision: updated.revision }));
  assert.equal(removed.revision, updated.revision);
  await assert.rejects(local.execute(grant, request('read')), { code: 'NOT_FOUND' });
  await assert.rejects(local.execute(grant, request('edit', { expectedRevision: updated.revision, data: sam })), { code: 'CONFLICT' });
  const recreated = await local.execute(grant, request('create', { data: sam }));
  assert.notEqual(recreated.revision, updated.revision);
  await assert.rejects(local.execute(deletion, request('delete', { expectedRevision: updated.revision })), { code: 'CONFLICT' });
  await assert.rejects(local.execute(grant, request('edit', { expectedRevision: created.revision, data: alex })), { code: 'CONFLICT' });
  assert.deepEqual(rows.get('alex-work').data, sam);
});

test('version, expected revision and strict fields are mandatory before reaching storage', async t => {
  const { local, grant, calls, store } = fixture(t);
  for (const input of [
    { action: 'edit', recordId: 'alex-work', data: alex },
    request('edit', { data: alex }), request('delete'),
    request('edit', { data: alex, expectedRevision: '*' }),
    request('edit', { data: alex, expectedRevision: crypto.randomUUID(), force: true }),
    request('create', { data: alex, revision: crypto.randomUUID() }),
    request('read', { version: 3 }),
    request('delete', { recordId: '../outside', expectedRevision: crypto.randomUUID() }),
  ]) await assert.rejects(local.execute(grant, input), { code: 'INVALID' });
  assert.deepEqual(calls, []);
  assert.throws(() => createVaultSessionService({ store }), /versions must match/);
  assert.throws(() => createVaultSessionService({ store: { ...store, contractVersion: 1 }, contractVersion: 2 }), /versions must match/);
});

test('assistant revision reads require separate disclosure; revision tokens never grant write scope', async t => {
  const { service, local, grant, calls } = fixture(t);
  const created = await local.execute(grant, request('create', { data: alex }));
  const assistant = service.openConnection({ deviceId: 'windows-example', destination: 'claude' });
  const read = service.approveReadOnly(assistant, scope);
  calls.length = 0;
  await assert.rejects(assistant.execute(read, request('read')), { code: 'DISCLOSURE_REQUIRED' });
  await assert.rejects(assistant.execute(read, request('edit', { expectedRevision: created.revision, data: sam })), { code: 'DENIED' });
  assert.deepEqual(calls, []);
  service.approveDisclosure(assistant, { grantId: read, ...scope, destination: 'claude', fields: ['label'] });
  assert.deepEqual(await assistant.execute(read, request('read')), {
    version: 2, recordId: 'alex-work', revision: created.revision, data: { label: 'Workplace' },
  });
  const edit = service.approveEdit(assistant, scope);
  const saved = await assistant.execute(edit, request('edit', { expectedRevision: created.revision, data: sam }));
  assert.equal(saved.status, 'applied');
  assert.equal('data' in saved, false);
  service.revokeDisclosure(read);
  await assert.rejects(assistant.execute(read, request('read')), { code: 'DISCLOSURE_REQUIRED' });
});

test('malformed stored revisions and records return a typed read failure without adapter details', async t => {
  const { local, grant, rows } = fixture(t);
  const created = await local.execute(grant, request('create', { data: alex }));
  for (const badRecord of [
    { revision: 'invalid', data: alex },
    { revision: created.revision, data: { ...alex, value: 'bad\uD800' } },
    { revision: created.revision, data: alex, internal: 'private adapter detail' },
  ]) {
    rows.set('alex-work', badRecord);
    await assert.rejects(local.execute(grant, request('read')), error => {
      assert.equal(error.code, 'READ_FAILED');
      assert.deepEqual(Object.keys(error), ['code']);
      assert.equal(error.message, 'The record could not be read.');
      return true;
    });
  }
  rows.set('alex-work', { revision: created.revision, data: alex });
  assert.equal((await local.execute(grant, request('read'))).revision, created.revision);
});

test('privileged activity keeps bounded typed outcomes without values or grant IDs', async t => {
  const { service, local, grant } = fixture(t);
  const created = await local.execute(grant, request('create', { data: alex }));
  await local.execute(grant, request('read'));
  await assert.rejects(local.execute(grant, request('edit', {
    data: sam, expectedRevision: crypto.randomUUID(),
  })), { code: 'CONFLICT' });
  assert.deepEqual(service.recentActivity(), [
    { sequence: 1, deviceId: 'windows-example', action: 'create', outcome: 'applied' },
    { sequence: 2, deviceId: 'windows-example', action: 'read', outcome: 'read' },
    { sequence: 3, deviceId: 'windows-example', action: 'edit', outcome: 'CONFLICT' },
  ]);
  assert.equal(JSON.stringify(service.recentActivity()).includes(alex.value), false);
  assert.equal(JSON.stringify(service.recentActivity()).includes(grant), false);
  assert.notEqual(created.revision, undefined);
});

test('queued expected revision is copied, then checked against the committed revision', async t => {
  const { store, service, local, grant } = fixture(t);
  const created = await local.execute(grant, request('create', { data: alex }));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const originalRead = store.read;
  store.read = async id => { entered.resolve(); await release.promise; return originalRead(id); };
  const reading = local.execute(grant, request('read'));
  await entered.promise;
  const input = request('edit', { expectedRevision: created.revision, data: { ...alex, value: 'Reviewed change' } });
  const editing = local.execute(grant, input);
  const deletionGrant = service.approveDelete(local, scope);
  const deleting = assert.rejects(local.execute(deletionGrant, request('delete', { expectedRevision: created.revision })), { code: 'CONFLICT' });
  input.expectedRevision = crypto.randomUUID(); input.data.value = 'Mutated input';
  release.resolve();
  await Promise.all([reading, editing, deleting]);
  assert.equal((await local.execute(grant, request('read'))).data.value, 'Reviewed change');
});

for (const failure of ['lost-acknowledgement', 'invalid-receipt', 'unchanged-revision']) {
  test(`${failure} invalidates queued operations and never retries a committed revision`, async t => {
    const { store, service, local, grant, rows, calls } = fixture(t);
    const created = await local.execute(grant, request('create', { data: alex }));
    const edit = store.edit;
    store.edit = async (...args) => {
      await edit(...args);
      if (failure === 'lost-acknowledgement') throw Error('private adapter details');
      if (failure === 'unchanged-revision') return { revision: args[2] };
      return { revision: 'invalid', data: alex };
    };
    calls.length = 0;
    const input = request('edit', { expectedRevision: created.revision, data: sam });
    const changing = assert.rejects(local.execute(grant, input), { code: 'WRITE_UNKNOWN' });
    const queued = assert.rejects(local.execute(grant, input), { code: 'DENIED' });
    await Promise.all([changing, queued]);
    assert.deepEqual(calls, ['edit']);
    assert.notEqual(rows.get('alex-work').revision, created.revision);
    store.edit = edit;
    const fresh = service.openConnection({ deviceId: 'windows-example' });
    const freshGrant = service.approveSetup(fresh, scope);
    await assert.rejects(fresh.execute(grant, input), { code: 'DENIED' });
    await assert.rejects(fresh.execute(freshGrant, input), { code: 'CONFLICT' });
    const reviewed = await fresh.execute(freshGrant, request('read'));
    assert.deepEqual(reviewed.data, sam);
  });
}

test('expiry withholds a pending revision read and prevents the queued edit', async t => {
  const { store, local, grant, rows, setTime } = fixture(t);
  const created = await local.execute(grant, request('create', { data: alex }));
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  store.read = async () => { entered.resolve(); await release.promise; return rows.get('alex-work'); };
  const reading = assert.rejects(local.execute(grant, request('read')), { code: 'DENIED' });
  await entered.promise;
  const editing = assert.rejects(local.execute(grant, request('edit', { expectedRevision: created.revision, data: sam })), { code: 'DENIED' });
  setTime(1000); release.resolve();
  await Promise.all([reading, editing]);
  assert.equal(rows.get('alex-work').revision, created.revision);
});
