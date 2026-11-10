// Attended Software KSP unlock-session journey for WindowsSnapshotFileStore v1.
// Fictional records and a disposable key only. This runner never asks for,
// reads or logs a password: every password is typed into the Windows-owned
// dialog. Evidence holds stage names, results, the operator's yes/no answers
// and unlock durations in milliseconds, nothing else.
//
// A failed step is recorded and the journey continues with the next step, so
// one run reports everything it can.
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
// A person cannot read a dialog, type a password and confirm it faster than
// this. An unlock that finishes sooner released the key without a gesture.
const FASTEST_HUMAN_GESTURE_MS = 700;
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
  schema: 2,
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
  evidence.stages.push({
    name,
    result,
    ...(detail ? { detail } : {}),
    at: new Date().toISOString(),
  });
  save();
  console.log(`  ${result}  ${name}${detail ? ` (${detail})` : ''}`);
};

const terminal = createInterface({ input: process.stdin, output: process.stdout });
const say = (text) => console.log(`\n${text}`);
const choose = async (question, choices) => {
  for (;;) {
    const answer = (await terminal.question(`${question} [${choices.join('/')}] `))
      .trim()
      .toLowerCase();
    if (choices.includes(answer)) return answer;
  }
};
const proceed = async (text) => {
  say(text);
  return (await choose('Type go to continue, s to skip:', ['go', 's'])) === 'go';
};
const profile = (value) => ({
  memberId: 'alex-example',
  label: 'Workplace',
  value,
});
const refusedWith = (...reasons) => (error) =>
  error.code === 'STORAGE_FAILED' && reasons.includes(error.reason);
// Fixed identifiers only: never free text from an error.
const identifier = (value) =>
  typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value) ? value : null;
const describe = (error) => {
  if (identifier(error?.reason)) return error.reason;
  if (error?.code === 'ERR_ASSERTION') {
    const actual = identifier(error.actual);
    const expected = identifier(error.expected);
    return actual && expected ? `expected ${expected}, got ${actual}` : 'assertion';
  }
  return identifier(error?.code?.toLowerCase?.()) ?? 'error';
};
const inSessionFaults = [
  ['before-write', 'old'],
  ['during-write', 'old'],
  ['after-write', 'old'],
  ['before-replacement', 'old'],
  ['after-replacement', 'new'],
  ['disk-full', 'old'],
  ['tampered-temporary', 'old'],
];

let session = null;
let revision = null;
const lockQuietly = async () => {
  try {
    await session?.lock();
  } catch {
    // Already ended.
  }
};
// Unlock an existing store and record whether Windows really asked: the
// operator's answer and the measured duration must agree.
const unlock = async (name) => {
  const began = Date.now();
  session = await openWindowsSnapshotSession({ storeId, protector });
  const unlockMs = Date.now() - began;
  assert.equal((await session.read('alex-work')).revision, revision);
  const asked = await choose(
    'Did Windows show a password dialog for this unlock, and did you type the password?',
    ['y', 'n'],
  );
  stage(
    `${name}-required-the-password`,
    asked === 'y' && unlockMs >= FASTEST_HUMAN_GESTURE_MS ? 'PASS' : 'FAIL',
    `operator=${asked} unlockMs=${unlockMs}`,
  );
};
// One numbered step: skipped, or run to its end; a failure is recorded, the
// session is locked and the journey goes on.
const step = async (name, text, body) => {
  if (!(await proceed(text))) return stage(name, 'SKIPPED');
  try {
    await body();
  } catch (error) {
    stage(name, 'FAIL', describe(error));
    await lockQuietly();
  }
};

