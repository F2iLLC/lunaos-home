// Attended Software KSP unlock-session journey for WindowsSnapshotFileStore v1.
// Fictional records and a disposable key only. This runner never asks for,
// reads or logs a password: every password is typed into the Windows-owned
// dialog. Evidence holds stage names and results, nothing else.
//
//   node scripts/test-attended-snapshot-session.mjs
//   node scripts/test-attended-snapshot-session.mjs --cleanup <store id>
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WORKER, VaultLockedError, discardSyntheticKspStore, openWindowsSnapshotSession, openWindowsSnapshotSessionForTest,
} from '../lib/windows-snapshot-store.js';
import { VaultConflictError } from '../lib/vault-record-contract.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const protector = { kind: 'software-ksp' };
assert.equal(process.platform, 'win32', 'Windows is required');
const [mode, argument] = process.argv.slice(2);
if (mode === '--cleanup') {
  await discardSyntheticKspStore({ storeId: argument });
  console.log('disposable-key-and-store-removed');
  process.exit(0);
}
assert.equal(mode, undefined, 'Usage: [--cleanup <store id>]');
assert.ok(
  process.stdin.isTTY && process.stdout.isTTY,
  'Use an attended interactive terminal',
);

const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceHead = git('rev-parse', 'HEAD');
assert.equal(
  git('status', '--porcelain'),
  '',
  'Commit the reviewed source before attended evidence',
);
execFileSync(process.execPath, ['scripts/build-snapshot-store.mjs'], {
  cwd: root,
  stdio: 'inherit',
  timeout: 600_000,
});
const binarySha256 = createHash('sha256')
  .update(readFileSync(DEFAULT_WORKER))
  .digest('hex');

const evidenceRoot = path.join(
  process.env.LOCALAPPDATA,
  'LunaOSHome',
  'AttendedEvidence',
);
mkdirSync(evidenceRoot, { recursive: true });
const storeId = randomUUID();
const evidencePath = path.join(evidenceRoot, `snapshot-session-${storeId}.json`);
const evidence = {
  schema: 1,
  runner: 'test-attended-snapshot-session',
  fictional: true,
  attended: true,
  sourceHead,
  binarySha256,
  storeId,
  started: new Date().toISOString(),
  result: 'INCOMPLETE',
  stages: [],
  cleanup: 'NOT_DONE',
};
const save = () =>
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
save(); // Leave an incomplete receipt even if the console is closed.
const stage = (name, result = 'PASS', detail) => {
  evidence.stages.push({ name, result, ...(detail ? { detail } : {}) });
  save();
  console.log(`  ${result}  ${name}${detail ? ` (${detail})` : ''}`);
};

const terminal = createInterface({ input: process.stdin, output: process.stdout });
const say = (text) => console.log(`\n${text}`);
const confirm = async (question) =>
  (await terminal.question(`${question} [y/n] `)).trim().toLowerCase() === 'y';
const proceed = async (text) => {
  say(text);
  const answer = (await terminal.question('Type go to continue, s to skip: '))
    .trim()
    .toLowerCase();
  if (answer === 's') return false;
  assert.equal(answer, 'go', 'Stopped by the operator');
  return true;
};
const profile = (value) => ({
  memberId: 'alex-example',
  label: 'Workplace',
  value,
});
const refusedWith = (reason) => (error) =>
  error.code === 'STORAGE_FAILED' && error.reason === reason;
const inSessionFaults = [
  ['before-write', 'old'],
  ['during-write', 'old'],
  ['after-write', 'old'],
  ['before-replacement', 'old'],
  ['after-replacement', 'new'],
  ['disk-full', 'old'],
  ['tampered-temporary', 'old'],
];

