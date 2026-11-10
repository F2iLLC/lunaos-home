import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryVersionedStore } from "./support/memory-versioned-store.js";
import { createNotebookService } from "../lib/notebook-service.js";
import {
  createNotebookAssistant,
  parseUtterance,
  splitItems,
} from "../lib/notebook-assistant.js";
import {
  avatarForOutcome,
  createNotebookOverlay,
} from "../lib/notebook-avatar.js";
import {
  applyNotebookOperation,
  emptyNotebook,
  MAX_NOTEBOOK_ITEMS,
} from "../lib/notebook-contract.js";

const HOME = "home-demo";
function setup({
  backing = new Map(),
  household = HOME,
  allowed = HOME,
  wrap,
} = {}) {
  let store = createMemoryVersionedStore(backing);
  if (wrap) store = wrap(store);
  const service = createNotebookService({
    store,
    householdId: household,
    authorize: async (id) => id === allowed,
  });
  let clock = 1_000_000;
  const assistant = createNotebookAssistant({ service, now: () => clock });
  return {
    backing,
    store,
    service,
    assistant,
    advance: (ms) => {
      clock += ms;
    },
  };
}
const say = async (assistant, text) => assistant.handle(text);
const names = async (service) =>
  (await service.read()).notebook.lists.map((list) => list.name);

test("one engine creates three differently named lists with no cross-contamination", async () => {
  const { assistant, service } = setup();
  await say(assistant, "Hey Luna, create a list of TV shows to watch.");
  await say(assistant, "Add Severance and Silo to my watch list.");
  await say(assistant, "Create a grocery list");
  await say(assistant, "Put milk, eggs, and tortillas on the grocery list.");
  await say(assistant, "Make a to-do list");
  await say(assistant, "Add cleaning the kitchen to my to-do list.");
  const view = async (ref) =>
    (await service.readList(ref)).view.items.map((item) => item.text);
  assert.deepEqual(await view("TV shows to watch"), ["Severance", "Silo"]);
  assert.deepEqual(await view("grocery"), ["Milk", "Eggs", "Tortillas"]);
  assert.deepEqual(await view("to-do"), ["Cleaning the kitchen"]);
  assert.equal(
    (await say(assistant, "What's on my grocery list?")).reply,
    "Grocery list: Milk, Eggs and Tortillas.",
  );
});

test("conversational follow-ups use the active list, remove, and what is left", async () => {
  const { assistant } = setup();
  assert.match(
    (await say(assistant, "Create a list of movies to watch.")).reply,
    /made your/,
  );
  assert.match(
    (await say(assistant, "Add Interstellar and Arrival.")).reply,
    /Added both/,
  );
  assert.equal(
    (await say(assistant, "Actually, remove Arrival.")).reply,
    "Removed Arrival.",
  );
  assert.equal(
    (await say(assistant, "What's left?")).reply,
    "Movies to watch: Interstellar.",
  );
  assert.match((await say(assistant, "add Dune too")).reply, /Added Dune/);
});

test("complete keeps the item; active and completed are retrievable separately", async () => {
  const { assistant, service } = setup();
  await say(assistant, "create a to-do list");
  await say(assistant, "add laundry, dishes to my to-do list");
  const marked = await say(assistant, "mark laundry as done");
  assert.equal(marked.avatar.animation, "checkmark");
  assert.equal(
    (await service.readList("to-do", "active")).view.items.length,
    1,
  );
  assert.equal(
    (await service.readList("to-do", "completed")).view.items[0].text,
    "Laundry",
  );
  assert.equal(
    (await say(assistant, "what have I finished")).reply,
    "To-do list: Laundry.",
  );
  assert.equal((await service.readList("to-do", "all")).view.items.length, 2);
});

