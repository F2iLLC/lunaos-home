import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroceryCommandService, GroceryConflictError } from '../lib/grocery-contract.js';
import { createGroceryPersistence } from '../lib/grocery-persistence.js';
import { VaultConflictError } from '../lib/vault-record-contract.js';

const actor = { kind: 'human', id: 'person-example' };
const list = { id: 'weekly', householdId: 'home-example', label: 'Weekly', items: [],
  revision: '3d735c0e-3176-4502-8717-8e62f59d3a91', updatedBy: actor };
const add = (requestId, expectedRevision = list.revision) => ({ version: 1, action: 'add', requestId,
  householdId: list.householdId, listId: list.id, expectedRevision,
  item: { id: 'apples', label: 'Apples', completed: false } });

function fixture({ loseNextAck = false } = {}) {
  const rows = new Map();
  let writes = 0;
  const store = {
    contractVersion: 2,
    async read(id) { return structuredClone(rows.get(id) ?? null); },
    async create(id, data) {
      if (rows.has(id)) throw new VaultConflictError();
      const saved = { revision: crypto.randomUUID(), data: structuredClone(data) };
      rows.set(id, saved);
      return { revision: saved.revision };
    },
    async edit(id, data, expectedRevision) {
      writes++;
      const current = rows.get(id);
      if (!current || current.revision !== expectedRevision) throw new VaultConflictError();
      const saved = { revision: crypto.randomUUID(), data: structuredClone(data) };
      rows.set(id, saved);
      if (loseNextAck) { loseNextAck = false; throw Error('synthetic lost acknowledgement'); }
      return { revision: saved.revision };
    },
  };
  return { rows, store, getWrites: () => writes };
}

test('list state and applied receipt commit atomically and survive executor restart', async () => {
  const { rows, store, getWrites } = fixture();
  const first = createGroceryPersistence({ store });
  await first.createList(list);
  const command = add(crypto.randomUUID());
  const initialStoreRevision = rows.get(list.id).revision;
  const receipt = await first.execute(command, { actor });
  assert.equal(receipt.status, 'applied');
  assert.equal(rows.get(list.id).data.kind, 'grocery-list');
  assert.equal(rows.get(list.id).data.list.items[0].label, 'Apples');
  assert.equal(rows.get(list.id).data.outcomes[0].receipt.revision, receipt.revision);
  assert.notEqual(rows.get(list.id).revision, initialStoreRevision);
  const before = getWrites();

  const reopened = createGroceryPersistence({ store });
  assert.deepEqual(await reopened.execute(command, { actor }), receipt);
  assert.equal(getWrites(), before, 'replay returns the durable outcome without another write');
});

test('durable request IDs reject changed commands and changed actors', async () => {
  const { store } = fixture();
  const persistence = createGroceryPersistence({ store });
  await persistence.createList(list);
  const command = add(crypto.randomUUID());
  const receipt = await persistence.execute(command, { actor });
  const changed = { ...command, item: { ...command.item, label: 'Pears' } };
  assert.equal((await persistence.execute(changed, { actor })).code, 'REQUEST_ID_REUSED');
  assert.equal((await persistence.execute(command, { actor: { kind: 'human', id: 'other-person' } })).code, 'REQUEST_ID_REUSED');
  assert.equal((await persistence.execute(command, { actor })).revision, receipt.revision);
});

test('lost acknowledgement reconciles by reading the atomically stored receipt without replay', async () => {
  const { store, getWrites } = fixture({ loseNextAck: true });
  const persistence = createGroceryPersistence({ store });
  await persistence.createList(list);
  const command = add(crypto.randomUUID());
  const receipt = await persistence.execute(command, { actor });
  assert.equal(receipt.status, 'applied');
  assert.equal(getWrites(), 1);
});

const operationCases = [
  ['add', { items: [] }, { action: 'add', item: { id: 'apples', label: 'Apples', completed: false } }],
  ['edit', { items: [{ id: 'apples', label: 'Apples', completed: false }] },
    { action: 'edit', itemId: 'apples', patch: { label: 'Green apples' } }],
  ['check', { items: [{ id: 'apples', label: 'Apples', completed: false }] }, { action: 'check', itemId: 'apples' }],
  ['uncheck', { items: [{ id: 'apples', label: 'Apples', completed: true }] }, { action: 'uncheck', itemId: 'apples' }],
  ['remove', { items: [{ id: 'apples', label: 'Apples', completed: false }] }, { action: 'remove', itemId: 'apples' }],
];

