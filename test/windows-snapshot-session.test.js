import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WORKER, VaultLockedError, discardSyntheticKspStore, openWindowsSnapshotSession, openWindowsSnapshotSessionForTest, openWindowsSnapshotStore, windowsSnapshotWorkerAvailable,
} from '../lib/windows-snapshot-store.js';
import { windowsProbeTestFaults } from '../lib/windows-probe-store.js';
import { VaultConflictError } from '../lib/vault-record-contract.js';
import { defineVersionedStoreConformance } from './support/versioned-store-conformance.js';

// Unlock-session mode of WindowsSnapshotFileStore v1, exercised unattended
// with the developer-harness fixture protector. The Software KSP protector
// needs a person at the Windows dialog; only its refusals that happen before
// any dialog are checked here. See scripts/test-attended-snapshot-session.mjs.

const skip =
  process.platform !== 'win32'
    ? 'WindowsSnapshotFileStore requires Windows'
    : !windowsSnapshotWorkerAvailable()
      ? 'build the developer-harness worker first: npm run build:snapshot-store'
      : false;
const windows = { skip, timeout: 120000 };
const fixture = () => ({
  kind: 'fixture',
  key: crypto.getRandomValues(new Uint8Array(32)),
});
const generic = { message: 'Windows snapshot storage operation failed.' };
const workplace = (value) => ({
  memberId: 'alex-example',
  label: 'Workplace',
  value,
});
const faultMatrix = [
  ['before-write', 'old'],
  ['during-write', 'old'],
  ['after-write', 'old'],
  ['before-replacement', 'old'],
  ['after-replacement', 'new'],
  ['disk-full', 'old'],
  ['process-interruption', 'old'],
  ['tampered-temporary', 'old'],
];

async function remove(storeId, protector) {
  const store = await openWindowsSnapshotStore({ storeId, protector });
  await store.removeSyntheticStore();
}

// Speak the worker protocol directly: one input, the parsed output lines.
function rawWorker(worker, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(worker, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let output = '';
    const timer = setTimeout(() => child.kill(), 20000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      const lines = output
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      resolve({ code, lines });
    });
    child.stdin.end(input);
  });
}

defineVersionedStoreConformance(test, {
  name: 'WindowsSnapshotFileStore v1 unlock session, developer-harness fixture protector',
  testOptions: windows,
  async open() {
    const protector = fixture();
    const store = await openWindowsSnapshotSession({ create: true, protector });
    const sessions = [store];
    return {
      store,
      directory: store.directory,
      async reopen() {
        const session = await openWindowsSnapshotSession({
          storeId: store.storeId,
          protector,
        });
        sessions.push(session);
        return session;
      },
      async dispose() {
        await Promise.all(sessions.map((session) => session.lock()));
        await remove(store.storeId, protector);
      },
    };
  },
  atRest: (handle) => readFile(path.join(handle.directory, 'snapshot.bin')),
});

test('session options are validated before any process starts', async () => {
  const protector = fixture();
  await assert.rejects(openWindowsSnapshotSession({}), TypeError);
  await assert.rejects(
    openWindowsSnapshotSession({ protector: { kind: 'dpapi' } }),
    TypeError,
  );
  await assert.rejects(
    openWindowsSnapshotSession({
      protector: { kind: 'software-ksp', password: 'never' },
    }),
    TypeError,
    'the adapter has no way to carry a password',
  );
  await assert.rejects(
    openWindowsSnapshotSession({ protector, testIdleMs: 100 }),
    /openWindowsSnapshotSessionForTest/,
  );
  await assert.rejects(
    openWindowsSnapshotSessionForTest({ protector }, { testIdleMs: 1 }),
    TypeError,
  );
  await assert.rejects(
    openWindowsSnapshotSessionForTest({ protector }, { testFault: 'nope' }),
    TypeError,
  );
  await assert.rejects(
    openWindowsSnapshotSessionForTest({ protector }, { other: true }),
    TypeError,
  );
  if (process.platform !== 'win32')
    await assert.rejects(
      openWindowsSnapshotSession({ protector }),
      /requires Windows/,
    );
});

