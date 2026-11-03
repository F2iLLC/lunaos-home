import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createGroceryPersistence } from '../lib/grocery-persistence.js';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { createVaultSessionService } from '../lib/vault-sessions.js';

const windows = { skip: process.platform !== 'win32', timeout: 60000 };
const list = { id: 'weekly', householdId: 'home-example', label: 'Weekly', items: [],
  revision: '3d735c0e-3176-4502-8717-8e62f59d3a91', updatedBy: { kind: 'human', id: 'person-example' } };

test('encrypted grocery payload and receipts survive reopen; profile sessions cannot reinterpret them', windows, async t => {
  const store = await openWindowsProbeStore({ create: true, contractVersion: 2 });
  const service = createVaultSessionService({ store, contractVersion: 2 });
  t.after(async () => { await service.shutdown(); await store.removeSyntheticStore(); });

  const persistence = createGroceryPersistence({ store });
  await persistence.createList(list);
  const command = { version: 1, action: 'add', requestId: crypto.randomUUID(), householdId: list.householdId,
    listId: list.id, expectedRevision: list.revision, item: { id: 'apples', label: 'Apples', completed: false } };
  const receipt = await persistence.execute(command, { actor: list.updatedBy });
  const file = await readFile(path.join(store.directory, 'records.bin'));
  assert.equal(file.includes(Buffer.from('Apples')), false);
  assert.equal(file.includes(Buffer.from(receipt.revision)), false);

  const reopenedStore = await openWindowsProbeStore({ probeId: store.probeId, contractVersion: 2 });
  const reopened = createGroceryPersistence({ store: reopenedStore });
  assert.deepEqual(await reopened.execute(command, { actor: list.updatedBy }), receipt);

  service.admitDevice('windows-example');
  const connection = service.openConnection({ deviceId: 'windows-example' });
  const grant = service.approveSetup(connection, { recordIds: [list.id], lifetimeMs: 60000 });
  await assert.rejects(connection.execute(grant, { version: 2, action: 'read', recordId: list.id }), { code: 'READ_FAILED' });
  const stored = await reopenedStore.read(list.id);
  await assert.rejects(connection.execute(grant, { version: 2, action: 'edit', recordId: list.id,
    expectedRevision: stored.revision, data: { memberId: 'member-example', label: 'Profile', value: 'Profile value' } }),
  { code: 'UNSUPPORTED' });
});
