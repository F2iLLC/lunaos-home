import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createNotebookService } from "../lib/notebook-service.js";
import { createNotebookAssistant } from "../lib/notebook-assistant.js";
import { createVaultSessionService } from "../lib/vault-sessions.js";
import {
  openWindowsProbeStore,
  openWindowsProbeStoreForFaultTest,
  removeWindowsProbeStore,
} from "../lib/windows-probe-store.js";
import { notebookFromEnvironment } from "../lib/windows-notebook.js";
import { createAppServer } from "../server.js";
import {
  openWindowsSnapshotStore,
  openWindowsSnapshotStoreForFaultTest,
  windowsSnapshotWorkerAvailable,
} from "../lib/windows-snapshot-store.js";

// Luna's notebook on the two real Windows encrypted stores. Each "restart" is a
// new adapter (a new worker process per call) over the bytes left on disk.
const HOME = "home-example";
const RECORD = `notebook-${HOME}`;
const notWindows = process.platform !== "win32";
// The PowerShell worker stores notebook timestamps unchanged only from 7.5 on,
// and refuses notebook records before that.
function powershellKeepsText() {
  try {
    const [major, minor] = execFileSync(
      "pwsh",
      ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
      { encoding: "utf8" },
    )
      .trim()
      .split(".")
      .map(Number);
    return major > 7 || (major === 7 && minor >= 5);
  } catch {
    return false;
  }
}

const adapters = [
  {
    name: "Windows DPAPI probe store",
    file: "records.bin",
    skip: notWindows
      ? "requires Windows"
      : !powershellKeepsText()
        ? "requires PowerShell 7.5 or later"
        : false,
    async create() {
      const store = await openWindowsProbeStore({
        create: true,
        contractVersion: 2,
      });
      const options = { probeId: store.probeId, contractVersion: 2 };
      return {
        store,
        reopen: () => openWindowsProbeStore(options),
        withFault: (fault) => openWindowsProbeStoreForFaultTest(options, fault),
      };
    },
  },
  {
    name: "WindowsSnapshotFileStore v1 (fixture protector)",
    file: "snapshot.bin",
    skip: notWindows
      ? "requires Windows"
      : !windowsSnapshotWorkerAvailable()
        ? "build the developer-harness worker first: npm run build:snapshot-store"
        : false,
    async create() {
      const protector = {
        kind: "fixture",
        key: crypto.getRandomValues(new Uint8Array(32)),
      };
      const store = await openWindowsSnapshotStore({ create: true, protector });
      const options = { storeId: store.storeId, protector };
      return {
        store,
        reopen: () => openWindowsSnapshotStore(options),
        withFault: (fault) =>
          openWindowsSnapshotStoreForFaultTest(options, fault),
      };
    },
  },
];

function luna(store, allowed = HOME, now) {
  const service = createNotebookService({
    store,
    householdId: HOME,
    authorize: async (id) => id === allowed,
    ...(now ? { now } : {}),
  });
  return { service, assistant: createNotebookAssistant({ service }) };
}
const texts = async (service, list, filter = "all") =>
  (await service.readList(list, filter)).view.items.map((item) => item.text);

test(
  "the Windows preview keeps Luna's notebook only when asked, and it is still there after a restart",
  { skip: adapters[0].skip, timeout: 180000 },
  async (t) => {
    assert.equal(notebookFromEnvironment({}, "win32"), undefined);
    assert.equal(
      notebookFromEnvironment({ LUNA_HOME_NOTEBOOK: "1" }, "linux"),
      undefined,
    );
    const env = {
      LUNA_HOME_NOTEBOOK: "1",
      LUNA_HOME_NOTEBOOK_STORE_ID: crypto.randomUUID(),
    };
    t.after(() =>
      removeWindowsProbeStore({
        probeId: env.LUNA_HOME_NOTEBOOK_STORE_ID,
      }).catch(() => {}),
    );
    // Each call builds the whole preview again: server, service and store adapter.
    const ask = async (body) => {
      const server = createAppServer({
        notebook: notebookFromEnvironment(env),
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const response = await fetch(
          `http://127.0.0.1:${server.address().port}/api/notebook`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Home-Preview": "1",
            },
            body: JSON.stringify(body),
          },
        );
        return { status: response.status, body: await response.json() };
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    };
    const empty = await ask({ action: "snapshot" });
    assert.deepEqual(
      [empty.status, empty.body.notebook.lists],
      [200, []],
      "reading an empty notebook creates nothing",
    );
    const made = await ask({
      action: "say",
      text: "create a list of books to read",
    });
    assert.equal(made.body.status, "applied");
    assert.equal(made.body.avatar.animation, "new-page");
    const added = await ask({
      action: "say",
      text: "add Dune to my books list",
    });
    assert.equal(added.body.status, "applied");
    const after = await ask({ action: "snapshot" });
    assert.deepEqual(
      after.body.notebook.lists.map((list) => [
        list.name,
        list.items.map((item) => item.text),
      ]),
      [["Books to read", ["Dune"]]],
    );
  },
);