test("remove targets the right list; move and rename preserve contents", async () => {
  const { assistant, service } = setup();
  await say(assistant, "create a grocery list");
  await say(assistant, "create a shopping list");
  await say(assistant, "add milk, batteries to the grocery list");
  await say(assistant, "add soap to the shopping list");
  await say(assistant, "remove milk from the grocery list");
  assert.deepEqual(
    (await service.readList("shopping")).view.items.map((i) => i.text),
    ["Soap"],
  );
  const moved = await say(
    assistant,
    "move batteries from groceries to shopping",
  );
  assert.match(
    moved.reply,
    /Moved Batteries from Grocery list to Shopping list/,
  );
  assert.deepEqual(
    (await service.readList("shopping")).view.items.map((i) => i.text),
    ["Soap", "Batteries"],
  );
  assert.equal((await service.readList("grocery")).view.items.length, 0);
  await say(assistant, "rename my shopping list to household supplies");
  assert.deepEqual(await names(service), [
    "Grocery list",
    "Household supplies",
  ]);
  assert.deepEqual(
    (await service.readList("household supplies")).view.items.map(
      (i) => i.text,
    ),
    ["Soap", "Batteries"],
  );
});

test("quantities, units and notes survive; duplicates are prevented but repeats are allowed", async () => {
  assert.deepEqual(splitItems("2 gallons of milk, a dozen eggs and 3 apples"), [
    { text: "Milk", quantity: 2, unit: "gallons" },
    { text: "Eggs", quantity: 1, unit: "dozen" },
    { text: "Apples", quantity: 3 },
  ]);
  const { assistant, service } = setup();
  await say(assistant, "create a grocery list");
  await say(assistant, "add 2 gallons of milk to the grocery list");
  const again = await say(assistant, "add milk to the grocery list");
  assert.match(again.reply, /already on/);
  assert.equal(again.avatar.success, false);
  assert.equal((await service.readList("grocery")).view.items.length, 1);
  await say(assistant, "mark milk as done");
  await say(assistant, "add milk to the grocery list"); // finished item does not block a new one
  const items = (await service.readList("grocery")).view.items;
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].quantity, items[0].unit], [2, "gallons"]);
  const deliberate = await service.run({
    op: "add_items",
    list: "grocery",
    items: [{ text: "Milk" }],
    allowDuplicate: true,
  });
  assert.equal(deliberate.result.added.length, 1);
});

test("ambiguous list references ask instead of guessing, then complete on the answer", async () => {
  const { assistant, service } = setup();
  await say(assistant, "create a list of movies to watch");
  await say(assistant, "create a list of shows to watch");
  const ask = await say(assistant, "add Arrival to my watch list");
  assert.equal(ask.avatar.animation, "hover");
  assert.match(ask.reply, /Which list/);
  assert.equal((await service.readList("movies")).view.items.length, 0);
  const answered = await say(assistant, "movies to watch");
  assert.match(answered.reply, /Added Arrival/);
  assert.equal((await service.readList("movies")).view.items.length, 1);
  assert.equal((await service.readList("shows")).view.items.length, 0);
});

test("stale context and unrelated talk never modify a list", async () => {
  const { assistant, service, advance } = setup();
  await say(assistant, "create a grocery list");
  await say(assistant, "add eggs");
  advance(121_000);
  const stale = await say(assistant, "add bananas too");
  assert.match(stale.reply, /Which list/);
  assert.equal((await service.readList("grocery")).view.items.length, 1);
  assert.deepEqual(await say(assistant, "what is the weather like"), {
    handled: false,
  });
  assert.equal(parseUtterance("add 5 minutes to the timer"), null);
  assert.equal(parseUtterance("add a minute"), null);
});