test(
  'one session serves many requests, then lock ends it and a new session starts locked',
  windows,
  async (t) => {
    const protector = fixture();
    const session = await openWindowsSnapshotSession({
      create: true,
      protector,
    });
    t.after(() => remove(session.storeId, protector).catch(() => {}));
    assert.equal(session.contractVersion, 2);
    assert.equal(session.locked, false);
    const created = await session.create('alex-work', workplace('Willow'));
    let revision = created.revision;
    for (let index = 0; index < 5; index += 1)
      ({ revision } = await session.edit(
        'alex-work',
        workplace(`Edit ${index}`),
        revision,
      ));
    await assert.rejects(
      session.edit('alex-work', workplace('Stale'), created.revision),
      VaultConflictError,
      'a refused request leaves the session usable',
    );
    assert.equal((await session.read('alex-work')).data.value, 'Edit 4');

    const locking = session.lock();
    await assert.rejects(
      session.read('alex-work'),
      VaultLockedError,
      'nothing is sent once a lock has been requested, even before the worker exits',
    );
    assert.equal(await locking, 'locked');
    assert.equal(session.locked, true);
    await assert.rejects(session.read('alex-work'), VaultLockedError);
    await assert.rejects(
      session.create('sam-school', workplace('No')),
      VaultLockedError,
    );
    assert.equal(await session.lock(), 'locked', 'lock is idempotent');

    await assert.rejects(
      openWindowsSnapshotSession({
        storeId: session.storeId,
        protector: fixture(),
      }),
      generic,
      'another key cannot start a session',
    );
    const again = await openWindowsSnapshotSession({
      storeId: session.storeId,
      protector,
    });
    assert.equal((await again.read('alex-work')).revision, revision);
    assert.equal(await again.read('sam-school'), null);
    await again.lock();
  },
);

test(
  'an idle session ends by itself and nothing is served afterwards',
  windows,
  async (t) => {
    const protector = fixture();
    const session = await openWindowsSnapshotSessionForTest(
      { create: true, protector },
      { testIdleMs: 400 },
    );
    t.after(() => remove(session.storeId, protector).catch(() => {}));
    const { revision } = await session.create('alex-work', workplace('Kept'));
    // Activity restarts the idle timer.
    for (let index = 0; index < 4; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal((await session.read('alex-work')).revision, revision);
    }
    assert.equal(await session.ended, 'idle');
    await assert.rejects(session.read('alex-work'), VaultLockedError);
    const again = await openWindowsSnapshotSession({
      storeId: session.storeId,
      protector,
    });
    assert.equal((await again.read('alex-work')).revision, revision);
    await again.lock();
  },
);

