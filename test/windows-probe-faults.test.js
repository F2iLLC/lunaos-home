import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openWindowsProbeStore, openWindowsProbeStoreForFaultTest, windowsProbeTestFaults } from '../lib/windows-probe-store.js';
import { assertNotebookFaultMatrix, notebookFaultMatrix as windowsFaultMatrix } from './support/notebook-fault-matrix.js';

const windows = { skip: process.platform !== 'win32', timeout: 180000 };
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

// Restart, at-rest secrecy and the profile-session refusal for this store are in
// test/windows-notebook-persistence.test.js.
test('Windows DPAPI probe fault matrix reopens only the complete old or the complete new notebook', windows, async t => {
  const store = await openWindowsProbeStore({ create: true, contractVersion: 2 });
  t.after(() => store.removeSyntheticStore());
  const options = { probeId: store.probeId, contractVersion: 2 };
  await assertNotebookFaultMatrix({
    store,
    reopen: () => openWindowsProbeStore(options),
    withFault: fault => openWindowsProbeStoreForFaultTest(options, fault),
  });
});
