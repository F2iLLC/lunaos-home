import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { exportWindowsSyntheticBackup, restoreWindowsSyntheticBackup } from '../lib/windows-portable-backup.js';
import { createVaultSessionService } from '../lib/vault-sessions.js';

async function restoreInFreshProcess(probeId, archive, recoveryKey) {
  const code = `
    import { openWindowsProbeStore } from './lib/windows-probe-store.js';
    import { restoreWindowsSyntheticBackup } from './lib/windows-portable-backup.js';
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 131072) throw Error('input');
    }
    const request = JSON.parse(input);
    const store = await openWindowsProbeStore({ probeId: request.probeId, recovery: true });
    await restoreWindowsSyntheticBackup(store,
      Buffer.from(request.archive, 'base64'), Buffer.from(request.key, 'base64'));
    process.stdout.write('restored');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; if (output.length > 32) child.kill(); });
  child.stderr.on('data', () => {});
  child.stdin.end(JSON.stringify({ probeId, archive: archive.toString('base64'), key: recoveryKey.toString('base64') }));
  const codeResult = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(Error('fresh restore timed out')); }, 60000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', result => { clearTimeout(timeout); resolve(result); });
  });
  assert.equal(codeResult, 0);
  assert.equal(output, 'restored');
}

async function withFreshProcessSession(probeId, action) {
  const code = `
    import { openWindowsProbeStore } from './lib/windows-probe-store.js';
    import { createVaultSessionService } from './lib/vault-sessions.js';
    const store = await openWindowsProbeStore({ probeId });
    const service = createVaultSessionService({ store });
    process.stdout.write('ready');
    process.stdin.resume();
    process.stdin.on('end', () => { service.shutdown(); process.stdout.write('stopped'); });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', () => {});
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(Error('fresh session timed out')); }, 60000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.stdout.once('data', chunk => {
      if (chunk.includes('ready')) { clearTimeout(timeout); resolve(); }
    });
  });
  try { await action(); }
  finally {
    child.stdin.end();
    const codeResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(Error('fresh session shutdown timed out')); }, 60000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', result => { clearTimeout(timeout); resolve(result); });
    });
    assert.equal(codeResult, 0);
    assert.ok(output.includes('stopped'));
  }
}

