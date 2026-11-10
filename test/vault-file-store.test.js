import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fixtureProtector,
  openVaultFileStore,
  VaultStoreError,
} from "../lib/vault-file-store.js";
import { macKeychainProtector } from "../lib/mac-keychain-protector.js";
import { createGroceryPersistence } from "../lib/grocery-persistence.js";
import { createVaultNotebook } from "../lib/vault-notebook.js";
import { createVaultSessionService } from "../lib/vault-sessions.js";
import { VaultConflictError } from "../lib/vault-record-contract.js";
import { defineVersionedStoreConformance } from "./support/versioned-store-conformance.js";

// The household vault's store on the Mac host. Everything except the Keychain
// tests runs on every platform with a caller-held key.
const alex = {
  memberId: "alex-example",
  label: "Workplace",
  value: "Willow Studio",
};
const groceryList = {
  id: "weekly",
  householdId: "home-example",
  label: "Weekly",
  items: [],
  revision: "3d735c0e-3176-4502-8717-8e62f59d3a91",
  updatedBy: { kind: "human", id: "alex-example" },
};

async function fresh(protector) {
  const directory = path.join(
    await mkdtemp(path.join(tmpdir(), "home-vault-")),
    "store",
  );
  const storeId = `test-${crypto.randomUUID()}`;
  const key =
    protector ?? fixtureProtector(crypto.getRandomValues(new Uint8Array(32)));
  const options = { directory, storeId, protector: key };
  const store = await openVaultFileStore({ ...options, create: true });
  return {
    store,
    options,
    directory,
    reopen: (extra = {}) => openVaultFileStore({ ...options, ...extra }),
    dispose: () =>
      rm(path.dirname(directory), { recursive: true, force: true }),
  };
}

defineVersionedStoreConformance(test, {
  name: "VaultFileStore v1, fixture key",
  open: fresh,
  atRest: ({ directory }) => readFile(path.join(directory, "vault.bin")),
});

test("member details, the grocery list and Luna's notebook live in one vault store and survive a restart", async (t) => {
  const { store, reopen, directory, dispose } = await fresh();
  t.after(dispose);
  const saved = await store.create("alex-work", alex);
  await createGroceryPersistence({ store }).createList(groceryList);
  const first = createVaultNotebook({ store });
  // People come from the vault: only someone with a saved detail can be chosen.
  assert.equal(
    (await first.request({ action: "member", memberId: "sam-example" })).status,
    "failed",
  );
  const chosen = await first.request({
    action: "member",
    memberId: "alex-example",
  });
  assert.deepEqual(chosen.members, [
    { id: "alex-example", name: "Alex Example" },
  ]);
  assert.equal(chosen.member, "alex-example");
  for (const text of [
    "create a list of movies to watch",
    "add Interstellar and Arrival",
  ])
    assert.equal(
      (await first.request({ action: "say", text })).status,
      "applied",
    );

  const bytes = await readFile(path.join(directory, "vault.bin"));
  for (const secret of [
    "Interstellar",
    "Willow Studio",
    "Weekly",
    "alex-example",
  ])
    assert.equal(bytes.includes(Buffer.from(secret)), false, secret);
  assert.deepEqual((await readdir(directory)).sort(), ["vault.bin"]);

  // A new process: new adapter, new services, the same file.
  const again = await reopen();
  const second = createVaultNotebook({ store: again });
  const snapshot = await second.request({ action: "snapshot" });
  const movies = snapshot.notebook.lists[0];
  assert.deepEqual(
    movies.items.map((item) => [item.text, item.updatedBy]),
    [
      ["Interstellar", { kind: "human", id: "alex-example" }],
      ["Arrival", { kind: "human", id: "alex-example" }],
    ],
  );
  assert.equal(
    snapshot.member,
    null,
    "who is writing is not remembered across a restart",
  );
  assert.deepEqual(await again.read("alex-work"), { ...saved, data: alex });
  assert.equal((await again.read("weekly")).data.kind, "grocery-list");

  // A profile session can neither read nor overwrite the list records.
  const sessions = createVaultSessionService({
    store: again,
    contractVersion: 2,
  });
  t.after(() => sessions.shutdown());
  sessions.admitDevice("mac-host");
  const connection = sessions.openConnection({ deviceId: "mac-host" });
  for (const recordId of ["weekly", "notebook-home-example"]) {
    const grant = sessions.approveSetup(connection, {
      recordIds: [recordId],
      lifetimeMs: 60000,
    });
    const stored = await again.read(recordId);
    await assert.rejects(
      connection.execute(grant, { version: 2, action: "read", recordId }),
      { code: "READ_FAILED" },
    );
    await assert.rejects(
      connection.execute(grant, {
        version: 2,
        action: "edit",
        recordId,
        expectedRevision: stored.revision,
        data: alex,
      }),
      { code: "UNSUPPORTED" },
    );
    assert.deepEqual(await again.read(recordId), stored);
  }
});