test("delete and clear need confirmation; anything else cancels", async () => {
  const { assistant, service } = setup();
  await say(assistant, "create a list of gift ideas");
  await say(assistant, "add scarf, book to my gift ideas list");
  const ask = await say(assistant, "delete my gift ideas list");
  assert.match(ask.reply, /Say yes to confirm/);
  assert.equal((await names(service)).length, 1);
  await say(assistant, "no");
  assert.equal((await names(service)).length, 1);
  await say(assistant, "delete my gift ideas list");
  await say(assistant, "add hat to my gift ideas list"); // unrelated utterance cancels the pending delete
  assert.deepEqual(await say(assistant, "yes"), { handled: false });
  assert.equal((await service.readList("gift")).view.items.length, 3);
  await say(assistant, "clear my gift ideas list");
  assert.equal((await service.readList("gift")).view.items.length, 3);
  assert.equal(
    (await say(assistant, "yes")).reply,
    "Cleared 3 items from Gift ideas.",
  );
  await say(assistant, "delete my gift ideas list");
  assert.equal((await say(assistant, "yes")).reply, "Deleted Gift ideas.");
  assert.deepEqual(await names(service), []);
});

test("a confirmation expires", async () => {
  const { assistant, service, advance } = setup();
  await say(assistant, "create a grocery list");
  await say(assistant, "delete my grocery list");
  advance(31_000);
  assert.deepEqual(await say(assistant, "yes"), { handled: false });
  assert.equal((await names(service)).length, 1);
});

test("lists persist across a restart of the adapter", async () => {
  const backing = new Map();
  const first = setup({ backing });
  await say(first.assistant, "create a grocery list");
  await say(first.assistant, "add milk and eggs");
  const second = setup({ backing }); // new adapter, service and assistant over the same bytes
  assert.equal(
    (await say(second.assistant, "what lists do I have")).reply,
    "You have 1 list: Grocery list.",
  );
  assert.equal(
    (await say(second.assistant, "what's on my grocery list")).reply,
    "Grocery list: Milk and Eggs.",
  );
});

test("simultaneous writers lose no updates", async () => {
  const backing = new Map();
  const a = setup({ backing });
  const b = setup({ backing });
  await a.service.run({ op: "create_list", name: "Shared" });
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      (i % 2 ? a : b).service.run({
        op: "add_items",
        list: "shared",
        items: [{ text: `Item ${i}` }],
      }),
    ),
  );
  const items = (await a.service.readList("shared")).view.items;
  assert.equal(items.length, 12);
  assert.equal(new Set(items.map((i) => i.text)).size, 12);
});

test("another household is denied", async () => {
  const { backing } = setup();
  const intruder = createNotebookService({
    store: createMemoryVersionedStore(backing),
    householdId: "other-home",
    authorize: async (id) => id === HOME,
  });
  assert.equal(
    (await intruder.run({ op: "create_list", name: "Sneaky" })).status,
    "denied",
  );
  const own = setup({ backing });
  await own.service.run({ op: "create_list", name: "Private" });
  assert.equal((await intruder.read()).status, "denied");
  const forged = await own.service.run(
    { op: "create_list", name: "Forged" },
    "other-home",
  );
  assert.equal(forged.status, "denied");
  assert.deepEqual(await names(own.service), ["Private"]);
  const failing = createNotebookService({
    store: createMemoryVersionedStore(backing),
    householdId: HOME,
    authorize: async () => {
      throw new Error("session ended");
    },
  });
  assert.equal((await failing.read()).status, "denied");
});

test("storage failure reports failure with no success animation and changes nothing", async () => {
  const faulty = setup({
    wrap: (store) => ({
      ...store,
      contractVersion: 2,
      read: (id) => store.read(id),
      create: (id) => {
        throw new Error("disk full");
      },
      edit: store.edit,
    }),
  });
  const outcome = await say(faulty.assistant, "create a grocery list");
  assert.match(outcome.reply, /nothing changed/);
  assert.equal(outcome.avatar.animation, "puzzled");
  assert.equal(outcome.avatar.success, false);
  assert.deepEqual(faulty.backing.size, 0);
});

