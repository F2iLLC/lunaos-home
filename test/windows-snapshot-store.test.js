import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  DEFAULT_WORKER, openWindowsSnapshotStore, openWindowsSnapshotStoreForFaultTest, windowsSnapshotWorkerAvailable,
} from '../lib/windows-snapshot-store.js';
import { windowsProbeTestFaults } from '../lib/windows-probe-store.js';
import { createGroceryPersistence } from '../lib/grocery-persistence.js';
import { createVaultSessionService } from '../lib/vault-sessions.js';
import { VaultConflictError } from '../lib/vault-record-contract.js';
import { defineVersionedStoreConformance } from './support/versioned-store-conformance.js';

const crateRoot = new URL(
  '../src-tauri/crates/windows-snapshot-store/',
  import.meta.url,
);
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
const list = {
  id: 'weekly',
  householdId: 'home-example',
  label: 'Weekly',
  items: [],
  revision: '3d735c0e-3176-4502-8717-8e62f59d3a91',
  updatedBy: { kind: 'human', id: 'person-example' },
};
const windowsFaultMatrix = [
  ['before-write', 'old'],
  ['during-write', 'old'],
  ['after-write', 'old'],
  ['before-replacement', 'old'],
  ['after-replacement', 'new'],
  ['disk-full', 'old'],
  ['process-interruption', 'old'],
  ['tampered-temporary', 'old'],
];

async function openFixtureStore() {
  const protector = fixture();
  const store = await openWindowsSnapshotStore({ create: true, protector });
  return { store, protector };
}

defineVersionedStoreConformance(test, {
  name: 'WindowsSnapshotFileStore v1, developer-harness fixture protector',
  testOptions: windows,
  async open() {
    const { store, protector } = await openFixtureStore();
    return {
      store,
      directory: store.directory,
      reopen: () =>
        openWindowsSnapshotStore({ storeId: store.storeId, protector }),
      dispose: () => store.removeSyntheticStore(),
    };
  },
  atRest: (handle) => readFile(path.join(handle.directory, 'snapshot.bin')),
});

test('the snapshot adapter refuses fault injection and implicit protectors before any platform access', async () => {
  const protector = fixture();
  await assert.rejects(
    openWindowsSnapshotStore({ protector, testFault: 'before-write' }),
    /openWindowsSnapshotStoreForFaultTest/,
  );
  await assert.rejects(
    openWindowsSnapshotStoreForFaultTest({ protector }, 'unknown-fault'),
    TypeError,
  );
  await assert.rejects(
    openWindowsSnapshotStoreForFaultTest({ protector }, null),
    TypeError,
  );
  if (process.platform === 'win32') {
    await assert.rejects(
      openWindowsSnapshotStore({}),
      TypeError,
      'a protector must be explicit',
    );
    await assert.rejects(
      openWindowsSnapshotStore({ protector: { kind: 'software-ksp' } }),
      TypeError,
    );
    await assert.rejects(
      openWindowsSnapshotStore({
        protector: { kind: 'fixture', key: new Uint8Array(16) },
      }),
      TypeError,
    );
    await assert.rejects(
      openWindowsSnapshotStore({ protector, storeId: 'not-a-store' }),
      /uuid|regex|Invalid/i,
    );
  } else {
    await assert.rejects(
      openWindowsSnapshotStore({ protector }),
      /requires Windows/,
    );
  }
});

