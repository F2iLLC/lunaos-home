import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultSessionService, VaultAccessError } from '../lib/vault-sessions.js';

const alex = { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' };
const sam = { memberId: 'sam-example', label: 'School', value: 'Meadow School' };
const denied = code => error => error instanceof VaultAccessError && error.code === code;
const methods = { create: 'approveCreate', edit: 'approveEdit', delete: 'approveDelete' };
const request = (action, recordId = 'alex-work') => ({
  action, recordId, ...(['create', 'edit'].includes(action) ? { data: alex } : {}),
});

function setup(t) {
  const rows = new Map([['alex-work', alex], ['sam-school', sam]]);
  const calls = [];
  let tick = 0;
  let locked = false;
  const store = {
    async read(id) { calls.push(['read', id]); return rows.get(id); },
    async create(id, data) { calls.push(['create', id]); if (rows.has(id)) throw Error('exists'); rows.set(id, data); },
    async edit(id, data) { calls.push(['edit', id]); if (!rows.has(id)) throw Error('missing'); rows.set(id, data); },
    async delete(id) { calls.push(['delete', id]); if (!rows.delete(id)) throw Error('missing'); return alex; },
  };
  const service = createVaultSessionService({ store, now: () => tick,
    requireAccess() { if (locked) throw new VaultAccessError('DENIED'); },
  });
  t.after(() => service.shutdown());
  service.admitDevice('windows-example');
  const connection = service.openConnection({ deviceId: 'windows-example', destination: 'claude' });
  return { rows, calls, store, service, connection, setTime: value => { tick = value; }, lock: () => { locked = true; } };
}

for (const action of Object.keys(methods)) {
  test(`${action} approval grants only the selected action, records and connection`, async t => {
    const { service, connection, calls, rows } = setup(t);
    if (action === 'create') rows.delete('alex-work');
    const scope = { recordIds: ['alex-work'], lifetimeMs: 1000 };
    const grant = service[methods[action]](connection, scope);
    scope.recordIds.push('sam-school');
    const other = service.openConnection({ deviceId: 'windows-example', destination: 'claude' });
    await assert.rejects(other.execute(grant, request(action)), denied('DENIED'));
    await assert.rejects(connection.execute(grant, request(action, 'sam-school')), denied('DENIED'));
    for (const unapproved of ['read', 'create', 'edit', 'delete'].filter(value => value !== action)) {
      await assert.rejects(connection.execute(grant, request(unapproved)), denied('DENIED'));
    }
    service.approveDisclosure(connection, {
      grantId: grant, destination: 'claude', recordIds: ['alex-work'], fields: ['value'], lifetimeMs: 500,
    });
    await assert.rejects(connection.execute(grant, request('read')), denied('DENIED'));
    assert.deepEqual(calls, []);
    assert.deepEqual(await connection.execute(grant, request(action)), {
      status: 'applied', recordId: 'alex-work', accessEnded: false,
    });
    assert.deepEqual(calls, [[action, 'alex-work']]);
    assert.deepEqual(rows.get('sam-school'), sam);
    assert.equal(rows.has('alex-work'), action !== 'delete');
    connection.close();
    await assert.rejects(other.execute(grant, request(action)), denied('DENIED'));
  });
}

for (const end of ['expiry', 'revoke', 'disconnect', 'remove-device', 'lock', 'shutdown']) {
  test(`${end} prevents a queued explicit deletion`, async t => {
    const { service, store, connection, calls, rows, setTime, lock } = setup(t);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    store.read = async () => { entered.resolve(); await release.promise; return sam; };
    const local = service.openConnection({ deviceId: 'windows-example' });
    const read = service.approveReadOnly(local, { recordIds: ['sam-school'], lifetimeMs: 1000 });
    const reading = local.execute(read, request('read', 'sam-school')).catch(() => {});
    await entered.promise;
    const grant = service.approveDelete(connection, { recordIds: ['alex-work'], lifetimeMs: 1000 });
    const deletion = assert.rejects(connection.execute(grant, request('delete')), denied('DENIED'));
    if (end === 'expiry') setTime(1000);
    if (end === 'revoke') service.revokeGrant(grant);
    if (end === 'disconnect') connection.close();
    if (end === 'remove-device') service.removeDevice('windows-example');
    if (end === 'lock') lock();
    if (end === 'shutdown') service.shutdown();
    release.resolve();
    await Promise.all([reading, deletion]);
    assert.deepEqual(calls, []);
    assert.deepEqual(rows.get('alex-work'), alex);
  });
}

test('confirmed in-flight deletion reports ended access without returning the removed data', async t => {
  const { service, store, rows, connection } = setup(t);
  const grant = service.approveDelete(connection, { recordIds: ['alex-work'], lifetimeMs: 1000 });
  store.delete = async id => { rows.delete(id); service.revokeGrant(grant); return alex; };
  assert.deepEqual(await connection.execute(grant, request('delete')), {
    status: 'applied', recordId: 'alex-work', accessEnded: true,
  });
  assert.equal(rows.has('alex-work'), false);
});

test('lost deletion acknowledgement invalidates queued work and never retries', async t => {
  const { service, store, rows, connection } = setup(t);
  const grant = service.approveDelete(connection, { recordIds: ['alex-work'], lifetimeMs: 1000 });
  let deletions = 0;
  store.delete = async id => { deletions++; rows.delete(id); throw Error('private diagnostic'); };
  const first = assert.rejects(connection.execute(grant, request('delete')), error => {
    assert.equal(error.code, 'WRITE_UNKNOWN');
    assert.doesNotMatch(error.message, /private diagnostic/);
    return true;
  });
  const queued = assert.rejects(connection.execute(grant, request('delete')), denied('DENIED'));
  await Promise.all([first, queued]);
  assert.equal(deletions, 1);
  assert.equal(rows.has('alex-work'), false);
});

test('missing adapter capability rejects approval without an unknown mutation or lost connection', async t => {
  const { service, store, connection } = setup(t);
  delete store.delete;
  assert.throws(() => service.approveDelete(connection, { recordIds: ['alex-work'], lifetimeMs: 1000 }), denied('UNSUPPORTED'));
  const edit = service.approveEdit(connection, { recordIds: ['alex-work'], lifetimeMs: 1000 });
  assert.equal((await connection.execute(edit, request('edit'))).status, 'applied');
});

test('change approvals reject expanded scopes and cannot be issued while locked', t => {
  const { service, connection, lock } = setup(t);
  for (const method of Object.values(methods)) {
    for (const scope of [
      { recordIds: ['../outside'], lifetimeMs: 1000 },
      { recordIds: ['alex-work'], lifetimeMs: 900001 },
      { recordIds: ['alex-work'], lifetimeMs: 1000, actions: ['read'] },
    ]) assert.throws(() => service[method](connection, scope), denied('INVALID'));
  }
  lock();
  for (const method of Object.values(methods)) {
    assert.throws(() => service[method](connection, { recordIds: ['alex-work'], lifetimeMs: 1000 }), denied('DENIED'));
  }
});
