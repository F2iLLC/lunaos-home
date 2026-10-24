import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, access } from 'node:fs/promises';
import path from 'node:path';
import { openWindowsProbeStore, removeWindowsProbeStore } from '../lib/windows-probe-store.js';
import { openWindowsPairingRegistry } from '../lib/windows-pairing-registry.js';
import { createVaultSessionService } from '../lib/vault-sessions.js';

for (const damage of ['missing', 'corrupt']) {
  test(`owned cleanup removes a ${damage} record store without opening it`,
    { skip: process.platform !== 'win32' }, async t => {
      const store = await openWindowsProbeStore({ create: true });
      t.after(async () => {
        try { await access(store.directory); } catch { return; }
        await removeWindowsProbeStore({ probeId: store.probeId });
      });
      const neighbor = await openWindowsProbeStore({ create: true });
      t.after(() => neighbor.removeSyntheticStore());
      const neighborFile = path.join(neighbor.directory, 'records.bin');
      const neighborBytes = await readFile(neighborFile);
      const registry = openWindowsPairingRegistry({ probeId: store.probeId, hostFingerprint: 'a'.repeat(64) });
      if (damage === 'corrupt') await registry.add('b'.repeat(64));
      const file = path.join(store.directory, 'records.bin');
      if (damage === 'missing') await unlink(file);
      else await writeFile(file, 'damaged fictional ciphertext');
      await assert.rejects(openWindowsProbeStore({ probeId: store.probeId }), /synthetic storage operation failed/);
      // Same order as retained restart cleanup; absent enrollment is also valid
      // when preparation failed before the first record envelope was committed.
      await registry.removeSyntheticRegistry();
      await removeWindowsProbeStore({ probeId: store.probeId });
      await assert.rejects(access(store.directory), { code: 'ENOENT' });
      assert.deepEqual(await readFile(neighborFile), neighborBytes);
    });
}

test('direct fictional cleanup requires a UUID and preserves locks and unknown files',
  { skip: process.platform !== 'win32' }, async t => {
    await assert.rejects(removeWindowsProbeStore());
    await assert.rejects(removeWindowsProbeStore({ probeId: '../outside' }));
    const store = await openWindowsProbeStore({ create: true });
    t.after(() => removeWindowsProbeStore({ probeId: store.probeId }));
    const lock = path.join(store.directory, '.lock');
    const file = path.join(store.directory, 'records.bin');
    const bytes = await readFile(file);
    await writeFile(lock, 'fictional existing controller', { flag: 'wx' });
    try {
      await assert.rejects(removeWindowsProbeStore({ probeId: store.probeId }), /synthetic storage operation failed/);
      assert.deepEqual(await readFile(file), bytes);
      assert.equal(await readFile(lock, 'utf8'), 'fictional existing controller');
    } finally { await unlink(lock); }
    const unknown = path.join(store.directory, 'unknown.txt');
    await writeFile(unknown, 'must survive', { flag: 'wx' });
    try {
      await assert.rejects(removeWindowsProbeStore({ probeId: store.probeId }), /synthetic storage operation failed/);
      assert.equal(await readFile(unknown, 'utf8'), 'must survive');
    } finally { await unlink(unknown); }
  });

test('explicit deletion persists through reopen and preserves other family records',
  { skip: process.platform !== 'win32' }, async t => {
    const store = await openWindowsProbeStore({ create: true });
    const service = createVaultSessionService({ store });
    t.after(async () => { await service.shutdown(); await store.removeSyntheticStore(); });
    const alex = { memberId: 'alex-example', label: 'Library', value: 'Moonrise Library' };
    const sam = { memberId: 'sam-example', label: 'School', value: 'Meadow School' };
    service.admitDevice('windows-example');
    const local = service.openConnection({ deviceId: 'windows-example' });
    const setup = service.approveSetup(local, { recordIds: ['alex-library', 'sam-school'], lifetimeMs: 60000 });
    await local.execute(setup, { action: 'create', recordId: 'alex-library', data: alex });
    await local.execute(setup, { action: 'create', recordId: 'sam-school', data: sam });
    const file = path.join(store.directory, 'records.bin');
    const before = await readFile(file);
    await assert.rejects(local.execute(setup, { action: 'delete', recordId: 'alex-library' }), { code: 'DENIED' });
    assert.deepEqual(await readFile(file), before);
    const grant = service.approveDelete(local, { recordIds: ['alex-library'], lifetimeMs: 60000 });
    assert.deepEqual(await local.execute(grant, { action: 'delete', recordId: 'alex-library' }), {
      status: 'applied', recordId: 'alex-library', accessEnded: false,
    });
    const reopened = await openWindowsProbeStore({ probeId: store.probeId });
    assert.equal(await reopened.read('alex-library'), null);
    assert.deepEqual(await reopened.read('sam-school'), sam);
    const after = await readFile(file);
    assert.equal(after.includes(Buffer.from(sam.value)), false);
    await assert.rejects(reopened.delete('missing-record'), /synthetic storage operation failed/);
    await assert.rejects(reopened.delete('../outside'));
    assert.deepEqual(await readFile(file), after, 'rejected deletions preserve committed ciphertext');
    const damaged = Buffer.from(after);
    damaged[damaged.length - 1] ^= 1;
    try {
      await writeFile(file, damaged);
      await assert.rejects(reopened.delete('sam-school'), /synthetic storage operation failed/);
      assert.deepEqual(await readFile(file), damaged, 'corrupt store is never overwritten by deletion');
    } finally {
      await writeFile(file, after);
    }
    assert.deepEqual(await reopened.read('sam-school'), sam);
  });

test('a raw ciphertext copy into another synthetic Windows store is refused without changing either source record',
  { skip: process.platform !== 'win32' }, async t => {
    const source = await openWindowsProbeStore({ create: true });
    t.after(() => source.removeSyntheticStore());
    const target = await openWindowsProbeStore({ create: true });
    t.after(() => target.removeSyntheticStore());
    const sourceRecord = { memberId: 'alex-example', label: 'Library visit', value: 'Monday fictional visit' };
    const targetRecord = { memberId: 'sam-example', label: 'Library visit', value: 'Tuesday fictional visit' };
    await source.create('alex-library', sourceRecord);
    await target.create('sam-library', targetRecord);
    const sourceFile = path.join(source.directory, 'records.bin');
    const targetFile = path.join(target.directory, 'records.bin');
    const sourceBytes = await readFile(sourceFile);
    const targetBytes = await readFile(targetFile);
    assert.equal(sourceBytes.includes(Buffer.from(sourceRecord.value)), false);
    try {
      await writeFile(targetFile, sourceBytes);
      await assert.rejects(openWindowsProbeStore({ probeId: target.probeId }), /synthetic storage operation failed/);
      await assert.rejects(target.read('sam-library'), /synthetic storage operation failed/);
      assert.deepEqual(await readFile(targetFile), sourceBytes, 'denied open must not rewrite copied bytes');
      assert.deepEqual(await source.read('alex-library'), sourceRecord);
    } finally {
      await writeFile(targetFile, targetBytes);
    }
    const reopened = await openWindowsProbeStore({ probeId: target.probeId });
    assert.deepEqual(await reopened.read('sam-library'), targetRecord);
    assert.deepEqual(await readFile(sourceFile), sourceBytes);
  });
