import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createDraftStore, exampleProposal } from '../lib/drafts.js';
import { createReviewedDraftVault, createWindowsReviewedDraftStore } from '../lib/reviewed-draft-vault.js';
import { VaultConflictError } from '../lib/vault-record-contract.js';
import { removeWindowsProbeStore } from '../lib/windows-probe-store.js';
import { createAppServer } from '../server.js';
import { once } from 'node:events';

function memoryStore() {
  const records = new Map();
  return { contractVersion: 2, records,
    async read(id) { return structuredClone(records.get(id) ?? null); },
    async create(id, data) {
      if (records.has(id)) throw new VaultConflictError();
      const revision = crypto.randomUUID(); records.set(id, { revision, data: structuredClone(data) }); return { revision };
    },
    async edit(id, data, expected) {
      if (records.get(id)?.revision !== expected) throw new VaultConflictError();
      const revision = crypto.randomUUID(); records.set(id, { revision, data: structuredClone(data) }); return { revision };
    },
  };
}
function fixture(store = memoryStore(), clock) {
  const drafts = createDraftStore(); drafts.stage(exampleProposal);
  const vault = createReviewedDraftVault({ drafts, store, ...(clock ? { now: clock } : {}) });
  const ref = (person = 0, field = 0) => {
    const d = drafts.read(); return { draftId: d.id, revision: d.revision, personId: d.people[person].id, itemId: d.people[person].fields[field].id };
  };
  return { drafts, store, vault, ref,
    confirm(p = 0, f = 0) { drafts.review({ ...ref(p, f), action: 'confirm' }); },
    prepare(p = 0, f = 0) { return vault.request({ action: 'prepare', ...ref(p, f) }); },
  };
}
test('saving requires confirmed field, separate approval and current draft; saved values never join MCP pending state', async t => {
  const f = fixture(); t.after(() => f.vault.close());
  await assert.rejects(f.prepare(), /Looks right/);
  f.confirm();
  const prepared = await f.prepare();
  assert.equal(f.store.records.size, 0);
  assert.equal(prepared.previousValue, null);
  assert.deepEqual(await f.vault.request({ action: 'save', approval: prepared.approval }), { status: 'saved', accessEnded: false });
  await assert.rejects(f.vault.request({ action: 'save', approval: prepared.approval }), /expired/);
  assert.equal(f.store.records.size, 1);
  assert.deepEqual(await f.vault.request({ action: 'view' }), { records: [{ name: 'Alex Example', label: 'Workplace', value: 'Willow Studio' }] });
  const before = await f.prepare();
  f.drafts.review({ ...f.ref(), action: 'edit', value: 'Willow Workshop' });
  await assert.rejects(f.vault.request({ action: 'save', approval: before.approval }), /draft changed/);
  assert.equal(f.store.records.get('alex-work').data.value, 'Willow Studio');
  f.drafts.discard({ draftId: f.ref().draftId, revision: f.ref().revision });
  assert.deepEqual(f.drafts.pending(), { draftId: null, revision: null, requests: [] });
  assert.equal((await f.vault.request({ action: 'view' })).records.length, 1);
});
test('expired and cancelled approvals cannot save; duplicate identities and unsupported details are refused', async t => {
  let now = 0;
  const f = fixture(memoryStore(), () => now); t.after(() => f.vault.close());
  f.confirm(); const first = await f.prepare(); now = 60000;
  await assert.rejects(f.vault.request({ action: 'save', approval: first.approval }), /expired/);
  const second = await f.prepare(); await f.vault.request({ action: 'cancel' });
  await assert.rejects(f.vault.request({ action: 'save', approval: second.approval }), /expired/);
  assert.equal(f.store.records.size, 0);
  const d = f.drafts.read(); f.drafts.discard({ draftId: d.id, revision: d.revision });
  f.drafts.stage({ people: [exampleProposal.people[0], exampleProposal.people[0]] });
  f.confirm(); await assert.rejects(f.prepare(), /Duplicate/);
});
test('concurrent record edit rejects old approval and preserves other members', async t => {
  const f = fixture(); t.after(() => f.vault.close());
  f.confirm(1); const sam = await f.prepare(1); await f.vault.request({ action: 'save', approval: sam.approval });
  f.confirm(); const first = await f.prepare(); await f.vault.request({ action: 'save', approval: first.approval });
  const stale = await f.prepare();
  const current = await f.store.read('alex-work');
  await f.store.edit('alex-work', { ...current.data, value: 'Newer fictional value' }, current.revision);
  await assert.rejects(f.vault.request({ action: 'save', approval: stale.approval }), { code: 'CONFLICT' });
  await assert.rejects(f.prepare(), /View saved/);
  const checked = await f.vault.request({ action: 'view' });
  assert.deepEqual(checked.records.map(r => r.value), ['Newer fictional value', 'Meadow School']);
  assert.equal((await f.prepare()).previousValue, 'Newer fictional value');
});
test('lost write receipt requires explicit readback and never replays the mutation', async t => {
  const store = memoryStore(); let writes = 0;
  const create = store.create;
  store.create = async (...args) => { writes++; await create(...args); throw Error('lost receipt'); };
  const f = fixture(store); t.after(() => f.vault.close());
  f.confirm(); const approval = await f.prepare();
  await assert.rejects(f.vault.request({ action: 'save', approval: approval.approval }), { code: 'WRITE_UNKNOWN' });
  await assert.rejects(f.prepare(), /View saved/);
  await assert.rejects(f.vault.request({ action: 'save', approval: approval.approval }), /View saved/);
  assert.equal((await f.vault.request({ action: 'view' })).records[0].value, 'Willow Studio');
  assert.equal(writes, 1);
});
test('local storage endpoint requires per-process key, same origin and bounded input; no generic save endpoint', async t => {
  const f = fixture(); t.after(() => f.vault.close());
  const server = createAppServer({ drafts: f.drafts, draftVault: f.vault }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-Home-Preview': '1', 'Content-Type': 'application/json', Origin: origin, 'X-Home-Save-Key': f.vault.key };
  const post = (input, overrides = {}, path = '/api/draft-storage') => fetch(origin + path, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(input) });
  assert.equal((await post({ action: 'view' }, { 'X-Home-Save-Key': '' })).status, 403);
  assert.equal((await post({ action: 'view' }, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await post({ action: 'view', path: 'arbitrary' })).status, 400);
  assert.equal((await post({ action: 'view', data: 'x'.repeat(2100) })).status, 413);
  assert.equal((await post({}, {}, '/api/save')).status, 404);
  assert.deepEqual(await (await post({ action: 'view' })).json(), { records: [] });
  assert.ok(!(await (await fetch(origin)).text()).includes(f.vault.key));
});
test('Windows encrypted saved examples reopen and corruption is never replaced with an empty vault', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  const probeId = crypto.randomUUID();
  const store = createWindowsReviewedDraftStore({ probeId });
  const f = fixture(store);
  t.after(async () => { await f.vault.close(); await removeWindowsProbeStore({ probeId }); });
  assert.deepEqual(await f.vault.request({ action: 'view' }), { records: [] });
  await assert.rejects(lstat(store.directory), { code: 'ENOENT' });
  f.confirm(); const prepared = await f.prepare();
  await assert.rejects(lstat(store.directory), { code: 'ENOENT' });
  await f.vault.request({ action: 'save', approval: prepared.approval });
  const file = join(store.directory, 'records.bin'); const bytes = await readFile(file);
  assert.equal(bytes.includes(Buffer.from('Willow Studio')), false);
  await f.vault.close();
  const restarted = createReviewedDraftVault({ drafts: createDraftStore(), store: createWindowsReviewedDraftStore({ probeId }) });
  t.after(() => restarted.close());
  assert.equal((await restarted.request({ action: 'view' })).records[0].value, 'Willow Studio');
  const damaged = Buffer.from(bytes); damaged[damaged.length - 1] ^= 1;
  await writeFile(file, damaged);
  await assert.rejects(restarted.request({ action: 'view' }), { code: 'READ_FAILED' });
  assert.deepEqual(await readFile(file), damaged);
  await writeFile(file, bytes);
});
