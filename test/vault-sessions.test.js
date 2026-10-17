import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultSessionService, VaultAccessError } from '../lib/vault-sessions.js';

const alex = { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' };
const sam = { memberId: 'sam-example', label: 'School', value: 'Meadow School' };
const selection = { recordIds: ['alex-work', 'sam-school'], lifetimeMs: 1000 };
const denied = code => error => error instanceof VaultAccessError && error.code === code;
function setup() {
  const rows = new Map([['alex-work', structuredClone(alex)], ['sam-school', structuredClone(sam)]]);
  const calls = [];
  const store = {
    async read(id) { calls.push(['read', id]); return structuredClone(rows.get(id)); },
    async create(id, data) { calls.push(['create', id]); if (rows.has(id)) throw Error('exists'); rows.set(id, data); },
    async edit(id, data) { calls.push(['edit', id]); if (!rows.has(id)) throw Error('missing'); rows.set(id, data); return { privateValue: 'must not escape' }; },
  };
  let tick = 0;
  const service = createVaultSessionService({ store, now: () => tick });
  service.admitDevice('windows-example');
  return { service, store, rows, calls, setTime: value => { tick = value; } };
}

test('admission, connection binding, family labels and selected record scope', async () => {
  const { service, calls } = setup();
  assert.throws(() => service.openConnection({ deviceId: 'unknown' }), denied('DENIED'));
  const connection = service.openConnection({ deviceId: 'windows-example' });
  const other = service.openConnection({ deviceId: 'windows-example' });
  const scope = structuredClone(selection);
  const grant = service.approveReadOnly(connection, scope);
  scope.recordIds.push('unapproved');
  await assert.rejects(other.execute(grant, { action: 'read', recordId: 'alex-work' }), denied('DENIED'));
  assert.deepEqual(await connection.execute(grant, { action: 'read', recordId: 'alex-work' }), alex);
  assert.deepEqual(await connection.execute(grant, { action: 'read', recordId: 'sam-school' }), sam);
  await assert.rejects(connection.execute(grant, { action: 'read', recordId: 'unapproved' }), denied('DENIED'));
  assert.deepEqual(calls, [['read', 'alex-work'], ['read', 'sam-school']]);
});

test('setup can create and edit selected records; read-only and setup both reject deletion', async () => {
  const { service, rows, calls } = setup();
  const connection = service.openConnection({ deviceId: 'windows-example' });
  const read = service.approveReadOnly(connection, selection);
  for (const action of ['create', 'edit', 'delete']) {
    await assert.rejects(connection.execute(read, {
      action, recordId: 'alex-work', ...(action === 'delete' ? {} : { data: alex }),
    }), denied('DENIED'));
  }
  assert.equal(calls.length, 0);
  const write = service.approveSetup(connection, { recordIds: ['alex-work', 'alex-library'], lifetimeMs: 1000 });
  assert.deepEqual(await connection.execute(write, {
    action: 'edit', recordId: 'alex-work', data: { ...alex, value: 'Willow Workshop' },
  }), { status: 'applied', recordId: 'alex-work', accessEnded: false });
  await connection.execute(write, { action: 'create', recordId: 'alex-library', data: { ...alex, label: 'Library', value: 'Moonrise Library' } });
  await assert.rejects(connection.execute(write, { action: 'delete', recordId: 'alex-work' }), denied('DENIED'));
  assert.equal(rows.get('alex-work').value, 'Willow Workshop');
  assert.deepEqual(rows.get('sam-school'), sam);
});

for (const end of ['expire', 'revoke', 'disconnect', 'remove-device', 'shutdown']) {
  test(`${end} blocks queued writes and a pending read response`, async () => {
    const { service, store, rows, calls, setTime } = setup();
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    store.read = async () => { entered.resolve(); await release.promise; return alex; };
    const connection = service.openConnection({ deviceId: 'windows-example' });
    const grant = service.approveSetup(connection, selection);
    const reading = assert.rejects(connection.execute(grant, { action: 'read', recordId: 'alex-work' }), denied('DENIED'));
    await entered.promise;
    const queued = assert.rejects(connection.execute(grant, { action: 'edit', recordId: 'alex-work', data: { ...alex, value: 'Late edit' } }), denied('DENIED'));
    if (end === 'expire') setTime(1000); // Expiry is inclusive at the deadline.
    if (end === 'revoke') service.revokeGrant(grant);
    if (end === 'disconnect') connection.close();
    if (end === 'remove-device') service.removeDevice('windows-example');
    if (end === 'shutdown') service.shutdown();
    release.resolve();
    await Promise.all([reading, queued]);
    await assert.rejects(connection.execute(grant, { action: 'edit', recordId: 'alex-work', data: alex }), denied('DENIED'));
    assert.equal(calls.length, 0); // No denied mutation reached the adapter.
    assert.deepEqual(rows.get('alex-work'), alex);
  });
}

test('old grants never revive after reconnect, readmission or service restart', async () => {
  const { service, store } = setup();
  const connection = service.openConnection({ deviceId: 'windows-example' });
  const grant = service.approveSetup(connection, selection);
  service.removeDevice('windows-example');
  service.admitDevice('windows-example');
  const next = service.openConnection({ deviceId: 'windows-example' });
  await assert.rejects(next.execute(grant, { action: 'read', recordId: 'alex-work' }), denied('DENIED'));
  const restarted = createVaultSessionService({ store });
  restarted.admitDevice('windows-example');
  const afterRestart = restarted.openConnection({ deviceId: 'windows-example' });
  await assert.rejects(afterRestart.execute(grant, { action: 'read', recordId: 'alex-work' }), denied('DENIED'));
});

test('assistant writes return receipts; reading requires separate selected-field disclosure', async () => {
  const { service, calls } = setup();
  const assistant = service.openConnection({ deviceId: 'windows-example', destination: 'claude' });
  const grant = service.approveSetup(assistant, selection);
  const read = { action: 'read', recordId: 'alex-work' };
  await assert.rejects(assistant.execute(grant, read), denied('DISCLOSURE_REQUIRED'));
  assert.equal(calls.length, 0);
  assert.deepEqual(await assistant.execute(grant, { action: 'edit', recordId: 'alex-work', data: alex }), {
    status: 'applied', recordId: 'alex-work', accessEnded: false,
  });
  const disclosure = { grantId: grant, destination: 'claude', recordIds: ['alex-work'], fields: ['value'], lifetimeMs: 500 };
  assert.throws(() => service.approveDisclosure(assistant, { ...disclosure, destination: 'chatgpt' }), denied('DENIED'));
  assert.throws(() => service.approveDisclosure(assistant, { ...disclosure, recordIds: ['other'] }), denied('DENIED'));
  service.approveDisclosure(assistant, disclosure);
  disclosure.fields.push('memberId'); // Caller changes cannot widen the approval.
  assert.deepEqual(await assistant.execute(grant, read), { value: 'Willow Studio' });
  await assert.rejects(assistant.execute(grant, { ...read, recordId: 'sam-school' }), denied('DISCLOSURE_REQUIRED'));
  service.revokeDisclosure(grant);
  await assert.rejects(assistant.execute(grant, read), denied('DISCLOSURE_REQUIRED'));
});

test('disclosure expiry while reading withholds the late value', async () => {
  const { service, store, setTime } = setup();
  const assistant = service.openConnection({ deviceId: 'windows-example', destination: 'claude' });
  const grantId = service.approveReadOnly(assistant, selection);
  service.approveDisclosure(assistant, { grantId, recordIds: ['alex-work'], destination: 'claude', fields: ['value'], lifetimeMs: 100 });
  store.read = async () => { setTime(100); return alex; };
  await assert.rejects(assistant.execute(grantId, { action: 'read', recordId: 'alex-work' }), denied('DISCLOSURE_REQUIRED'));
});

test('local and assistant connections share one enforcing service and storage adapter', async () => {
  const { service } = setup();
  const local = service.openConnection({ deviceId: 'windows-example' });
  const assistant = service.openConnection({ deviceId: 'windows-example', destination: 'claude' });
  const localGrant = service.approveReadOnly(local, selection);
  const assistantGrant = service.approveSetup(assistant, selection);
  await assistant.execute(assistantGrant, { action: 'edit', recordId: 'alex-work', data: { ...alex, value: 'Willow Workshop' } });
  assert.equal((await local.execute(localGrant, { action: 'read', recordId: 'alex-work' })).value, 'Willow Workshop');
  await assert.rejects(assistant.execute(assistantGrant, { action: 'read', recordId: 'alex-work' }), denied('DISCLOSURE_REQUIRED'));
  assert.deepEqual(await local.execute(localGrant, { action: 'read', recordId: 'sam-school' }), sam);
});

test('queued inputs are copied before a caller can change the target or value', async () => {
  const { service, store, rows } = setup();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  store.read = async () => { entered.resolve(); await release.promise; return alex; };
  const connection = service.openConnection({ deviceId: 'windows-example' });
  const grant = service.approveSetup(connection, selection);
  const first = connection.execute(grant, { action: 'read', recordId: 'alex-work' });
  await entered.promise;
  const request = { action: 'edit', recordId: 'alex-work', data: { ...alex, value: 'Approved value' } };
  const queued = connection.execute(grant, request);
  request.recordId = 'sam-school';
  request.data.value = 'Changed after enqueue';
  release.resolve();
  await Promise.all([first, queued]);
  assert.equal(rows.get('alex-work').value, 'Approved value');
  assert.deepEqual(rows.get('sam-school'), sam);
});

test('a confirmed in-flight write reports applied and ended access, not a fake rollback', async () => {
  const { service, store, rows } = setup();
  const connection = service.openConnection({ deviceId: 'windows-example' });
  const grant = service.approveSetup(connection, selection);
  store.edit = async (id, data) => { service.revokeGrant(grant); rows.set(id, data); };
  assert.deepEqual(await connection.execute(grant, { action: 'edit', recordId: 'alex-work', data: { ...alex, value: 'Changed' } }), {
    status: 'applied', recordId: 'alex-work', accessEnded: true,
  });
  assert.equal(rows.get('alex-work').value, 'Changed');
});

test('lost write acknowledgement never replays and invalidates queued operations', async () => {
  const { service, store, rows } = setup();
  const connection = service.openConnection({ deviceId: 'windows-example' });
  const grant = service.approveSetup(connection, selection);
  let writes = 0;
  store.edit = async (id, data) => { writes++; rows.set(id, data); throw Error('private adapter diagnostic'); };
  const request = { action: 'edit', recordId: 'alex-work', data: { ...alex, value: 'Applied once' } };
  const first = assert.rejects(connection.execute(grant, request), error => {
    assert.equal(error.code, 'WRITE_UNKNOWN');
    assert.doesNotMatch(error.message, /private adapter/);
    return true;
  });
  const queued = assert.rejects(connection.execute(grant, request), denied('DENIED'));
  await Promise.all([first, queued]);
  assert.equal(writes, 1);
  assert.equal(rows.get('alex-work').value, 'Applied once');
});

test('invalid requests, unknown fields and backward clock fail closed', async () => {
  const { service, calls, setTime } = setup();
  const connection = service.openConnection({ deviceId: 'windows-example' });
  for (const lifetimeMs of [0, Infinity, 900001]) {
    assert.throws(() => service.approveSetup(connection, { ...selection, lifetimeMs }), denied('INVALID'));
  }
  assert.throws(() => service.approveSetup(connection, { ...selection, actions: ['delete'] }), denied('INVALID'));
  const grant = service.approveSetup(connection, selection);
  await assert.rejects(connection.execute(grant, { action: 'edit', recordId: 'alex-work', data: { ...alex, secret: 'not part of this schema' } }), denied('INVALID'));
  await assert.rejects(connection.execute(grant, { action: 'delete', recordId: '../outside' }), denied('INVALID'));
  setTime(-1);
  await assert.rejects(connection.execute(grant, { action: 'read', recordId: 'alex-work' }), denied('DENIED'));
  setTime(1);
  await assert.rejects(connection.execute(grant, { action: 'read', recordId: 'alex-work' }), denied('DENIED'));
  assert.equal(calls.length, 0);
});