test("a lost acknowledgement is reconciled by readback; an unreadable one is reported unknown", async () => {
  const reconciled = setup({
    wrap: (store) => ({
      ...store,
      contractVersion: 2,
      read: (id) => store.read(id),
      edit: store.edit,
      create: async (id, data) => {
        await store.create(id, data);
        throw new Error("ack lost");
      },
    }),
  });
  const ok = await reconciled.service.run({
    op: "create_list",
    name: "Grocery",
  });
  assert.equal(ok.status, "applied");
  assert.equal(ok.reconciled, true);

  let broken = false;
  const unknown = setup({
    wrap: (store) => ({
      ...store,
      contractVersion: 2,
      edit: store.edit,
      read: (id) => {
        if (broken) throw new Error("offline");
        return store.read(id);
      },
      create: async (id, data) => {
        await store.create(id, data);
        broken = true;
        throw new Error("ack lost");
      },
    }),
  });
  const outcome = await say(unknown.assistant, "create a grocery list");
  assert.equal(outcome.status, "unknown");
  assert.match(outcome.reply, /couldn't confirm/);
  assert.equal(outcome.avatar.animation, "puzzled");
});

test("avatar animation follows the actual operation", async () => {
  const { assistant } = setup();
  const play = async (text) => (await say(assistant, text)).avatar.animation;
  assert.equal(await play("create a list of books to read"), "new-page");
  assert.equal(await play("add Dune to my books list"), "scribble");
  assert.equal(await play("what's on my books list"), "read");
  assert.equal(await play("cross off Dune on my books list"), "checkmark");
  assert.equal(await play("add Emma to my books list"), "scribble");
  assert.equal(await play("remove Emma"), "cross-out");
  assert.equal(await play("rename my books list to reading"), "erase-rewrite");
  assert.equal(await play("add Emma to my cooking list"), "puzzled");
  assert.equal(avatarForOutcome({ status: "failed" }).success, false);
  assert.equal(avatarForOutcome({ status: "denied" }).animation, "puzzled");
});

test("overlay yields to sleep and timers and expires on its own", () => {
  let t = 0;
  const overlay = createNotebookOverlay({ now: () => t, durationMs: 1000 });
  assert.equal(
    overlay.play({ animation: "scribble", success: true }, "sleeping"),
    null,
  );
  assert.equal(
    overlay.play({ animation: "scribble", success: true }, "timer-ringing"),
    null,
  );
  assert.equal(overlay.active(), null);
  overlay.play({ animation: "scribble", success: true }, "awake");
  assert.equal(overlay.active().animation, "scribble");
  t = 1000;
  assert.equal(overlay.active(), null);
});

test("transitions are pure, bounded and reject bad input", () => {
  const book = emptyNotebook(HOME);
  const before = structuredClone(book);
  const { notebook: next } = applyNotebookOperation(book, {
    op: "create_list",
    name: "A",
  });
  assert.deepEqual(book, before);
  assert.notEqual(next.commitId, book.commitId);
  assert.throws(
    () => applyNotebookOperation(next, { op: "create_list", name: "a" }),
    (e) => e.code === "DUPLICATE_LIST",
  );
  assert.throws(
    () => applyNotebookOperation(next, { op: "delete_list", list: "a" }),
    (e) => e.code === "CONFIRMATION_REQUIRED",
  );
  assert.throws(
    () => applyNotebookOperation(next, { op: "bogus" }),
    (e) => e.code === "INVALID",
  );
  let full = next;
  for (let i = 0; i < MAX_NOTEBOOK_ITEMS; i += 1)
    full = applyNotebookOperation(full, {
      op: "add_items",
      list: "a",
      items: [{ text: `x${i}` }],
    }).notebook;
  assert.throws(
    () =>
      applyNotebookOperation(full, {
        op: "add_items",
        list: "a",
        items: [{ text: "one more" }],
      }),
    (e) => e.code === "LIMIT",
  );
});

test("the shared store accepts a notebook record without disturbing other kinds", async () => {
  const { service, backing } = setup();
  await service.run({ op: "create_list", name: "Grocery" });
  const stored = JSON.parse([...backing.values()][0]);
  assert.equal(stored.data.kind, "household-notebook");
});
