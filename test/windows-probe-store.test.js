import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';

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