let failed = null;
try {
  say(
    `Fictional vault journey ${storeId}\n` +
      'You will be asked for a DISPOSABLE vault password several times, always in a\n' +
      'Windows-owned dialog. Invent a new one for this test. Never use your Windows\n' +
      'password, and never type any password into this terminal.',
  );
  assert.ok(
    await proceed(
      'Step 1 of 7. Windows will ask you to CREATE the disposable vault password,\n' +
        'and may then ask you to ENTER it once to unlock.',
    ),
    'The first step cannot be skipped',
  );
  let session = await openWindowsSnapshotSessionForTest(
    { storeId, create: true, protector },
    {},
  );
  stage('create-password-then-unlock');
  const directory = session.directory;

  const created = await session.create('alex-work', profile('Willow Studio'));
  let revision = created.revision;
  for (let index = 0; index < 5; index += 1)
    ({ revision } = await session.edit(
      'alex-work',
      profile(`Edit ${index}`),
      revision,
    ));
  await assert.rejects(
    session.edit('alex-work', profile('Stale'), created.revision),
    VaultConflictError,
  );
  const removable = await session.create('sam-school', profile('Meadow'));
  await session.delete('sam-school', removable.revision);
  assert.equal(await session.read('sam-school'), null);
  assert.equal((await session.read('alex-work')).data.value, 'Edit 4');
  stage('nine-requests-in-one-session');
  stage(
    'single-gesture-per-session',
    (await confirm(
      'Since you created the password, has Windows asked you to enter it at most once?',
    ))
      ? 'PASS'
      : 'FAIL',
    'operator observation',
  );

  for (const [fault, expected] of inSessionFaults) {
    const recordId = `fault-${fault}`;
    const { revision: before } = await session.create(recordId, profile('old'));
    await assert.rejects(
      session.withTestFault(fault).edit(recordId, profile('new'), before),
      (error) => !(error instanceof VaultConflictError),
    );
    const row = await session.read(recordId);
    assert.equal(row.data.value, expected, fault);
    assert.equal(row.revision === before, expected === 'old', fault);
    stage(`fault-${fault}-reopens-${expected}`);
  }
  const atRest = (await readFile(path.join(directory, 'snapshot.bin'))).toString(
    'latin1',
  );
  assert.ok(atRest.includes('"protector":"software-ksp-rsa2048-oaep-sha256"'));
  assert.ok(!atRest.includes('Edit 4') && !atRest.includes(revision));
  stage('no-record-value-or-revision-at-rest');

  await assert.rejects(
    session
      .withTestFault('process-interruption')
      .edit('alex-work', profile('Lost'), revision),
    (error) => !(error instanceof VaultLockedError),
  );
  assert.equal(await session.ended, 'ended');
  await assert.rejects(session.read('alex-work'), VaultLockedError);
  stage('abrupt-worker-exit-ends-session');

  if (
    await proceed(
      'Step 2 of 7. The session process is gone, so the vault is locked.\n' +
        'Windows will ask for the disposable vault password once to unlock again.',
    )
  ) {
    session = await openWindowsSnapshotSession({ storeId, protector });
    assert.deepEqual(await session.read('alex-work'), {
      revision,
      data: profile('Edit 4'),
    });
    assert.equal((await session.read('fault-after-replacement')).data.value, 'new');
    assert.equal((await session.read('fault-before-write')).data.value, 'old');
    stage('reopen-after-interruption-keeps-last-committed-state');
    assert.equal(await session.lock(), 'locked');
    await assert.rejects(session.read('alex-work'), VaultLockedError);
    stage('manual-lock-ends-session');
  } else stage('reopen-after-interruption', 'SKIPPED');

  if (
    await proceed(
      'Step 3 of 7. WRONG password. When Windows asks, type an intentionally wrong\n' +
        'disposable password and choose Allow. Windows should refuse it; then close\n' +
        'that dialog with its top-right X.',
    )
  ) {
    await assert.rejects(
      openWindowsSnapshotSession({ storeId, protector }),
      refusedWith('key-release-denied'),
    );
    stage('wrong-password-denied');
  } else stage('wrong-password-denied', 'SKIPPED');

  if (
    await proceed(
      'Step 4 of 7. CANCEL. When Windows asks, do not type anything: close the\n' +
        'dialog with its top-right X.',
    )
  ) {
    await assert.rejects(
      openWindowsSnapshotSession({ storeId, protector }),
      refusedWith('key-release-denied'),
    );
    stage('cancelled-dialog-denied');
  } else stage('cancelled-dialog-denied', 'SKIPPED');

  if (
    await proceed(
      'Step 5 of 7. CLOSE TO LOCK. Enter the correct disposable password. Then find\n' +
        'the minimized window "Luna OS Home vault is unlocked" on the taskbar, restore\n' +
        'it and close it with its X. You have 60 seconds.',
    )
  ) {
    session = await openWindowsSnapshotSession({ storeId, protector });
    assert.equal((await session.read('alex-work')).revision, revision);
    const reason = await Promise.race([
      session.ended,
      new Promise((resolve) => setTimeout(() => resolve('not-closed'), 60_000)),
    ]);
    if (reason === 'not-closed') await session.lock();
    assert.equal(reason, 'window-closed');
    await assert.rejects(session.read('alex-work'), VaultLockedError);
    stage('closing-the-session-window-locks');
  } else stage('closing-the-session-window-locks', 'SKIPPED');

  if (
    await proceed(
      'Step 6 of 7. WINDOWS LOCK. Enter the correct disposable password. When this\n' +
        'terminal says "unlocked", press Windows+L, then sign back in to Windows.\n' +
        'You have 3 minutes.',
    )
  ) {
    session = await openWindowsSnapshotSession({ storeId, protector });
    assert.equal((await session.read('alex-work')).revision, revision);
    console.log('  unlocked - press Windows+L now, then sign back in');
    const reason = await Promise.race([
      session.ended,
      new Promise((resolve) => setTimeout(() => resolve('not-locked'), 180_000)),
    ]);
    if (reason === 'not-locked') await session.lock();
    assert.equal(reason, 'windows-lock');
    await assert.rejects(session.read('alex-work'), VaultLockedError);
    stage('windows-lock-ends-session');
  } else stage('windows-lock-ends-session', 'SKIPPED');

  evidence.result = evidence.stages.some((entry) => entry.result === 'FAIL')
    ? 'FAIL'
    : evidence.stages.some((entry) => entry.result === 'SKIPPED')
      ? 'PASS_WITH_SKIPS'
      : 'PASS';
} catch (error) {
  failed = error;
  evidence.result = 'FAIL';
  // Assertion text and static worker identifiers only.
  stage('journey', 'FAIL', String(error?.reason ?? error?.message ?? error).slice(0, 200));
}

try {
  say('Step 7 of 7. Cleanup: removing the disposable key and the fictional store.');
  await discardSyntheticKspStore({ storeId });
  await assert.rejects(
    openWindowsSnapshotSession({ storeId, protector }),
    refusedWith('protector-missing'),
  );
  evidence.cleanup = 'disposable-key-and-store-removed';
} catch {
  evidence.cleanup = 'CLEANUP_REQUIRED';
  console.log(
    `Cleanup did not finish. Run: node scripts/test-attended-snapshot-session.mjs --cleanup ${storeId}`,
  );
}
evidence.finished = new Date().toISOString();
save();
terminal.close();
console.log(`\nResult: ${evidence.result}; cleanup: ${evidence.cleanup}`);
console.log(`Evidence (no passwords, keys or records): ${evidencePath}`);
if (failed || evidence.cleanup === 'CLEANUP_REQUIRED') process.exit(1);
