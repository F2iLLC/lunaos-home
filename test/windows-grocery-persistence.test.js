import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createGroceryPersistence } from '../lib/grocery-persistence.js';
import { openWindowsProbeStore, openWindowsProbeStoreForFaultTest, windowsProbeTestFaults } from '../lib/windows-probe-store.js';
import { createVaultSessionService } from '../lib/vault-sessions.js';

const windows = { skip: process.platform !== 'win32', timeout: 60000 };
const windowsFaultMatrix = [
  ['before-write', 'old'], ['during-write', 'old'], ['after-write', 'old'],
  ['before-replacement', 'old'], ['after-replacement', 'new'], ['disk-full', 'old'],
  ['process-interruption', 'old'], ['tampered-temporary', 'old'],
];
const list = { id: 'weekly', householdId: 'home-example', label: 'Weekly', items: [],
  revision: '3d735c0e-3176-4502-8717-8e62f59d3a91', updatedBy: { kind: 'human', id: 'person-example' } };

test('Windows probe rejects unsupported fault-injection options before platform access', async () => {
  await assert.rejects(openWindowsProbeStoreForFaultTest({ contractVersion: 2 }, 'unknown-fault'), TypeError);
  await assert.rejects(openWindowsProbeStoreForFaultTest({ contractVersion: 1 }, 'before-write'), TypeError);
  await assert.rejects(openWindowsProbeStoreForFaultTest({ contractVersion: 2 }, null), TypeError);
  // The production-facing opener has no fault parameter and refuses one instead of ignoring it.
  await assert.rejects(openWindowsProbeStore({ contractVersion: 2, testFault: 'before-write' }), /openWindowsProbeStoreForFaultTest/);
});

test('fault definitions have one source shared by the worker, the wrapper and the Windows matrix', async () => {
  const { faults, operations } = windowsProbeTestFaults();
  assert.deepEqual(operations, ['create', 'edit', 'edit-profile', 'delete']);
  assert.deepEqual(windowsFaultMatrix.map(([fault]) => fault).sort(), [...faults].sort(), 'the Windows matrix covers every defined fault');
  const worker = await readFile(new URL('../scripts/windows-vault-worker.ps1', import.meta.url), 'utf8');
  assert.match(worker, /windows-vault-faults\.json/);
  // Validation must come from the shared file.
  assert.match(worker, /\$operation -cnotin \$faultContract\.operations/);
  assert.match(worker, /\$request\.testFault -cnotin \$faultContract\.faults/);
  // Fault names may appear only in the branches that implement each fault's
  // behaviour. Any other form of private list (-notin, a hashtable, a variable,
  // a different order) puts a fault literal on a non-branch line and fails here.
  const faultLiteral = new RegExp(`'(?:${faults.join('|')})'`);
  const literalLines = worker.split(/\r?\n/).filter(line => faultLiteral.test(line));
  assert.ok(literalLines.length > 0, 'the worker implements the defined faults');
  for (const line of literalLines) {
    assert.match(line, /^\s*if \(\$testFault -c(?:eq|in) /, `fault names belong only in behaviour branches: ${line.trim()}`);
  }
});

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

test('Windows DPAPI probe fault matrix reopens only complete old or new grocery/list receipt pairs', windows, async t => {
  const store = await openWindowsProbeStore({ create: true, contractVersion: 2 });
  t.after(() => store.removeSyntheticStore());
  const initialList = { ...list, items: [{ id: 'apples', label: 'Apples', completed: false }] };
  await createGroceryPersistence({ store }).createList(initialList);
  let expectedRevision = initialList.revision;
  let expectedLabel = 'Apples';
  for (const [testFault, outcome] of windowsFaultMatrix) {
    const label = `Fixture ${testFault}`;
    const faultStore = await openWindowsProbeStoreForFaultTest({ probeId: store.probeId, contractVersion: 2 }, testFault);
    const persistence = createGroceryPersistence({ store: faultStore });
    const command = { version: 1, action: 'edit', requestId: crypto.randomUUID(), householdId: list.householdId,
      listId: list.id, expectedRevision, itemId: 'apples', patch: { label } };
    let result;
    let failure;
    try { result = await persistence.execute(command, { actor: list.updatedBy }); }
    catch (error) { failure = error; }

    const reopened = await openWindowsProbeStore({ probeId: store.probeId, contractVersion: 2 });
    const row = await reopened.read(list.id);
    const grocery = row.data;
    const outcomeRecord = grocery.outcomes.find(entry => entry.requestId === command.requestId);
    assert.equal(outcomeRecord !== undefined, outcome === 'new', `${testFault}: durable receipt presence`);
    assert.equal(grocery.list.items[0].label, outcome === 'new' ? label : expectedLabel, `${testFault}: list state`);
    if (outcome === 'new') {
      assert.equal(result?.status, 'applied');
      assert.equal(result.revision, grocery.list.revision);
      assert.deepEqual(outcomeRecord.receipt, result);
      expectedRevision = grocery.list.revision;
      expectedLabel = label;
    } else {
      assert.ok(failure, `${testFault}: failed write must not claim success`);
      assert.equal(outcomeRecord, undefined, `${testFault}: no success receipt may accompany the old list`);
      expectedRevision = grocery.list.revision;
    }
  }
});