for (const adapter of adapters) {
  const options = { skip: adapter.skip, timeout: 180000 };

  test(
    `${adapter.name}: spoken lists survive a restart, encrypted and unchanged`,
    options,
    async (t) => {
      const { store, reopen } = await adapter.create();
      t.after(() => store.removeSyntheticStore());

      // A whole-second timestamp is the case a JSON layer is most likely to
      // rewrite; the notebook must come back as the exact text that was saved.
      const first = luna(store, HOME, () => "2026-11-10T20:00:00.000Z");
      let committed;
      first.service.subscribe((notebook) => {
        committed = notebook;
      });
      for (const line of [
        "create a list of movies to watch",
        "add Interstellar and Arrival",
        "create a grocery list",
        "put 2 gallons of milk, eggs, and tortillas on the grocery list",
        "cross Arrival off my movies list",
      ]) {
        const outcome = await first.assistant.handle(line);
        assert.equal(outcome.status, "applied", line);
      }
      const before = committed;
      assert.equal(before.lists.length, 2);

      const bytes = await readFile(path.join(store.directory, adapter.file));
      for (const secret of ["Interstellar", "tortillas", "Tortillas", HOME]) {
        assert.equal(
          bytes.includes(Buffer.from(secret)),
          false,
          `${secret} must not be readable on disk`,
        );
      }

      const second = luna(await reopen());
      // Field for field, including quantities, order and the exact timestamps.
      assert.deepEqual((await second.service.read()).notebook, before);
      assert.deepEqual(await texts(second.service, "movies", "active"), [
        "Interstellar",
      ]);
      assert.deepEqual(await texts(second.service, "movies", "completed"), [
        "Arrival",
      ]);
      assert.deepEqual(await texts(second.service, "grocery"), [
        "Milk",
        "Eggs",
        "Tortillas",
      ]);
      const milk = (await second.service.readList("grocery")).view.items[0];
      assert.deepEqual([milk.quantity, milk.unit], [2, "gallons"]);
      assert.equal(
        (await second.assistant.handle("what lists do I have")).status,
        "read",
      );

      // The restarted process keeps working on the same record.
      assert.equal(
        (await second.assistant.handle("add bananas to the grocery list"))
          .status,
        "applied",
      );
      const third = luna(await reopen());
      assert.deepEqual(await texts(third.service, "grocery"), [
        "Milk",
        "Eggs",
        "Tortillas",
        "Bananas",
      ]);
      assert.equal(
        (await luna(await reopen(), "another-home").service.read()).status,
        "denied",
      );
    },
  );

  test(
    `${adapter.name}: a profile session cannot read or overwrite the notebook`,
    options,
    async (t) => {
      const { store } = await adapter.create();
      const sessions = createVaultSessionService({ store, contractVersion: 2 });
      t.after(async () => {
        await sessions.shutdown();
        await store.removeSyntheticStore();
      });
      const { service } = luna(store);
      await service.run({ op: "create_list", name: "Gift ideas" });
      const stored = await store.read(RECORD);

      sessions.admitDevice("windows-example");
      const connection = sessions.openConnection({
        deviceId: "windows-example",
      });
      const grant = sessions.approveSetup(connection, {
        recordIds: [RECORD],
        lifetimeMs: 60000,
      });
      await assert.rejects(
        connection.execute(grant, {
          version: 2,
          action: "read",
          recordId: RECORD,
        }),
        { code: "READ_FAILED" },
      );
      await assert.rejects(
        connection.execute(grant, {
          version: 2,
          action: "edit",
          recordId: RECORD,
          expectedRevision: stored.revision,
          data: {
            memberId: "member-example",
            label: "Profile",
            value: "Profile value",
          },
        }),
        { code: "UNSUPPORTED" },
      );
      assert.deepEqual(await store.read(RECORD), stored);
    },
  );

  test(
    `${adapter.name}: a failed write is never reported as saved, and a lost acknowledgement is settled by readback`,
    options,
    async (t) => {
      const { store, reopen, withFault } = await adapter.create();
      t.after(() => store.removeSyntheticStore());
      await luna(store).assistant.handle("create a packing list");
      await luna(store).assistant.handle("add socks to the packing list");

      // The write never lands: Luna says so and the list on disk is unchanged.
      const broken = luna(await withFault("before-write"));
      const refused = await broken.assistant.handle(
        "add a toothbrush to the packing list",
      );
      assert.equal(refused.status, "failed");
      assert.equal(refused.avatar.animation, "puzzled");
      assert.equal(refused.avatar.success, false);
      assert.deepEqual(await texts(luna(await reopen()).service, "packing"), [
        "Socks",
      ]);

      // Recovery: the same request on a healthy store is saved.
      const healthy = luna(await reopen());
      const saved = await healthy.assistant.handle(
        "add a toothbrush to the packing list",
      );
      assert.equal(saved.status, "applied");

      // The write lands but its acknowledgement is lost: readback proves it.
      const lossy = luna(await withFault("after-replacement"));
      const settled = await lossy.service.run({
        op: "add_items",
        list: "packing",
        items: [{ text: "Sunscreen" }],
      });
      assert.equal(settled.status, "applied");
      assert.equal(settled.reconciled, true);
      assert.deepEqual(await texts(luna(await reopen()).service, "packing"), [
        "Socks",
        "Toothbrush",
        "Sunscreen",
      ]);
    },
  );
}
