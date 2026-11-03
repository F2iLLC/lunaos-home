import assert from 'node:assert/strict';
import { VaultConflictError, VaultUnsupportedRecordError, vaultRevision } from '../../lib/vault-record-contract.js';

// Executable form of docs/architecture/versioned-record-store-conformance.md.
// Each test name starts with its clause ID. An adapter claims conformance only
// when every clause passes on the exact adapter build and platform claimed.
//
// harness = {
//   name,                  label used in test names
//   open(),                -> { store, reopen(), dispose() } over fresh empty storage
//   testOptions,           node:test options (skip/timeout) for this adapter
//   atRest(handle),        optional: raw persisted bytes, for C-14
// }

const alex = { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' };
const sam = { memberId: 'sam-example', label: 'School', value: 'Meadow School' };
const actor = { kind: 'human', id: 'person-example' };
export function syntheticGroceryRecord(items = [{ id: 'apples', label: 'Apples', completed: false }], outcomes = []) {
  return { kind: 'grocery-list', outcomes,
    list: { id: 'weekly', householdId: 'home-example', label: 'Weekly', items,
      revision: '3d735c0e-3176-4502-8717-8e62f59d3a91', updatedBy: actor } };
}

async function unchanged(store, recordId, before, attempt) {
  await attempt();
  assert.deepEqual(await store.read(recordId), before, `${recordId} must be unchanged after a refused mutation`);
}

export const CONFORMANCE_CLAUSES = Object.freeze([
  'C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06', 'C-07', 'C-08',
  'C-09', 'C-10', 'C-11', 'C-12', 'C-13', 'C-14', 'C-15', 'C-16',
]);

export function defineVersionedStoreConformance(test, harness) {
  const { name, testOptions = {} } = harness;
  const clause = (id, title, body, options = {}) =>
    test(`${id} [${name}] ${title}`, { ...testOptions, ...options }, async t => {
      const handle = await harness.open();
      t.after(() => handle.dispose());
      await body(handle, t);
    });

  clause('C-01', 'declares contract v2 and the full adapter surface', async ({ store }) => {
    assert.equal(store.contractVersion, 2);
    for (const method of ['read', 'create', 'edit', 'editProfile', 'delete']) {
      assert.equal(typeof store[method], 'function', `${method} is required`);
    }
  });

  clause('C-02', 'read returns null when absent and exactly { revision, data } when present', async ({ store }) => {
    assert.equal(await store.read('alex-work'), null);
    const { revision } = await store.create('alex-work', alex);
    assert.ok(vaultRevision.safeParse(revision).success, 'revisions are canonical UUID v4 tokens');
    assert.deepEqual(await store.read('alex-work'), { revision, data: alex });
  });

  clause('C-03', 'create requires an absent target; an existing target is a definite conflict', async ({ store }) => {
    await store.create('alex-work', alex);
    const before = await store.read('alex-work');
    await unchanged(store, 'alex-work', before,
      () => assert.rejects(store.create('alex-work', sam), VaultConflictError));
  });

  clause('C-04', 'a matching edit commits and every confirmed edit gets a fresh revision', async ({ store }) => {
    const created = await store.create('alex-work', alex);
    const first = await store.edit('alex-work', alex, created.revision);
    assert.notEqual(first.revision, created.revision, 'identical data still produces a fresh revision');
    const second = await store.editProfile('alex-work', { ...alex, value: 'Reviewed edit' }, first.revision);
    assert.notEqual(second.revision, first.revision);
    assert.deepEqual(await store.read('alex-work'), { revision: second.revision, data: { ...alex, value: 'Reviewed edit' } });
  });

  clause('C-05', 'stale or missing targets are definite conflicts that change nothing', async ({ store }) => {
    const created = await store.create('alex-work', alex);
    const saved = await store.edit('alex-work', { ...alex, value: 'Newer' }, created.revision);
    const before = await store.read('alex-work');
    for (const attempt of [
      () => store.edit('alex-work', sam, created.revision),
      () => store.editProfile('alex-work', sam, created.revision),
      () => store.delete('alex-work', created.revision),
    ]) await unchanged(store, 'alex-work', before, () => assert.rejects(attempt(), VaultConflictError));
    await assert.rejects(store.edit('missing-record', sam, saved.revision), VaultConflictError);
    await assert.rejects(store.delete('missing-record', saved.revision), VaultConflictError);
    assert.equal(await store.read('missing-record'), null);
  });

  clause('C-06', 'a matching delete removes the record and acknowledges the removed revision', async ({ store }) => {
    const created = await store.create('alex-work', alex);
    assert.deepEqual(await store.delete('alex-work', created.revision), { revision: created.revision });
    assert.equal(await store.read('alex-work'), null);
  });

  clause('C-07', 'a recreated record has a fresh revision and rejects every old-incarnation revision', async ({ store }) => {
    const first = await store.create('alex-work', alex);
    const edited = await store.edit('alex-work', sam, first.revision);
    await store.delete('alex-work', edited.revision);
    const recreated = await store.create('alex-work', alex);
    assert.notEqual(recreated.revision, first.revision);
    assert.notEqual(recreated.revision, edited.revision);
    const before = await store.read('alex-work');
    for (const old of [first.revision, edited.revision]) {
      await unchanged(store, 'alex-work', before, () => assert.rejects(store.edit('alex-work', sam, old), VaultConflictError));
      await unchanged(store, 'alex-work', before, () => assert.rejects(store.delete('alex-work', old), VaultConflictError));
    }
  });

  clause('C-08', 'committed records and revisions survive reopen, and reopened adapters keep enforcing revisions', async ({ store, reopen }) => {
    const profile = await store.create('alex-work', alex);
    const grocery = await store.create('weekly', syntheticGroceryRecord());
    const again = await reopen();
    assert.deepEqual(await again.read('alex-work'), { revision: profile.revision, data: alex });
    assert.deepEqual(await again.read('weekly'), { revision: grocery.revision, data: syntheticGroceryRecord() });
    const saved = await again.edit('alex-work', sam, profile.revision);
    await assert.rejects(store.edit('alex-work', alex, profile.revision), VaultConflictError);
    assert.deepEqual(await store.read('alex-work'), { revision: saved.revision, data: sam });
  });

  clause('C-09', 'grocery payloads round-trip exactly through create and edit', async ({ store }) => {
    const outcome = { requestId: '0c4e8e93-2f39-4d0e-9c1d-8a0f9a6f6b11', fingerprint: '{"synthetic":true}',
      receipt: { version: 1, status: 'applied', requestId: '0c4e8e93-2f39-4d0e-9c1d-8a0f9a6f6b11', listId: 'weekly',
        revision: '3d735c0e-3176-4502-8717-8e62f59d3a91', actor } };
    const created = await store.create('weekly', syntheticGroceryRecord());
    const next = syntheticGroceryRecord([{ id: 'apples', label: 'Apples', quantity: 2, unit: 'kg', notes: 'Crisp', completed: true }], [outcome]);
    const saved = await store.edit('weekly', next, created.revision);
    assert.deepEqual(await store.read('weekly'), { revision: saved.revision, data: next });
  });

  clause('C-10', 'the profile-only edit path refuses non-profile targets and data without changing them', async ({ store }) => {
    const grocery = await store.create('weekly', syntheticGroceryRecord());
    const before = await store.read('weekly');
    await unchanged(store, 'weekly', before,
      () => assert.rejects(store.editProfile('weekly', alex, grocery.revision), VaultUnsupportedRecordError));
    const profile = await store.create('alex-work', alex);
    const profileBefore = await store.read('alex-work');
    await unchanged(store, 'alex-work', profileBefore, async () => {
      const error = await store.editProfile('alex-work', syntheticGroceryRecord(), profile.revision).then(() => null, e => e);
      assert.ok(error, 'grocery data must not be written through the profile path');
      assert.equal(error instanceof VaultConflictError, false, 'invalid data is not a revision conflict');
    });
  });

  clause('C-11', 'mutating one record never changes another', async ({ store }) => {
    const a = await store.create('alex-work', alex);
    await store.create('sam-school', sam);
    const grocery = await store.create('weekly', syntheticGroceryRecord());
    const others = { sam: await store.read('sam-school'), weekly: await store.read('weekly') };
    const edited = await store.edit('alex-work', { ...alex, value: 'Changed' }, a.revision);
    await store.delete('alex-work', edited.revision);
    await assert.rejects(store.editProfile('weekly', alex, grocery.revision), VaultUnsupportedRecordError);
    assert.deepEqual(await store.read('sam-school'), others.sam);
    assert.deepEqual(await store.read('weekly'), others.weekly);
  });

  clause('C-12', 'concurrent conditional writes from one revision commit at most once', async ({ store, reopen }) => {
    const created = await store.create('alex-work', alex);
    const writers = [store, await reopen(), await reopen()];
    const results = await Promise.allSettled(writers.map((writer, index) =>
      writer.edit('alex-work', { ...alex, value: `Writer ${index}` }, created.revision)));
    const applied = results.flatMap((result, index) => result.status === 'fulfilled' ? [{ index, revision: result.value.revision }] : []);
    assert.ok(applied.length <= 1, 'two writers must never both commit from the same revision');
    const stored = await store.read('alex-work');
    if (applied.length === 1) {
      assert.deepEqual(stored, { revision: applied[0].revision, data: { ...alex, value: `Writer ${applied[0].index}` } });
    } else {
      // An uncertain failure may still have committed. State must be the original or exactly one writer's.
      assert.ok(stored.revision === created.revision || writers.some((_, i) => stored.data.value === `Writer ${i}`));
    }
  });

  clause('C-13', 'malformed identifiers, revisions and payloads are refused before any change', async ({ store }) => {
    const created = await store.create('alex-work', alex);
    const before = await store.read('alex-work');
    for (const attempt of [
      () => store.edit('alex-work', sam),
      () => store.edit('alex-work', sam, '*'),
      () => store.delete('alex-work', 'not-a-revision'),
      () => store.edit('../outside', sam, created.revision),
      () => store.create('Alex Work', sam),
      () => store.edit('alex-work', { ...sam, extra: true }, created.revision),
      () => store.edit('alex-work', { kind: 'grocery-list', list: { id: 'weekly' }, outcomes: [] }, created.revision),
    ]) {
      await unchanged(store, 'alex-work', before, async () => {
        const error = await attempt().then(() => null, e => e);
        assert.ok(error, 'malformed input must be refused');
        assert.equal(error instanceof VaultConflictError, false, 'malformed input is not a revision conflict');
      });
    }
  });

  clause('C-14', 'persisted bytes contain neither record values nor revisions', async handle => {
    const { store } = handle;
    const saved = await store.create('alex-work', { ...alex, value: 'Distinctive plaintext 4471' });
    await store.create('weekly', syntheticGroceryRecord([{ id: 'apples', label: 'Distinctive grocery 9902', completed: false }]));
    const bytes = await harness.atRest(handle);
    for (const secret of ['Distinctive plaintext 4471', 'Distinctive grocery 9902', saved.revision]) {
      assert.equal(bytes.includes(Buffer.from(secret)), false, `${secret} must not be stored in plaintext`);
    }
  }, { skip: harness.atRest ? testOptions.skip : 'adapter has no persisted bytes (reference adapter)' });

  clause('C-15', 'a commit over the adapter ceiling fails without changing state and is not a conflict', async ({ store }) => {
    const created = await store.create('weekly', syntheticGroceryRecord());
    const before = await store.read('weekly');
    const items = Array.from({ length: 500 }, (_, index) => ({ id: `item-${index}`, label: `Item ${index}`,
      notes: 'n'.repeat(1000), completed: false }));
    await unchanged(store, 'weekly', before, async () => {
      const error = await store.edit('weekly', syntheticGroceryRecord(items), created.revision).then(() => null, e => e);
      assert.ok(error, 'an oversized payload must not commit');
      assert.equal(error instanceof VaultConflictError, false, 'a size refusal is not a revision conflict');
    });
  });

  clause('C-16', 'values are copied at the boundary: mutating inputs or read results never changes stored state', async ({ store }) => {
    const input = structuredClone(alex);
    const { revision } = await store.create('alex-work', input);
    input.value = 'Mutated after create';
    const first = await store.read('alex-work');
    assert.deepEqual(first, { revision, data: alex });
    first.data.value = 'Mutated read result';
    first.revision = '00000000-0000-4000-8000-000000000000';
    assert.deepEqual(await store.read('alex-work'), { revision, data: alex });
    const groceryInput = syntheticGroceryRecord();
    const grocery = await store.create('weekly', groceryInput);
    groceryInput.list.items.push({ id: 'pears', label: 'Pears', completed: false });
    assert.deepEqual(await store.read('weekly'), { revision: grocery.revision, data: syntheticGroceryRecord() });
  });
}
