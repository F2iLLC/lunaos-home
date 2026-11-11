import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../server.js";
import { createMemoryVersionedStore } from "./support/memory-versioned-store.js";
import { createNotebookService } from "../lib/notebook-service.js";
import { createNotebookAssistant } from "../lib/notebook-assistant.js";
import { createNotebookApi } from "../lib/notebook-api.js";

function build(backing = new Map(), storeWrap = (store) => store) {
  const service = createNotebookService({
    store: storeWrap(createMemoryVersionedStore(backing)),
    householdId: "home-demo",
    authorize: async (id) => id === "home-demo",
  });
  return createNotebookApi({
    service,
    assistant: createNotebookAssistant({ service }),
  });
}

async function withServer(notebook, run) {
  const server = createAppServer({ notebook });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const post = async (body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/notebook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Home-Preview": "1",
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await run({ post, port });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("voice and UI edits meet in one store through the real HTTP path, and survive a restart", async () => {
  const backing = new Map();
  await withServer(build(backing), async ({ post }) => {
    const spoken = await post({
      action: "say",
      text: "Hey Luna, create a list of movies to watch.",
    });
    assert.equal(spoken.body.avatar.animation, "new-page");
    assert.equal(spoken.body.notebook.lists[0].name, "Movies to watch");
    const listId = spoken.body.notebook.lists[0].id;

    // UI adds an item; the next spoken query sees it.
    const ui = await post({
      action: "op",
      operation: {
        op: "add_items",
        list: listId,
        items: [{ text: "Interstellar" }],
      },
    });
    assert.equal(ui.body.status, "applied");
    assert.equal(
      (await post({ action: "say", text: "what's on my movies list" })).body
        .reply,
      "Your Movies to watch list contains Interstellar.",
    );

    // Voice completes an item; the next UI snapshot shows it.
    await post({ action: "say", text: "cross off Interstellar" });
    const snapshot = await post({ action: "snapshot" });
    assert.equal(snapshot.body.notebook.lists[0].items[0].completed, true);
  });
  // Restart: new server, service and assistant over the same stored bytes.
  await withServer(build(backing), async ({ post }) => {
    const snapshot = await post({ action: "snapshot" });
    assert.equal(snapshot.body.notebook.lists[0].items[0].text, "Interstellar");
    assert.equal(snapshot.body.notebook.lists[0].items[0].completed, true);
  });
});

test("a storage failure surfaces as failure with a puzzled Luna and no change", async () => {
  const backing = new Map();
  let failing = false;
  const wrap = (store) => ({
    ...store,
    contractVersion: 2,
    read: (id) => store.read(id),
    edit: (...args) => {
      if (failing) throw new Error("disk full");
      return store.edit(...args);
    },
    create: (...args) => store.create(...args),
  });
  await withServer(build(backing, wrap), async ({ post }) => {
    await post({ action: "say", text: "create a grocery list" });
    failing = true;
    const failed = await post({
      action: "say",
      text: "add milk to the grocery list",
    });
    assert.match(failed.body.reply, /nothing changed/);
    assert.deepEqual(failed.body.avatar, {
      animation: "puzzled",
      success: false,
    });
    assert.equal(failed.body.notebook.lists[0].items.length, 0);
    // Recovery: the same request succeeds once storage returns.
    failing = false;
    const retried = await post({
      action: "say",
      text: "add milk to the grocery list",
    });
    assert.equal(retried.body.avatar.animation, "scribble");
    assert.equal(retried.body.notebook.lists[0].items.length, 1);
  });
});

test("the route keeps the preview guards and is off when no notebook is wired", async () => {
  await withServer(build(), async ({ post, port }) => {
    const missingHeader = await fetch(`http://127.0.0.1:${port}/api/notebook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(missingHeader.status, 403);
    assert.equal(
      (await post({ action: "bogus" })).body.avatar.animation,
      "puzzled",
    );
    assert.equal(
      (
        await post({
          action: "op",
          operation: { op: "delete_list", list: "x" },
        })
      ).body.status,
      "failed",
    );
    const page = await fetch(`http://127.0.0.1:${port}/notebook.js`);
    assert.equal(page.status, 200);
  });
  const bare = createAppServer();
  await new Promise((resolve) => bare.listen(0, "127.0.0.1", resolve));
  const { port } = bare.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/notebook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Home-Preview": "1" },
    body: "{}",
  });
  assert.equal(response.status, 503);
  await new Promise((resolve) => bare.close(resolve));
});