function mutationFixture({ loseAck = false, failReconcileRead = false } = {}) {
  const rows = new Map();
  let writes = 0;
  let reads = 0;
  let failedReconcile = false;
  const store = {
    contractVersion: 2,
    async read(id) {
      reads++;
      if (failReconcileRead && writes > 0 && reads > 1 && !failedReconcile) {
        failedReconcile = true;
        throw Error('synthetic read unavailable');
      }
      return structuredClone(rows.get(id) ?? null);
    },
    async create(id, data) {
      const saved = { revision: crypto.randomUUID(), data: structuredClone(data) };
      rows.set(id, saved);
      return { revision: saved.revision };
    },
    async edit(id, data, expectedRevision) {
      writes++;
      const current = rows.get(id);
      if (!current || current.revision !== expectedRevision) throw new VaultConflictError();
      const saved = { revision: crypto.randomUUID(), data: structuredClone(data) };
      rows.set(id, saved);
      if (loseAck) throw Error('synthetic lost acknowledgement');
      return { revision: saved.revision };
    },
  };
  return { rows, store, getWrites: () => writes };
}

function mutationCommand(action, requestId, expectedRevision, specific) {
  return { version: 1, requestId, householdId: list.householdId, listId: list.id,
    expectedRevision, ...specific, action };
}

for (const [action, state, specific] of operationCases) {
  test(`reopen reconciles ${action}: same ID is stable; changed command/actor and stale revision conflict`, async () => {
    const { store, rows, getWrites } = mutationFixture();
    const persistence = createGroceryPersistence({ store });
    const initial = { ...list, items: structuredClone(state.items) };
    await persistence.createList(initial);
    const command = mutationCommand(action, crypto.randomUUID(), initial.revision, specific);
    const receipt = await persistence.execute(command, { actor });
    assert.equal(receipt.status, 'applied');
    const afterCommit = rows.get(list.id).data.list;
    const reopened = createGroceryPersistence({ store });
    const writesAfterCommit = getWrites();
    assert.deepEqual(await reopened.execute(command, { actor }), receipt);
    assert.equal(getWrites(), writesAfterCommit, 'same-ID retry must not write after reopen');

    const changed = action === 'add'
      ? { ...command, item: { ...command.item, label: 'Pears' } }
      : { ...command, ...(action === 'edit' ? { patch: { label: 'Pears' } } : { itemId: 'different-item' }) };
    assert.equal((await reopened.execute(changed, { actor })).code, 'REQUEST_ID_REUSED');
    assert.equal((await reopened.execute(command, { actor: { kind: 'human', id: 'other-person' } })).code,
      'REQUEST_ID_REUSED');
    const stale = { ...command, requestId: crypto.randomUUID() };
    await assert.rejects(reopened.execute(stale, { actor }), GroceryConflictError);
    assert.deepEqual(rows.get(list.id).data.list, afterCommit);
  });

  test(`reopen reconciles ${action} after a lost acknowledgement without replay`, async () => {
    const { store, getWrites } = mutationFixture({ loseAck: true });
    const persistence = createGroceryPersistence({ store });
    const initial = { ...list, items: structuredClone(state.items) };
    await persistence.createList(initial);
    const command = mutationCommand(action, crypto.randomUUID(), initial.revision, specific);
    const receipt = await persistence.execute(command, { actor });
    const reopened = createGroceryPersistence({ store });
    assert.deepEqual(await reopened.execute(command, { actor }), receipt);
    assert.equal(getWrites(), 1, 'lost acknowledgement and reopen must not replay the mutation');
  });
}

test('unreadable reconciliation stays unknown; a later fresh read resolves without automatic replay', async () => {
  const { store, rows, getWrites } = mutationFixture({ loseAck: true, failReconcileRead: true });
  const initialPersistence = createGroceryPersistence({ store });
  await initialPersistence.createList(list);
  const service = createGroceryCommandService({
    withSessionAuthority: async (_requirement, operation) => operation({ actor, householdId: list.householdId, listId: list.id }),
    execute: initialPersistence.execute,
  });
  const command = add(crypto.randomUUID());
  const unknown = await service.execute(command);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.next, 'read-before-retry');
  assert.equal(getWrites(), 1);
  const durable = rows.get(list.id).data;
  assert.equal(durable.list.items[0].id, 'apples');
  assert.equal(durable.outcomes[0].receipt.requestId, command.requestId);
  const laterRead = await service.execute({ version: 1, action: 'query', requestId: crypto.randomUUID(),
    householdId: list.householdId, listId: list.id });
  assert.equal(laterRead.status, 'queried');
  assert.equal(laterRead.list.items[0].id, 'apples');
  assert.equal(getWrites(), 1, 'later read observes the outcome without replaying it');
});

const atomicFaults = [
  ['before-write', 'old'],
  ['during-write', 'old'],
  ['after-write-before-replacement', 'old'],
  ['before-replacement', 'old'],
  ['disk-full-during-write', 'old'],
  ['process-interruption-during-write', 'old'],
  ['tampered-temporary-before-replacement', 'old'],
  ['after-replacement', 'new'],
  ['process-interruption-after-replacement', 'new'],
];

