import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { createVaultSessionService } from '../lib/vault-sessions.js';
import { VaultConflictError } from '../lib/vault-record-contract.js';

const windows = { skip: process.platform !== 'win32', timeout: 60000 };
const alex = { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' };
const sam = { memberId: 'sam-example', label: 'School', value: 'Meadow School' };
const request = (action, extra = {}) => ({ version: 2, recordId: 'alex-work', action, ...extra });
const scope = { recordIds: ['alex-work', 'sam-school'], lifetimeMs: 60000 };

function connect(service) {
  service.admitDevice('windows-example');
  const connection = service.openConnection({ deviceId: 'windows-example' });
  return { connection, grant: service.approveSetup(connection, scope) };
}

test('encrypted revisions survive reopen; stale writes and mode downgrade preserve ciphertext', windows, async t => {
  const store = await openWindowsProbeStore({ create: true, contractVersion: 2 });
  t.after(() => store.removeSyntheticStore());
  const initial = await store.create('alex-work', alex);
  const other = await store.create('sam-school', sam);
  const reopened = await openWindowsProbeStore({ probeId: store.probeId, contractVersion: 2 });
  assert.deepEqual(await reopened.read('alex-work'), { revision: initial.revision, data: alex });
  const saved = await reopened.edit('alex-work', { ...alex, value: 'Reviewed edit' }, initial.revision);
  assert.notEqual(saved.revision, initial.revision);
  const file = path.join(store.directory, 'records.bin');
  const committed = await readFile(file);
  assert.equal(committed.includes(Buffer.from('Reviewed edit')), false);
  assert.equal(committed.includes(Buffer.from(saved.revision)), false);
  for (const mutation of [
    () => store.edit('alex-work', sam, initial.revision),
    () => store.delete('alex-work', initial.revision),
    () => store.create('alex-work', sam),
    () => store.edit('missing-record', sam, saved.revision),
  ]) await assert.rejects(mutation(), VaultConflictError);
  await assert.rejects(store.edit('alex-work', sam));
  await assert.rejects(store.delete('alex-work', '*'));
  await assert.rejects(openWindowsProbeStore({ probeId: store.probeId }), /synthetic storage operation failed/);
  await assert.rejects(openWindowsProbeStore({ probeId: store.probeId, contractVersion: 2, recovery: true }), /Unsupported/);
  assert.deepEqual(await readFile(file), committed);
  const damaged = Buffer.from(committed); damaged[damaged.length - 1] ^= 1;
  try {
    await writeFile(file, damaged);
    await assert.rejects(store.edit('alex-work', sam, saved.revision), /synthetic storage operation failed/);
    assert.deepEqual(await readFile(file), damaged);
  } finally { await writeFile(file, committed); }
  assert.deepEqual(await store.delete('alex-work', saved.revision), { revision: saved.revision });
  assert.equal(await reopened.read('alex-work'), null);
  const recreated = await reopened.create('alex-work', alex);
  assert.notEqual(recreated.revision, initial.revision);
  assert.notEqual(recreated.revision, saved.revision);
  await assert.rejects(store.delete('alex-work', saved.revision), VaultConflictError);
  assert.deepEqual(await store.read('sam-school'), { revision: other.revision, data: sam });
});

test('separate services race encrypted writes without overwriting a newer revision', windows, async t => {
  const store = await openWindowsProbeStore({ create: true, contractVersion: 2 });
  const reopened = await openWindowsProbeStore({ probeId: store.probeId, contractVersion: 2 });
  const firstService = createVaultSessionService({ store, contractVersion: 2 });
  const secondService = createVaultSessionService({ store: reopened, contractVersion: 2 });
  t.after(async () => {
    await Promise.all([firstService.shutdown(), secondService.shutdown()]);
    await store.removeSyntheticStore();
  });
  const first = connect(firstService);
  const second = connect(secondService);
  const initial = await first.connection.execute(first.grant, request('create', { data: alex }));
  const viewed = await second.connection.execute(second.grant, request('read'));
  assert.equal(viewed.revision, initial.revision);
  const changes = [{ ...alex, value: 'First reviewed change' }, { ...alex, value: 'Second reviewed change' }];
  const results = await Promise.allSettled([first, second].map((client, index) => client.connection.execute(client.grant,
    request('edit', { expectedRevision: initial.revision, data: changes[index] }))));
  const winner = results.findIndex(result => result.status === 'fulfilled');
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results[1 - winner];
  // Lock acquisition can fail before a worker reads the record. Its generic
  // adapter failure is conservatively unknown, never a claim of a second save.
  assert.ok(['CONFLICT', 'WRITE_UNKNOWN'].includes(rejected.reason.code));
  const current = await reopened.read('alex-work');
  assert.deepEqual(current, { revision: results[winner].value.revision, data: changes[winner] });
  const beforeRetry = await readFile(path.join(store.directory, 'records.bin'));
  await assert.rejects(reopened.edit('alex-work', changes[1 - winner], viewed.revision), VaultConflictError);
  assert.deepEqual(await readFile(path.join(store.directory, 'records.bin')), beforeRetry);
});

test('lost encrypted write acknowledgement requires fresh review and never replays the old revision', windows, async t => {
  const store = await openWindowsProbeStore({ create: true, contractVersion: 2 });
  let writes = 0;
  const wrapped = { ...store, lifecycleStore: store, async edit(...args) {
    writes++;
    await store.edit(...args);
    throw Error('Synthetic lost acknowledgement');
  } };
  const service = createVaultSessionService({ store: wrapped, contractVersion: 2 });
  t.after(async () => { await service.shutdown(); await store.removeSyntheticStore(); });
  const client = connect(service);
  const initial = await client.connection.execute(client.grant, request('create', { data: alex }));
  const edit = request('edit', { expectedRevision: initial.revision, data: { ...alex, value: 'Committed once' } });
  await Promise.all([
    assert.rejects(client.connection.execute(client.grant, edit), { code: 'WRITE_UNKNOWN' }),
    assert.rejects(client.connection.execute(client.grant, edit), { code: 'DENIED' }),
  ]);
  assert.equal(writes, 1);
  const reopened = await openWindowsProbeStore({ probeId: store.probeId, contractVersion: 2 });
  const current = await reopened.read('alex-work');
  assert.notEqual(current.revision, initial.revision);
  assert.equal(current.data.value, 'Committed once');
  await assert.rejects(reopened.edit('alex-work', alex, initial.revision), VaultConflictError);
  const fresh = connect(service);
  assert.deepEqual((await fresh.connection.execute(fresh.grant, request('read'))).data, current.data);
  await assert.rejects(fresh.connection.execute(client.grant, edit), { code: 'DENIED' });
});