test('the native fault stages match the shared fault definitions', async () => {
  const { faults } = windowsProbeTestFaults();
  const source = await readFile(new URL('src/fault.rs', crateRoot), 'utf8');
  const native = [...source.matchAll(/\("([a-z-]+)", Fault::[A-Za-z]+\)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(native.sort(), [...faults].sort());
  assert.deepEqual(
    windowsFaultMatrix.map(([fault]) => fault).sort(),
    [...faults].sort(),
    'the matrix covers every defined fault',
  );
});

test('the crate lockfile adds no package version absent from the application lockfile', async () => {
  const packages = async (url) =>
    new Set(
      [
        ...(await readFile(url, 'utf8')).matchAll(
          /\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g,
        ),
      ].map((match) => `${match[1]}@${match[2]}`),
    );
  const application = await packages(
    new URL('../src-tauri/Cargo.lock', import.meta.url),
  );
  const crate = await packages(new URL('Cargo.lock', crateRoot));
  const added = [...crate].filter(
    (entry) =>
      !entry.startsWith('lunaos-home-windows-snapshot-store@') &&
      !application.has(entry),
  );
  assert.deepEqual(
    added,
    [],
    'new third-party crate versions need a license inventory update',
  );
  assert.ok(crate.size > 1, 'the crate lockfile resolves its dependencies');
});

test('the default worker path points inside the developer-harness target directory', () => {
  assert.match(
    DEFAULT_WORKER.replaceAll('\\', '/'),
    /src-tauri\/crates\/windows-snapshot-store\/target\/developer-harness\/debug\/windows-snapshot-store-worker\.exe$/,
  );
  assert.equal(windowsSnapshotWorkerAvailable('C:/does/not/exist.exe'), false);
});

test(
  'a different fixture key cannot open the store; tampering and stale pending files never change committed bytes',
  windows,
  async (t) => {
    const { store, protector } = await openFixtureStore();
    t.after(() => store.removeSyntheticStore().catch(() => {}));
    const { revision } = await store.create('alex-work', {
      memberId: 'alex-example',
      label: 'Workplace',
      value: 'Willow Studio',
    });
    await assert.rejects(
      openWindowsSnapshotStore({
        storeId: store.storeId,
        protector: fixture(),
      }),
      { message: 'Windows snapshot storage operation failed.' },
    );
    await assert.rejects(
      openWindowsSnapshotStore({ storeId: crypto.randomUUID(), protector }),
      { message: 'Windows snapshot storage operation failed.' },
    );

    const file = path.join(store.directory, 'snapshot.bin');
    const committed = await readFile(file);
    const tampered = Buffer.from(committed);
    tampered[tampered.length - 1] ^= 1;
    await writeFile(file, tampered);
    await assert.rejects(store.read('alex-work'), {
      message: 'Windows snapshot storage operation failed.',
    });
    await assert.rejects(
      store.edit(
        'alex-work',
        { memberId: 'alex-example', label: 'Workplace', value: 'Other' },
        revision,
      ),
      (error) => !(error instanceof VaultConflictError),
    );
    assert.deepEqual(
      await readFile(file),
      tampered,
      'a refused read or edit never rewrites the file',
    );
    await writeFile(file, committed);
    assert.equal((await store.read('alex-work')).revision, revision);

    const stale = path.join(
      store.directory,
      'snapshot-0123456789abcdef0123456789abcdef.pending',
    );
    await writeFile(stale, committed.subarray(0, 64));
    assert.equal(
      (await store.read('alex-work')).revision,
      revision,
      'pending files are never promoted',
    );
    const edited = await store.edit(
      'alex-work',
      { memberId: 'alex-example', label: 'Workplace', value: 'Edited' },
      revision,
    );
    assert.notEqual(edited.revision, revision);
    assert.ok(
      existsSync(stale),
      'an unrelated pending file is left for cleanup',
    );
    await store.removeSyntheticStore();
    assert.equal(
      existsSync(store.directory),
      false,
      'cleanup removes the store directory and its own pending files',
    );
  },
);

test(
  'the store directory grants access only to the current user and LocalSystem',
  windows,
  async (t) => {
    const { store } = await openFixtureStore();
    t.after(() => store.removeSyntheticStore().catch(() => {}));
    const { stdout } = await promisify(execFile)('icacls', [store.directory], {
      windowsHide: true,
    });
    const entries = stdout
      .split(/\r?\n/)
      .map((line) => line.replace(store.directory, '').trim())
      .filter((line) => line.includes(':('));
    assert.ok(
      entries.length >= 2,
      `expected explicit entries, saw: ${entries.join(' | ')}`,
    );
    for (const entry of entries) {
      assert.doesNotMatch(
        entry,
        /\(I\)/,
        `inherited entry must not exist: ${entry}`,
      );
      assert.doesNotMatch(
        entry,
        /BUILTIN\\Users|Everyone|Authenticated Users|BUILTIN\\Administrators/,
        `broad principal must not exist: ${entry}`,
      );
    }
    assert.ok(
      entries.some((entry) => entry.startsWith('NT AUTHORITY\\SYSTEM:')),
      'LocalSystem entry present',
    );
    const files = await readdir(store.directory);
    assert.deepEqual(files.sort(), ['.lock', 'snapshot.bin']);
  },
);

test(
  'the shared session service and grocery persistence run over the native adapter',
  windows,
  async (t) => {
    const { store, protector } = await openFixtureStore();
    const service = createVaultSessionService({ store, contractVersion: 2 });
    t.after(async () => {
      await service.shutdown();
      await store.removeSyntheticStore();
    });

    const persistence = createGroceryPersistence({ store });
    await persistence.createList(list);
    const command = {
      version: 1,
      action: 'add',
      requestId: crypto.randomUUID(),
      householdId: list.householdId,
      listId: list.id,
      expectedRevision: list.revision,
      item: { id: 'apples', label: 'Apples', completed: false },
    };
    const receipt = await persistence.execute(command, {
      actor: list.updatedBy,
    });
    const bytes = await readFile(path.join(store.directory, 'snapshot.bin'));
    assert.equal(bytes.includes(Buffer.from('Apples')), false);
    assert.equal(bytes.includes(Buffer.from(receipt.revision)), false);

    const reopenedStore = await openWindowsSnapshotStore({
      storeId: store.storeId,
      protector,
    });
    const reopened = createGroceryPersistence({ store: reopenedStore });
    assert.deepEqual(
      await reopened.execute(command, { actor: list.updatedBy }),
      receipt,
      'a retried request returns the stored receipt',
    );

    service.admitDevice('windows-example');
    const connection = service.openConnection({ deviceId: 'windows-example' });
    const grant = service.approveSetup(connection, {
      recordIds: [list.id],
      lifetimeMs: 60000,
    });
    await assert.rejects(
      connection.execute(grant, {
        version: 2,
        action: 'read',
        recordId: list.id,
      }),
      { code: 'READ_FAILED' },
    );
    const stored = await reopenedStore.read(list.id);
    await assert.rejects(
      connection.execute(grant, {
        version: 2,
        action: 'edit',
        recordId: list.id,
        expectedRevision: stored.revision,
        data: {
          memberId: 'member-example',
          label: 'Profile',
          value: 'Profile value',
        },
      }),
      { code: 'UNSUPPORTED' },
    );
  },
);

test(
  'WindowsSnapshotFileStore fault matrix reopens only complete old or new grocery/list receipt pairs',
  windows,
  async (t) => {
    const { store, protector } = await openFixtureStore();
    t.after(() => store.removeSyntheticStore());
    const initialList = {
      ...list,
      items: [{ id: 'apples', label: 'Apples', completed: false }],
    };
    await createGroceryPersistence({ store }).createList(initialList);
    let expectedRevision = initialList.revision;
    let expectedLabel = 'Apples';
    let leftover = 0;
    for (const [testFault, outcome] of windowsFaultMatrix) {
      const label = `Fixture ${testFault}`;
      const faultStore = await openWindowsSnapshotStoreForFaultTest(
        { storeId: store.storeId, protector },
        testFault,
      );
      const persistence = createGroceryPersistence({ store: faultStore });
      const command = {
        version: 1,
        action: 'edit',
        requestId: crypto.randomUUID(),
        householdId: list.householdId,
        listId: list.id,
        expectedRevision,
        itemId: 'apples',
        patch: { label },
      };
      let result;
      let failure;
      try {
        result = await persistence.execute(command, { actor: list.updatedBy });
      } catch (error) {
        failure = error;
      }

      const reopened = await openWindowsSnapshotStore({
        storeId: store.storeId,
        protector,
      });
      const row = await reopened.read(list.id);
      const grocery = row.data;
      const outcomeRecord = grocery.outcomes.find(
        (entry) => entry.requestId === command.requestId,
      );
      assert.equal(
        outcomeRecord !== undefined,
        outcome === 'new',
        `${testFault}: durable receipt presence`,
      );
      assert.equal(
        grocery.list.items[0].label,
        outcome === 'new' ? label : expectedLabel,
        `${testFault}: list state`,
      );
      if (outcome === 'new') {
        assert.equal(result?.status, 'applied');
        assert.equal(result.revision, grocery.list.revision);
        assert.deepEqual(outcomeRecord.receipt, result);
        expectedRevision = grocery.list.revision;
        expectedLabel = label;
      } else {
        assert.ok(failure, `${testFault}: failed write must not claim success`);
        assert.equal(
          outcomeRecord,
          undefined,
          `${testFault}: no success receipt may accompany the old list`,
        );
        expectedRevision = grocery.list.revision;
      }
      const remaining = (await readdir(store.directory)).filter((name) =>
        name.endsWith('.pending'),
      );
      if (testFault === 'process-interruption') {
        // Abrupt termination leaves exactly one ciphertext-only pending file.
        // Later operations never promote or remove another process's file.
        leftover += 1;
      }
      assert.equal(
        remaining.length,
        leftover,
        `${testFault}: a handled failure removes its own pending file`,
      );
    }
  },
);