test("a wrong key, a moved snapshot, tampering and truncation are all unreadable and change nothing", async (t) => {
  const { store, options, directory, dispose } = await fresh();
  t.after(dispose);
  await store.create("alex-work", alex);
  const file = path.join(directory, "vault.bin");
  const good = await readFile(file);
  const unreadable = { code: "READ_FAILED" };
  await assert.rejects(
    openVaultFileStore({
      ...options,
      protector: fixtureProtector(new Uint8Array(32)),
    }),
    unreadable,
  );
  await assert.rejects(
    openVaultFileStore({ ...options, storeId: "another-store" }),
    unreadable,
  );
  for (const damaged of [
    Buffer.concat([
      good.subarray(0, good.length - 1),
      Buffer.from([good.at(-1) ^ 1]),
    ]),
    good.subarray(0, good.length - 9),
    Buffer.alloc(0),
  ]) {
    await writeFile(file, damaged);
    await assert.rejects(store.read("alex-work"), unreadable);
    await assert.rejects(store.create("sam-school", alex), unreadable);
    assert.deepEqual(
      await readFile(file),
      damaged,
      "a damaged file is never overwritten",
    );
  }
  await writeFile(file, good);
  assert.deepEqual((await store.read("alex-work")).data, alex);
  // A missing store is not an empty store.
  await rm(file);
  await assert.rejects(openVaultFileStore(options), { code: "MISSING" });
  assert.ok(new VaultStoreError("MISSING") instanceof Error);
});

test("an interrupted commit leaves the old snapshot or the new one, never a mixture", async (t) => {
  const { store, reopen, directory, dispose } = await fresh();
  t.after(dispose);
  const { revision } = await store.create("alex-work", alex);
  let expected = { revision, data: alex };
  for (const [stage, outcome] of [
    ["before-write", "old"],
    ["after-write", "old"],
    ["before-replacement", "old"],
    ["after-replacement", "new"],
  ]) {
    const value = { ...alex, value: `Fixture ${stage}` };
    const faulty = await reopen({
      fault: (at) => {
        if (at === stage) throw new Error(`injected ${stage}`);
      },
    });
    await assert.rejects(
      faulty.edit("alex-work", value, expected.revision),
      /injected/,
      `${stage}: a failed commit is never acknowledged`,
    );
    const row = await (await reopen()).read("alex-work");
    if (outcome === "new") {
      assert.deepEqual(row.data, value);
      assert.notEqual(row.revision, expected.revision);
      expected = row;
    } else assert.deepEqual(row, expected, `${stage}: old state`);
    assert.deepEqual((await readdir(directory)).sort(), ["vault.bin"], stage);
  }
});

test("a lock left by a process that no longer exists is released; a live holder is waited for", async (t) => {
  const { store, reopen, directory, dispose } = await fresh();
  t.after(dispose);
  await writeFile(path.join(directory, ".lock"), "2147483646"); // no such process
  assert.equal((await store.create("alex-work", alex)).revision.length, 36);
  // Two adapters over one file: every conditional write is ordered by the lock.
  const other = await reopen();
  const row = await store.read("alex-work");
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, index) =>
      (index % 2 ? store : other).edit(
        "alex-work",
        { ...alex, value: `Writer ${index}` },
        row.revision,
      ),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  for (const result of results.filter((entry) => entry.status === "rejected"))
    assert.ok(result.reason instanceof VaultConflictError);
});

test("the Keychain protector refuses to run anywhere but macOS", () => {
  assert.throws(
    () => macKeychainProtector({ storeId: "household", platform: "win32" }),
    /macOS/,
  );
  assert.throws(
    () => macKeychainProtector({ storeId: "../x", platform: "darwin" }),
    TypeError,
  );
});

test(
  "on the Mac the vault key comes from the login Keychain and the store reopens with it",
  { skip: process.platform !== "darwin" ? "requires macOS" : false },
  async (t) => {
    const storeId = `test-${crypto.randomUUID()}`;
    const protector = macKeychainProtector({ storeId });
    t.after(() => protector.remove());
    const { store, options, dispose } = await fresh(protector).then(
      async (handle) => handle,
    );
    t.after(dispose);
    // fresh() chose its own store id; bind the Keychain item to that one.
    assert.ok(store.storeId);
    await store.create("alex-work", alex);
    const again = await openVaultFileStore(options);
    assert.deepEqual((await again.read("alex-work")).data, alex);
    // The key that exists is never replaced by a second "create".
    await assert.rejects(protector.key({ create: true }), /already exists/);
    assert.equal((await protector.key()).length, 32);
  },
);

test("the checklist is a notebook list in the vault: categories, completion and Luna all meet in one record", async (t) => {
  const { store, reopen, dispose } = await fresh();
  t.after(dispose);
  const home = createVaultNotebook({ store });
  const op = (operation) => home.request({ action: "op", operation });
  assert.equal(
    (await op({ op: "create_list", name: "My checklist", type: "checklist" }))
      .status,
    "applied",
  );
  const added = await op({
    op: "add_items",
    list: "My checklist",
    allowDuplicate: true,
    items: [{ text: "Sign the field trip form", category: "School paperwork" }],
  });
  assert.equal(added.status, "applied");
  // Luna adds to the same list by name.
  const spoken = await home.request({
    action: "say",
    text: "add call the dentist to my checklist",
  });
  assert.equal(spoken.status, "applied");
  const list = spoken.notebook.lists.find(
    (entry) => entry.type === "checklist",
  );
  assert.deepEqual(
    list.items.map((item) => [item.text, item.category]),
    [
      ["Sign the field trip form", "School paperwork"],
      ["Call the dentist", undefined],
    ],
  );
  await op({
    op: "complete_item",
    list: list.id,
    item: list.items[0].id,
    completed: true,
  });
  const after = await createVaultNotebook({ store: await reopen() }).request({
    action: "snapshot",
  });
  assert.deepEqual(
    after.notebook.lists[0].items.map((item) => [item.text, item.completed]),
    [
      ["Sign the field trip form", true],
      ["Call the dentist", false],
    ],
  );
});
