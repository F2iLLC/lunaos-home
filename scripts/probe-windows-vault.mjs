import assert from 'node:assert/strict';
import { readFile, writeFile, open, unlink, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openWindowsProbeStore } from '../lib/windows-probe-store.js';
import { createVaultSessionService } from '../lib/vault-sessions.js';

const powershell = process.env.LUNA_HOME_PROBE_POWERSHELL || 'pwsh';
const alex = { memberId: 'alex-example', label: 'Workplace', value: 'Willow Studio' };
const sam = { memberId: 'sam-example', label: 'School', value: 'Meadow School' };
const scope = { recordIds: ['alex-work', 'sam-school'], lifetimeMs: 60000 };
const isCode = code => error => error.code === code;
const changedWorkplace = 'Willow Annex';

async function freshReader(probeId, oldGrant, committedWithoutReceipt = false) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--read'], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let tooLarge = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { if (output.length + chunk.length > 4096) { tooLarge = true; child.kill(); } else output += chunk; });
  child.stderr.on('data', () => {});
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill(), 60000);
    child.once('error', () => { clearTimeout(timer); reject(Error('Fresh reader could not start.')); });
    child.once('close', code => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0); assert.equal(tooLarge, false);
        const report = JSON.parse(output);
        assert.equal(report.passed, true); assert.notEqual(report.processId, process.pid);
        resolve();
      } catch { reject(Error('Fresh-process storage check failed.')); }
    });
  });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ probeId, oldGrant, committedWithoutReceipt }));
  await result;
}

async function uncertainWriteChecks(store) {
  // Inject only at the adapter boundary. These are not process-kill tests.
  for (const commit of [false, true]) {
    const baseline = await readFile(join(store.directory, 'records.bin'));
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let writes = 0;
    const service = createVaultSessionService({ store: {
      read: id => store.read(id),
      create: (id, data) => store.create(id, data),
      async edit(id, data) {
        writes++;
        entered.resolve();
        if (commit) await store.edit(id, data);
        await release.promise;
        throw Error('Synthetic private adapter diagnostic');
      },
    } });
    try {
      service.admitDevice('windows-example');
      const connection = service.openConnection({ deviceId: 'windows-example' });
      const grant = service.approveSetup(connection, scope);
      const request = { action: 'edit', recordId: 'alex-work', data: { ...alex, value: changedWorkplace } };
      const first = assert.rejects(connection.execute(grant, request), error => {
        assert.equal(error.code, 'WRITE_UNKNOWN');
        assert.doesNotMatch(error.message, /Synthetic private|Willow/);
        return true;
      });
      await entered.promise;
      const retry = assert.rejects(connection.execute(grant, {
        ...request, data: { ...alex, value: 'Must not be saved' },
      }), isCode('DENIED'));
      release.resolve();
      await Promise.all([first, retry]);
      assert.equal(writes, 1);
      await assert.rejects(connection.execute(grant, { action: 'read', recordId: 'alex-work' }), isCode('DENIED'));
      const reconnected = service.openConnection({ deviceId: 'windows-example' });
      await assert.rejects(reconnected.execute(grant, { action: 'read', recordId: 'alex-work' }), isCode('DENIED'));
      const freshGrant = service.approveReadOnly(reconnected, scope);
      const expected = { ...alex, value: commit ? changedWorkplace : 'Willow Workshop' };
      assert.deepEqual(await reconnected.execute(freshGrant, { action: 'read', recordId: 'alex-work' }), expected);
      const after = await readFile(join(store.directory, 'records.bin'));
      if (commit) assert.notDeepEqual(after, baseline);
      else assert.deepEqual(after, baseline);
      service.shutdown();
      await freshReader(store.probeId, grant, commit);
    } finally {
      release.resolve();
      service.shutdown();
    }
  }
  // Return the isolated fixture to the baseline for the remaining corruption checks.
  await store.edit('alex-work', { ...alex, value: 'Willow Workshop' });
}

