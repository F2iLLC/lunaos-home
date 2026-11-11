import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryVersionedStore } from './support/memory-versioned-store.js';
import { syntheticNotebookRecord } from './support/versioned-store-conformance.js';

const revision = '3d735c0e-3176-4502-8717-8e62f59d3a91';
const profile = { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' };

test('memory reference returns null for missing and deleted records without changing the backing map', async () => {
  const backing = new Map();
  const store = createMemoryVersionedStore(backing);
  assert.equal(await store.read('missing'), null);
  assert.equal(backing.size, 0);
  const created = await store.create('alex-work', profile);
  const before = new Map(backing);
  assert.equal(await store.read('missing'), null);
  assert.deepEqual(backing, before);
  await store.delete('alex-work', created.revision);
  assert.equal(await store.read('alex-work'), null);
  assert.equal(backing.size, 0);
});

for (const [name, encoded] of [
  ['malformed JSON', '{"synthetic":'],
  ['null', 'null'],
  ['primitive', '42'],
  ['array', '[]'],
  ['missing revision', JSON.stringify({ data: profile })],
  ['invalid revision', JSON.stringify({ revision: 'not-a-revision', data: profile })],
  ['missing data', JSON.stringify({ revision })],
  ['invalid profile', JSON.stringify({ revision, data: { ...profile, memberId: '../outside' } })],
  ['invalid list payload', JSON.stringify({ revision, data: { kind: 'household-notebook', notebook: {} } })],
  ['unknown record kind', JSON.stringify({ revision, data: { kind: 'grocery-list', list: {}, outcomes: [] } })],
  ['unknown row field', JSON.stringify({ revision, data: profile, extra: true })],
  ['unknown payload field', JSON.stringify({ revision, data: { ...profile, extra: true } })],
]) {
  test(`memory reference rejects ${name} on reads and conditional mutations without changing stored bytes`, async () => {
    const backing = new Map([['record', encoded]]);
    const store = createMemoryVersionedStore(backing);
    await store.create('unrelated', syntheticNotebookRecord());
    const before = new Map(backing);
    for (const attempt of [
      () => store.read('record'),
      () => store.edit('record', profile, revision),
      () => store.editProfile('record', profile, revision),
      () => store.delete('record', revision),
    ]) {
      await assert.rejects(attempt(), { name: 'TypeError', message: 'Invalid synthetic store row for record ID "record".' });
      assert.deepEqual(backing, before);
    }
  });
}

test('memory reference reads valid profile and list rows from shared backing without rewriting them', async () => {
  const rows = [
    ['alex-work', { revision, data: profile }],
    ['notebook-home-example', { revision, data: syntheticNotebookRecord() }],
  ];
  const backing = new Map(rows.map(([id, row]) => [id, JSON.stringify(row)]));
  const before = new Map(backing);
  const store = createMemoryVersionedStore(backing);
  for (const [id, row] of rows) assert.deepEqual(await store.read(id), row);
  assert.deepEqual(backing, before);
});