test(
  'activity cannot extend a session past its lifetime',
  windows,
  async (t) => {
    const protector = fixture();
    const session = await openWindowsSnapshotSessionForTest(
      { create: true, protector },
      { testIdleMs: 60000, testLifetimeMs: 700 },
    );
    t.after(() => remove(session.storeId, protector).catch(() => {}));
    let served = 0;
    const started = Date.now();
    while (!session.locked && Date.now() - started < 20000) {
      await session.read('alex-work').then(
        () => (served += 1),
        () => {},
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(await session.ended, 'expired');
    assert.ok(served > 0, 'the session worked until it expired');
    await assert.rejects(session.read('alex-work'), VaultLockedError);
  },
);

test(
  'a caller that goes away without locking still locks the session',
  windows,
  async (t) => {
    const protector = fixture();
    const session = await openWindowsSnapshotSessionForTest(
      { create: true, protector },
      {},
    );
    t.after(() => remove(session.storeId, protector).catch(() => {}));
    const { revision } = await session.create('alex-work', workplace('Kept'));
    // Only the pipe closes: no lock request is sent.
    assert.equal(await session.abandon(), 'locked');
    await assert.rejects(session.read('alex-work'), VaultLockedError);
    const again = await openWindowsSnapshotSession({
      storeId: session.storeId,
      protector,
    });
    assert.equal((await again.read('alex-work')).revision, revision);
    // A request cut off mid-line is never acted on.
    const truncated = await rawWorker(
      DEFAULT_WORKER,
      ['--session'],
      JSON.stringify({
        operation: 'session-open',
        storeId: session.storeId,
        protector: {
          kind: 'fixture',
          key: Buffer.from(protector.key).toString('hex'),
        },
      }) +
        '\n' +
        JSON.stringify({ id: 1, operation: 'delete', recordId: 'alex-work' }),
    );
    assert.equal(truncated.lines.filter((line) => line.id === 1).length, 0);
    assert.equal((await again.read('alex-work')).revision, revision);
    await again.lock();
  },
);

test(
  'a worker killed mid-session leaves the committed snapshot',
  windows,
  async (t) => {
    const protector = fixture();
    const session = await openWindowsSnapshotSession({
      create: true,
      protector,
    });
    t.after(() => remove(session.storeId, protector).catch(() => {}));
    const { revision } = await session.create('alex-work', workplace('Kept'));
    await session.lock();
    const interrupted = await openWindowsSnapshotSessionForTest(
      { storeId: session.storeId, protector },
      { testFault: 'process-interruption' },
    );
    await assert.rejects(
      interrupted.edit('alex-work', workplace('Lost'), revision),
      generic,
      'an unanswered mutation is an unknown outcome, not a lock refusal',
    );
    assert.equal(await interrupted.ended, 'ended');
    await assert.rejects(interrupted.read('alex-work'), VaultLockedError);
    const again = await openWindowsSnapshotSession({
      storeId: session.storeId,
      protector,
    });
    assert.deepEqual(await again.read('alex-work'), {
      revision,
      data: workplace('Kept'),
    });
    await again.lock();
  },
);

test(
  'session fault matrix reopens only the complete old or new record',
  windows,
  async (t) => {
    assert.deepEqual(
      faultMatrix.map(([fault]) => fault).sort(),
      [...windowsProbeTestFaults().faults].sort(),
      'the matrix covers every defined fault',
    );
    for (const [fault, expected] of faultMatrix) {
      const protector = fixture();
      const first = await openWindowsSnapshotSession({
        create: true,
        protector,
      });
      t.after(() => remove(first.storeId, protector).catch(() => {}));
      const { revision } = await first.create('alex-work', workplace('old'));
      await first.lock();
      const faulty = await openWindowsSnapshotSessionForTest(
        { storeId: first.storeId, protector },
        { testFault: fault },
      );
      await assert.rejects(
        faulty.edit('alex-work', workplace('new'), revision),
        (error) => !(error instanceof VaultConflictError),
        fault,
      );
      await faulty.lock();
      const reopened = await openWindowsSnapshotSession({
        storeId: first.storeId,
        protector,
      });
      const row = await reopened.read('alex-work');
      assert.equal(row.data.value, expected, fault);
      assert.equal(row.revision === revision, expected === 'old', fault);
      const pending = (await readdir(reopened.directory)).filter((name) =>
        name.endsWith('.pending'),
      );
      assert.equal(
        pending.length,
        fault === 'process-interruption' ? 1 : 0,
        `${fault}: only an abrupt exit leaves a pending file`,
      );
      await reopened.lock();
      // Authenticated cleanup also removes this store's own pending file.
      await remove(first.storeId, protector);
      assert.equal(existsSync(reopened.directory), false, fault);
    }
  },
);

test(
  'injected faults inside one session leave the session usable and the record old or new',
  windows,
  async (t) => {
    const protector = fixture();
    const session = await openWindowsSnapshotSessionForTest(
      { create: true, protector },
      {},
    );
    t.after(async () => {
      await session.lock();
      await remove(session.storeId, protector).catch(() => {});
    });
    const plain = await openWindowsSnapshotSession({
      storeId: session.storeId,
      protector,
    });
    assert.equal(plain.withTestFault, undefined, 'only the test entry point');
    await plain.lock();
    assert.throws(() => session.withTestFault('nope'), TypeError);
    for (const [fault, expected] of faultMatrix) {
      if (fault === 'process-interruption') continue; // Ends the session.
      const recordId = `fault-${fault}`;
      const { revision } = await session.create(recordId, workplace('old'));
      await assert.rejects(
        session.withTestFault(fault).edit(recordId, workplace('new'), revision),
        (error) =>
          !(error instanceof VaultConflictError) &&
          !(error instanceof VaultLockedError),
        fault,
      );
      const row = await session.read(recordId);
      assert.equal(row.data.value, expected, fault);
      assert.equal(row.revision === revision, expected === 'old', fault);
    }
    assert.equal(session.locked, false);
  },
);

test(
  'an existing store is never set up again, and an interrupted setup can always be repeated',
  windows,
  async (t) => {
    const protector = fixture();
    const first = await openWindowsSnapshotSession({ create: true, protector });
    const { storeId } = first;
    t.after(() => remove(storeId, fixture()).catch(() => {}));
    const { revision } = await first.create('alex-work', workplace('Kept'));
    await first.lock();
    const marker = `${first.directory}.setup`;
    assert.equal(existsSync(marker), false, 'a completed setup leaves no marker');

    // A store that has been unlocked is refused, untouched, by a second setup.
    await assert.rejects(
      openWindowsSnapshotSession({ storeId, create: true, protector: fixture() }),
      (error) => error.code === 'STORAGE_FAILED' && error.reason === 'exists',
    );
    let again = await openWindowsSnapshotSession({ storeId, protector });
    assert.equal((await again.read('alex-work')).revision, revision);
    await again.lock();

    // Opening a store whose setup marker survived finishes that setup.
    await writeFile(marker, '');
    again = await openWindowsSnapshotSession({ storeId, protector });
    assert.equal(existsSync(marker), false, 'the first unlock clears the marker');
    assert.equal((await again.read('alex-work')).revision, revision);
    await again.lock();

    // A marker means the store was never unlocked: the next setup replaces it.
    await writeFile(marker, '');
    const replacement = fixture();
    const fresh = await openWindowsSnapshotSession({
      storeId,
      create: true,
      protector: replacement,
    });
    assert.equal(existsSync(marker), false);
    assert.equal(await fresh.read('alex-work'), null, 'a fresh, empty store');
    await fresh.lock();
    await assert.rejects(
      openWindowsSnapshotSession({ storeId, protector }),
      generic,
      'the abandoned setup and its key are gone',
    );

    // Two setups racing for one identifier: exactly one wins.
    const contested = crypto.randomUUID();
    const outcomes = await Promise.allSettled(
      [fixture(), fixture(), fixture()].map((key) =>
        openWindowsSnapshotSession({
          storeId: contested,
          create: true,
          protector: key,
        }),
      ),
    );
    const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    assert.equal(winners.length, 1);
    for (const outcome of outcomes)
      if (outcome.status === 'rejected')
        assert.ok(
          outcome.reason.code === 'BUSY' || outcome.reason.reason === 'exists',
          'a losing setup is refused as busy or already existing',
        );
    await winners[0].value.destroySyntheticStore();
    assert.equal(existsSync(`${winners[0].value.directory}.setup`), false);
    assert.equal(existsSync(winners[0].value.directory), false);
    await remove(storeId, replacement);
  },
);

test(
  'the Software KSP protector is refused before any window or dialog when its key is missing',
  windows,
  async () => {
    const storeId = crypto.randomUUID();
    const started = Date.now();
    await assert.rejects(
      openWindowsSnapshotSession({
        storeId,
        protector: { kind: 'software-ksp' },
      }),
      (error) =>
        error.message === generic.message &&
        error.code === 'STORAGE_FAILED' &&
        error.reason === 'missing-store',
    );
    // With a store present but no key, the refusal names the protector.
    const protector = fixture();
    const fixtureStore = await openWindowsSnapshotSession({
      create: true,
      protector,
    });
    await fixtureStore.lock();
    await assert.rejects(
      openWindowsSnapshotSession({
        storeId: fixtureStore.storeId,
        protector: { kind: 'software-ksp' },
      }),
      (error) => error.reason === 'protector-missing',
    );
    await remove(fixtureStore.storeId, protector);
    // The worker itself refuses the protector outside a session.
    const oneRequest = await rawWorker(
      DEFAULT_WORKER,
      [],
      JSON.stringify({
        operation: 'open',
        storeId,
        protector: { kind: 'software-ksp' },
      }),
    );
    assert.equal(oneRequest.code, 1);
    assert.deepEqual(oneRequest.lines, [
      { ok: false, error: 'INVALID', reason: 'protector-requires-session' },
    ]);
    assert.ok(Date.now() - started < 10000, 'refused without waiting');
    await assert.rejects(
      openWindowsSnapshotStore({ storeId, protector: { kind: 'software-ksp' } }),
      TypeError,
      'one request per process can never carry the Software KSP protector',
    );
    // Discarding a store that never existed, with no key, is idempotent.
    await discardSyntheticKspStore({ storeId });
  },
);

test(
  'a default-feature worker refuses the fixture protector and test controls in session mode',
  { ...windows, timeout: 600000 },
  async (t) => {
    const crate = fileURLToPath(
      new URL('../src-tauri/crates/windows-snapshot-store/', import.meta.url),
    );
    const worker = path.join(
      crate,
      'target',
      'debug',
      'windows-snapshot-store-worker.exe',
    );
    // Always rebuild: a stale default-feature worker would test old code.
    try {
      await promisify(execFile)(
        'cargo',
        ['build', '--locked', '--manifest-path', path.join(crate, 'Cargo.toml')],
        { windowsHide: true, timeout: 540000 },
      );
    } catch {
      return t.skip('cargo is required to build the default-feature worker');
    }
    await assert.rejects(
      openWindowsSnapshotSession({
        worker,
        create: true,
        protector: fixture(),
      }),
      (error) =>
        error.code === 'INVALID' && error.reason === 'protector-unavailable',
    );
    const storeId = crypto.randomUUID();
    await assert.rejects(
      openWindowsSnapshotSessionForTest(
        { worker, storeId, protector: { kind: 'software-ksp' } },
        { testIdleMs: 100 },
      ),
      (error) => error.code === 'INVALID' && error.reason === 'request',
      'a default build has no limit override',
    );
    await assert.rejects(
      discardSyntheticKspStore({ worker, storeId }),
      generic,
      'a default build has no unauthenticated discard',
    );
    await assert.rejects(
      openWindowsSnapshotSession({
        worker,
        storeId,
        protector: { kind: 'software-ksp' },
      }),
      (error) => error.reason === 'missing-store',
      'the Software KSP protector itself is compiled into the default build',
    );
  },
);