for (const [fault, expectedCommit] of atomicFaults) {
  test(`commit-boundary simulation ${fault} submits one list/receipt payload and reopens its modeled pair`, async () => {
    let committed;
    let temporary;
    let editCalls = 0;
    let candidateData;
    const store = {
      contractVersion: 2,
      async read() { return structuredClone(committed ?? null); },
      async create(_id, data) {
        committed = { revision: crypto.randomUUID(), data: structuredClone(data) };
        return { revision: committed.revision };
      },
      async edit(_id, data, expectedRevision) {
        editCalls++;
        candidateData = structuredClone(data);
        if (committed.revision !== expectedRevision) throw new VaultConflictError();
        temporary = JSON.stringify({ revision: crypto.randomUUID(), data });
        if (fault === 'during-write' || fault === 'disk-full-during-write' || fault === 'process-interruption-during-write') {
          temporary = temporary.slice(0, Math.floor(temporary.length / 2));
          throw Error(fault);
        }
        if (fault === 'tampered-temporary-before-replacement') {
          temporary = temporary.replace('Apples', 'Tampered');
          throw Error(fault);
        }
        if (['before-write', 'after-write-before-replacement', 'before-replacement'].includes(fault)) throw Error(fault);
        const replacement = JSON.parse(temporary);
        committed = replacement;
        temporary = undefined;
        if (fault === 'after-replacement' || fault === 'process-interruption-after-replacement') throw Error(fault);
        return { revision: committed.revision };
      },
    };
    const persistence = createGroceryPersistence({ store });
    await persistence.createList(list);
    const command = add(crypto.randomUUID());
    let receipt;
    try { receipt = await persistence.execute(command, { actor }); }
    catch { /* A pre-replacement failure leaves outcome reconciliation to a later read. */ }

    assert.equal(editCalls, 1, 'the adapter receives one compare-and-swap write');
    assert.equal(candidateData.kind, 'grocery-list');
    assert.equal(candidateData.list.items[0].id, command.item.id);
    assert.equal(candidateData.outcomes.length, 1);
    assert.equal(candidateData.outcomes[0].requestId, command.requestId);
    assert.equal(candidateData.outcomes[0].receipt.revision, candidateData.list.revision);

    // This in-memory boundary models atomic replacement; Windows-specific
    // filesystem evidence is supplied by windows-grocery-persistence.test.js.
    const reopened = createGroceryPersistence({ store });
    const stored = await store.read(list.id);
    const hasReceipt = stored.data.outcomes.some(outcome => outcome.requestId === command.requestId);
    assert.equal(hasReceipt, expectedCommit === 'new');
    assert.equal(stored.data.list.items.length, expectedCommit === 'new' ? 1 : 0);
    if (expectedCommit === 'new') {
      const recovered = await reopened.execute(command, { actor });
      assert.equal(recovered.status, 'applied');
      assert.equal(recovered.requestId, command.requestId);
      assert.equal(stored.data.outcomes[0].receipt.revision, stored.data.list.revision);
      assert.deepEqual(stored.data.outcomes[0].receipt, recovered);
    } else {
      assert.deepEqual(stored.data.list, list);
      assert.equal(hasReceipt, false, 'old list and no success receipt must remain paired');
    }
  });
}

test('stale revisions conflict and full durable outcome ledger fails closed', async () => {
  const { store } = fixture();
  const persistence = createGroceryPersistence({ store, maxOutcomes: 1 });
  await persistence.createList(list);
  const first = add(crypto.randomUUID());
  await persistence.execute(first, { actor });
  await assert.rejects(persistence.execute(add(crypto.randomUUID()), { actor }), GroceryConflictError);
  const replay = createGroceryPersistence({ store, maxOutcomes: 1 });
  const current = await rowsList(store, list.id);
  const second = { ...add(crypto.randomUUID(), current.revision), item: { id: 'pears', label: 'Pears', completed: false } };
  await assert.rejects(replay.execute(second, { actor }), { code: 'BUSY' });
});

test('grocery persistence integrates with the shared command receipt service', async () => {
  const { store } = fixture();
  const persistence = createGroceryPersistence({ store });
  await persistence.createList(list);
  const service = createGroceryCommandService({
    withSessionAuthority: async (_requirement, operation) => operation({
      actor, householdId: list.householdId, listId: list.id,
    }),
    execute: persistence.execute,
  });
  const command = add(crypto.randomUUID());
  const receipt = await service.execute(command);
  assert.deepEqual(await service.execute(command), receipt);
  const reopened = createGroceryPersistence({ store });
  assert.deepEqual(await reopened.execute(command, { actor }), receipt);
});

async function rowsList(store, id) { return (await store.read(id)).data.list; }