test('fictional backup imports into an empty independent Windows store without carrying old grants',
  { skip: process.platform !== 'win32' }, async t => {
    const source = await openWindowsProbeStore({ create: true, recovery: true });
    let sourceExists = true;
    t.after(async () => { if (sourceExists) await source.removeSyntheticStore(); });
    const destination = await openWindowsProbeStore({ create: true, recovery: true });
    t.after(() => destination.removeSyntheticStore());
    const alex = { memberId: 'alex-example', label: 'Library visit', value: 'Monday fictional visit' };
    const sam = { memberId: 'sam-example', label: 'School', value: 'Meadow School' };
    const service = createVaultSessionService({ store: source });
    service.admitDevice('windows-example');
    const connection = service.openConnection({ deviceId: 'windows-example' });
    const oldGrant = service.approveSetup(connection,
      { recordIds: ['alex-library', 'sam-school', 'count', 'keys', '__proto__'], lifetimeMs: 60000 });
    await connection.execute(oldGrant, { action: 'create', recordId: 'alex-library', data: alex });
    await connection.execute(oldGrant, { action: 'create', recordId: 'sam-school', data: sam });
    await connection.execute(oldGrant, { action: 'create', recordId: 'count', data: alex });
    await connection.execute(oldGrant, { action: 'create', recordId: 'keys', data: sam });
    await connection.execute(oldGrant, { action: 'create', recordId: '__proto__', data: alex });
    const originalDestination = await readFile(path.join(destination.directory, 'records.bin'));
    const { archive, recoveryKey } = await exportWindowsSyntheticBackup(source);
    try {
      service.shutdown();
      await source.removeSyntheticStore();
      sourceExists = false;
      assert.equal(archive.includes(Buffer.from(alex.value)), false);
      const future = JSON.parse(archive);
      future.version = 2;
      for (const [candidate, key] of [
        [archive, randomBytes(32)],
        [archive.subarray(0, archive.length - 1), recoveryKey],
        [Buffer.from(JSON.stringify(future)), recoveryKey],
      ]) {
        await assert.rejects(restoreWindowsSyntheticBackup(destination, candidate, key));
        assert.deepEqual(await readFile(path.join(destination.directory, 'records.bin')), originalDestination);
      }
      const liveService = createVaultSessionService({ store: destination });
      liveService.admitDevice('windows-example');
      const liveConnection = liveService.openConnection({ deviceId: 'windows-example' });
      const liveGrant = liveService.approveReadOnly(liveConnection,
        { recordIds: ['alex-library'], lifetimeMs: 60000 });
      const secondHandle = await openWindowsProbeStore({ probeId: destination.probeId, recovery: true });
      await assert.rejects(restoreWindowsSyntheticBackup(secondHandle, archive, recoveryKey),
        /Close active synthetic vault sessions/);
      await assert.rejects(secondHandle.importSnapshot({ schema: 1, records: {} }),
        /Close active synthetic vault sessions/);
      assert.deepEqual(await readFile(path.join(destination.directory, 'records.bin')), originalDestination);
      await assert.rejects(liveConnection.execute(liveGrant, { action: 'read', recordId: 'alex-library' }),
        error => error.code === 'NOT_FOUND');
      await liveService.shutdown();
      await withFreshProcessSession(destination.probeId, async () => {
        await assert.rejects(restoreWindowsSyntheticBackup(destination, archive, recoveryKey), /active or its recovery lock/);
        assert.deepEqual(await readFile(path.join(destination.directory, 'records.bin')), originalDestination);
      });
      await restoreInFreshProcess(destination.probeId, archive, recoveryKey);
      const reopened = await openWindowsProbeStore({ probeId: destination.probeId });
      assert.equal(reopened.exportSnapshot, undefined);
      assert.equal(reopened.importSnapshot, undefined);
      assert.deepEqual(await reopened.read('alex-library'), alex);
      assert.deepEqual(await reopened.read('sam-school'), sam);
      assert.deepEqual(await reopened.read('count'), alex);
      assert.deepEqual(await reopened.read('keys'), sam);
      assert.deepEqual(await reopened.read('__proto__'), alex);
      const restoredService = createVaultSessionService({ store: reopened });
      restoredService.admitDevice('windows-example');
      const restoredConnection = restoredService.openConnection({ deviceId: 'windows-example' });
      await assert.rejects(restoredConnection.execute(oldGrant, { action: 'read', recordId: 'alex-library' }),
        error => error.code === 'DENIED');
      const freshGrant = restoredService.approveReadOnly(restoredConnection,
        { recordIds: ['alex-library'], lifetimeMs: 60000 });
      assert.deepEqual(await restoredConnection.execute(freshGrant, { action: 'read', recordId: 'alex-library' }), alex);
      restoredService.shutdown();
      const restoredBytes = await readFile(path.join(destination.directory, 'records.bin'));
      await assert.rejects(restoreWindowsSyntheticBackup(destination, archive, recoveryKey));
      assert.deepEqual(await readFile(path.join(destination.directory, 'records.bin')), restoredBytes);
    } finally {
      service.shutdown();
      recoveryKey.fill(0);
    }
  });

test('Windows worker exports and restores an archive larger than the old 64 KiB limit',
  { skip: process.platform !== 'win32' }, async t => {
    const source = await openWindowsProbeStore({ create: true, recovery: true });
    const destination = await openWindowsProbeStore({ create: true, recovery: true });
    t.after(() => source.removeSyntheticStore());
    t.after(() => destination.removeSyntheticStore());
    const entries = Array.from({ length: 64 }, (_, index) => [
      `record-${index.toString().padStart(2, '0')}${'a'.repeat(71)}`,
      { memberId: 'm'.repeat(80), label: '😀'.repeat(40), value: '🔒'.repeat(120) },
    ]);
    const snapshot = { schema: 1, records: Object.fromEntries(entries) };
    await source.importSnapshot(snapshot);
    const { archive, recoveryKey } = await exportWindowsSyntheticBackup(source);
    try {
      assert.ok(archive.length > 65536);
      await restoreWindowsSyntheticBackup(destination, archive, recoveryKey);
      const recovered = await destination.exportSnapshot();
      assert.deepEqual(recovered, snapshot);
    } finally { recoveryKey.fill(0); }
  });