if (process.argv[2] === '--read') {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 4096) throw Error('Invalid probe input.'); }
  const { probeId, oldGrant, committedWithoutReceipt } = JSON.parse(input);
  const store = await openWindowsProbeStore({ powershell, probeId });
  const service = createVaultSessionService({ store });
  service.admitDevice('windows-example');
  const connection = service.openConnection({ deviceId: 'windows-example' });
  await assert.rejects(connection.execute(oldGrant, { action: 'read', recordId: 'alex-work' }), isCode('DENIED'));
  const grant = service.approveReadOnly(connection, scope);
  assert.deepEqual(await connection.execute(grant, { action: 'read', recordId: 'alex-work' }), {
    ...alex, value: committedWithoutReceipt ? changedWorkplace : 'Willow Workshop',
  });
  assert.deepEqual(await connection.execute(grant, { action: 'read', recordId: 'sam-school' }), sam);
  service.shutdown();
  console.log(JSON.stringify({ passed: true, processId: process.pid }));
} else {
  const store = await openWindowsProbeStore({ powershell, create: true });
  let tick = 0;
  const service = createVaultSessionService({ store, now: () => tick });
  const file = join(store.directory, 'records.bin');
  try {
    service.admitDevice('windows-example');
    const local = service.openConnection({ deviceId: 'windows-example' });
    const setup = service.approveSetup(local, scope);
    await local.execute(setup, { action: 'create', recordId: 'alex-work', data: alex });
    await local.execute(setup, { action: 'create', recordId: 'sam-school', data: sam });
    await local.execute(setup, { action: 'edit', recordId: 'alex-work', data: { ...alex, value: 'Willow Workshop' } });
    const beforeInvalidWrites = await readFile(file);
    await assert.rejects(store.create('alex-work', alex), /storage operation failed/);
    await assert.rejects(store.edit('missing-record', alex), /storage operation failed/);
    assert.deepEqual(await readFile(file), beforeInvalidWrites);
    const readOnly = service.approveReadOnly(local, scope);
    await assert.rejects(local.execute(readOnly, { action: 'edit', recordId: 'alex-work', data: alex }), isCode('DENIED'));
    await assert.rejects(local.execute(setup, { action: 'delete', recordId: 'alex-work' }), isCode('DENIED'));
    const assistant = service.openConnection({ deviceId: 'windows-example', destination: 'claude' });
    const assistantGrant = service.approveReadOnly(assistant, scope);
    await assert.rejects(assistant.execute(assistantGrant, { action: 'read', recordId: 'alex-work' }), isCode('DISCLOSURE_REQUIRED'));
    service.approveDisclosure(assistant, { grantId: assistantGrant, recordIds: ['alex-work'], fields: ['value'], destination: 'claude', lifetimeMs: 1000 });
    assert.deepEqual(await assistant.execute(assistantGrant, { action: 'read', recordId: 'alex-work' }), { value: 'Willow Workshop' });
    // This is a simulated local assistant connection, not a live model call.
    tick = 60000;
    await assert.rejects(local.execute(setup, { action: 'edit', recordId: 'alex-work', data: alex }), isCode('DENIED'));
    service.shutdown();
    await freshReader(store.probeId, setup);
    await uncertainWriteChecks(store);

    const original = await readFile(file);
    const altered = Buffer.from(original);
    altered[Math.floor(altered.length / 2)] ^= 1;
    await writeFile(file, altered);
    try {
      await assert.rejects(store.read('alex-work'), /storage operation failed/);
      await assert.rejects(store.edit('alex-work', alex), /storage operation failed/);
      assert.deepEqual(await readFile(file), altered); // No fallback overwrite of a corrupt store.
    } finally { await writeFile(file, original); }

    const lockPath = join(store.directory, '.lock');
    const held = await open(lockPath, 'wx');
    try { await assert.rejects(store.edit('alex-work', alex), /storage operation failed/); }
    finally { await held.close(); await unlink(lockPath); }
    assert.deepEqual(await readFile(file), original);
    assert.deepEqual(await store.read('alex-work'), { ...alex, value: 'Willow Workshop' });
    assert.deepEqual(await store.read('sam-school'), sam);
    assert.deepEqual(await readdir(store.directory), ['records.bin']);
    for (const encoding of ['utf8', 'utf16le']) {
      const text = original.toString(encoding);
      for (const marker of ['alex-example', 'sam-example', 'Willow Workshop', 'Meadow School']) assert.equal(text.includes(marker), false);
    }
  } finally {
    service.shutdown();
    await store.removeSyntheticStore();
  }
  await assert.rejects(stat(store.directory), error => error.code === 'ENOENT');
  console.log(JSON.stringify({
    passed: true, encryptedCreateEditRead: true, freshProcessRead: true,
    oldGrantRejectedAfterRestart: true, readOnlyAndExpiredWritesDenied: true,
    preCommitFailurePreservedCiphertext: true, lostReceiptRecoveredAfterRestart: true,
    uncertainWritesInvalidatedConnectionAndDeniedRetry: true,
    separateFieldDisclosureEnforced: true, corruptStoreRejectedWithoutOverwrite: true,
    duplicateCreateAndMissingEditRejected: true,
    concurrentWriterDeniedWithoutChange: true, ciphertextMarkersAbsent: true,
    cleanupVerified: true,
    limit: 'Synthetic local adapter/service test; no GUI, live model, OS unlock, Android or pairing proof.',
  }, null, 2));
}