say(
  `Fictional vault journey ${storeId}\n` +
    'You will be asked for a DISPOSABLE vault password several times, always in a\n' +
    'Windows-owned dialog. Invent a new one for this test. Never use your Windows\n' +
    'password, and never type any password into this terminal.',
);
let created = false;
try {
  assert.ok(
    await proceed(
      'Step 1 of 7. Windows will ask you to CREATE the disposable vault password.\n' +
        'It may or may not then ask you to ENTER it. Count the Windows dialogs.',
    ),
    'The first step cannot be skipped',
  );
  const began = Date.now();
  session = await openWindowsSnapshotSessionForTest(
    { storeId, create: true, protector },
    {},
  );
  const createMs = Date.now() - began;
  created = true;
  stage('create-password-then-unlock', 'PASS', `unlockMs=${createMs}`);
  const directory = session.directory;

  const first = await session.create('alex-work', profile('Willow Studio'));
  revision = first.revision;
  for (let index = 0; index < 5; index += 1)
    ({ revision } = await session.edit(
      'alex-work',
      profile(`Edit ${index}`),
      revision,
    ));
  await assert.rejects(
    session.edit('alex-work', profile('Stale'), first.revision),
    VaultConflictError,
  );
  const removable = await session.create('sam-school', profile('Meadow'));
  await session.delete('sam-school', removable.revision);
  assert.equal(await session.read('sam-school'), null);
  assert.equal((await session.read('alex-work')).data.value, 'Edit 4');
  stage('nine-requests-in-one-session');
  const dialogs = await choose(
    'How many Windows password dialogs have appeared so far?\n' +
      '  1 = only the one where you created the password\n' +
      '  2 = that one, then one asking you to enter it\n' +
      '  3 = more than two\n' +
      'Answer',
    ['1', '2', '3'],
  );
  stage(
    'single-gesture-per-session',
    dialogs === '3' ? 'FAIL' : 'PASS',
    `operator-dialog-count=${dialogs === '3' ? 'more-than-2' : dialogs}`,
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
} catch (error) {
  stage('first-session', 'FAIL', describe(error));
  await lockQuietly();
}

// Later steps need the store and the revision the first session left.
if (created && revision) {
  await step(
    'reopen-after-interruption',
    'Step 2 of 7. The session process is gone, so the vault is locked.\n' +
      'Windows should ask for the disposable vault password to unlock again.\n' +
      'If no dialog appears, that is a finding: just answer the question after.',
    async () => {
      await unlock('reopen-after-interruption');
      assert.equal((await session.read('alex-work')).data.value, 'Edit 4');
      assert.equal((await session.read('fault-after-replacement')).data.value, 'new');
      assert.equal((await session.read('fault-before-write')).data.value, 'old');
      stage('reopen-after-interruption-keeps-last-committed-state');
      assert.equal(await session.lock(), 'locked');
      await assert.rejects(session.read('alex-work'), VaultLockedError);
      stage('manual-lock-ends-session');
    },
  );

  await step(
    'wrong-password-denied',
    'Step 3 of 7. WRONG password. When Windows asks, type an intentionally wrong\n' +
      'disposable password and choose Allow. Windows should refuse it; then close\n' +
      'that dialog with its top-right X.',
    async () => {
      await assert.rejects(
        openWindowsSnapshotSession({ storeId, protector }),
        refusedWith('key-release-denied'),
      );
      stage('wrong-password-denied');
    },
  );

  await step(
    'cancelled-dialog-denied',
    'Step 4 of 7. CANCEL. When Windows asks, do not type anything: close the\n' +
      'dialog with its top-right X.',
    async () => {
      await assert.rejects(
        openWindowsSnapshotSession({ storeId, protector }),
        refusedWith('key-release-denied'),
      );
      stage('cancelled-dialog-denied');
    },
  );

  await step(
    'closing-the-session-window-locks',
    'Step 5 of 7. CLOSE TO LOCK. Enter the correct disposable password and answer\n' +
      'the question here. You will then be told to close the session window.',
    async () => {
      await unlock('close-to-lock');
      console.log(
        '  Now find the minimized window "Luna OS Home vault is unlocked" on the\n' +
          '  taskbar, restore it and close it with its X. You have 90 seconds.',
      );
      const reason = await Promise.race([
        session.ended,
        new Promise((resolve) => setTimeout(() => resolve('not-closed'), 90_000)),
      ]);
      assert.equal(reason, 'window-closed');
      await assert.rejects(session.read('alex-work'), VaultLockedError);
      stage('closing-the-session-window-locks');
    },
  );

  await step(
    'windows-lock-ends-session',
    'Step 6 of 7. WINDOWS LOCK. Enter the correct disposable password and answer\n' +
      'the question here. You will then be told to press Windows+L.',
    async () => {
      await unlock('windows-lock');
      console.log(
        '  Now press Windows+L, then sign back in to Windows. You have 3 minutes.',
      );
      const reason = await Promise.race([
        session.ended,
        new Promise((resolve) => setTimeout(() => resolve('not-locked'), 180_000)),
      ]);
      assert.equal(reason, 'windows-lock');
      await assert.rejects(session.read('alex-work'), VaultLockedError);
      stage('windows-lock-ends-session');
    },
  );
}

evidence.result = evidence.stages.some((entry) => entry.result === 'FAIL')
  ? 'FAIL'
  : evidence.stages.some((entry) => entry.result === 'SKIPPED')
    ? 'PASS_WITH_SKIPS'
    : 'PASS';
save(); // The verdict is on disk before anything else is printed.

try {
  say('Step 7 of 7. Cleanup: removing the disposable key and the fictional store.');
  await lockQuietly();
  await discardSyntheticKspStore({ storeId });
  // With both gone, the store is reported missing before the key is looked at.
  await assert.rejects(
    openWindowsSnapshotSession({ storeId, protector }),
    refusedWith('missing-store', 'protector-missing'),
  );
  evidence.cleanup = 'disposable-key-and-store-removed';
  save();
} catch {
  evidence.cleanup = 'CLEANUP_REQUIRED';
  save();
  console.log(
    `Cleanup did not finish. Run: node scripts/test-attended-snapshot-session.mjs --cleanup ${storeId}`,
  );
}
evidence.finished = new Date().toISOString();
save();
terminal.close();
console.log(`\nResult: ${evidence.result}; cleanup: ${evidence.cleanup}`);
console.log(`Evidence (no passwords, keys or records): ${evidencePath}`);
if (evidence.result === 'FAIL' || evidence.cleanup === 'CLEANUP_REQUIRED')
  process.exit(1);
