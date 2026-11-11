import assert from "node:assert/strict";
import { createNotebookService } from "../../lib/notebook-service.js";

// Every way a store's commit can be interrupted, and which complete notebook
// must be on disk afterwards. Shared by both Windows encrypted stores.
export const notebookFaultMatrix = Object.freeze([
  ["before-write", "old"],
  ["during-write", "old"],
  ["after-write", "old"],
  ["before-replacement", "old"],
  ["after-replacement", "new"],
  ["disk-full", "old"],
  ["process-interruption", "old"],
  ["tampered-temporary", "old"],
]);

const HOME = "home-example";
const luna = (store) =>
  createNotebookService({
    store,
    householdId: HOME,
    authorize: async (id) => id === HOME,
  });

/**
 * Add one item through a store that fails at each stage, then reopen. The
 * reopened notebook must be exactly the old one or exactly the new one, and
 * Luna must only report a save that is really there.
 * @param {{ store: object, reopen: () => Promise<object>, withFault: (fault: string) => Promise<object>,
 *   afterEach?: (fault: string) => Promise<void> }} adapter
 */
export async function assertNotebookFaultMatrix({
  store,
  reopen,
  withFault,
  afterEach,
}) {
  // The whole snapshot is rewritten on each commit, so a neighbour must survive too.
  const neighbour = {
    memberId: "alex-example",
    label: "Workplace",
    value: "Willow Studio",
  };
  const saved = await store.create("alex-work", neighbour);
  const made = await luna(store).run({ op: "create_list", name: "Packing" });
  assert.equal(made.status, "applied");
  let expected = made.notebook;
  for (const [fault, outcome] of notebookFaultMatrix) {
    const text = `Fixture ${fault}`;
    const result = await luna(await withFault(fault)).run({
      op: "add_items",
      list: "packing",
      items: [{ text }],
    });
    const reopened = await reopen();
    assert.deepEqual(
      await reopened.read("alex-work"),
      { revision: saved.revision, data: neighbour },
      `${fault}: another record in the store is untouched`,
    );
    const read = await luna(reopened).read();
    assert.equal(read.status, "read", `${fault}: the notebook stays readable`);
    const texts = read.notebook.lists[0].items.map((item) => item.text);
    if (outcome === "new") {
      assert.equal(
        result.status,
        "applied",
        `${fault}: a landed write is reported as saved`,
      );
      assert.deepEqual(
        read.notebook,
        result.notebook,
        `${fault}: what was reported is what is stored`,
      );
      assert.equal(texts.at(-1), text, `${fault}: the new item is stored`);
      expected = read.notebook;
    } else {
      assert.notEqual(
        result.status,
        "applied",
        `${fault}: a failed write must not claim success`,
      );
      assert.deepEqual(
        read.notebook,
        expected,
        `${fault}: the old notebook is whole and unchanged`,
      );
    }
    await afterEach?.(fault);
  }
}
