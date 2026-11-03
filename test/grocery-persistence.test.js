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
