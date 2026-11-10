import {
  applyNotebookOperation,
  emptyNotebook,
  notebook as notebookSchema,
  NotebookError,
  viewList,
} from "./notebook-contract.js";
import {
  notebookStoredRecord,
  versionedVaultRecord,
  VaultConflictError,
} from "./vault-record-contract.js";

const MAX_ATTEMPTS = 5;
const recordIdFor = (householdId) => `notebook-${householdId}`.slice(0, 80);

/**
 * The single authoritative path to household lists, shared by voice, the UI and
 * future transports. Every result states what actually happened:
 *  - applied: the encrypted store accepted the commit (or readback proved it)
 *  - failed:  nothing changed (rejected before or by the store)
 *  - unknown: acknowledgement lost and readback failed; caller must not claim success
 *  - denied:  the household is not the caller's
 *
 * `authorize(householdId)` must resolve true only for the live session's own
 * household. It is rechecked on every call; identifiers are never authority.
 */
export function createNotebookService({
  store,
  householdId,
  authorize,
  now = () => new Date().toISOString(),
  newId,
} = {}) {
  if (
    !store ||
    store.contractVersion !== 2 ||
    !["read", "create", "edit"].every((key) => typeof store[key] === "function")
  ) {
    throw new TypeError("A versioned encrypted-store adapter is required.");
  }
  if (typeof authorize !== "function")
    throw new TypeError("A session authorizer is required.");
  const recordId = recordIdFor(householdId);
  const listeners = new Set();
  // Same-process writers queue so a burst of voice commands applies in order;
  // cross-process/device writers are protected by the store's compare-and-swap.
  let tail = Promise.resolve();

  async function load() {
    let row;
    try {
      row = await store.read(recordId);
    } catch {
      throw new NotebookError("READ_FAILED");
    }
    if (row == null)
      return { revision: null, book: emptyNotebook(householdId) };
    let parsed;
    try {
      parsed = notebookStoredRecord.parse(versionedVaultRecord.parse(row).data);
    } catch {
      throw new NotebookError("READ_FAILED");
    }
    if (parsed.notebook.householdId !== householdId)
      throw new NotebookError("NOT_FOUND");
    return { revision: row.revision, book: parsed.notebook };
  }

  const gate = async (claimed) => {
    let ok = false;
    try {
      ok = claimed === householdId && (await authorize(claimed)) === true;
    } catch {
      ok = false;
    }
    return ok;
  };

  async function mutate(operation) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const { revision, book } = await load();
      const { notebook: next, result } = applyNotebookOperation(
        book,
        operation,
        { now: now(), ...(newId ? { newId } : {}) },
      );
      const data = notebookStoredRecord.parse({
        kind: "household-notebook",
        notebook: next,
      });
      try {
        if (revision === null) await store.create(recordId, data);
        else await store.edit(recordId, data, revision);
        return { status: "applied", result, notebook: next };
      } catch (error) {
        if (error instanceof VaultConflictError) continue; // someone else won; re-read and re-apply the intent
        // Lost acknowledgement? Our commitId is the receipt: readback decides.
        try {
          const after = await load();
          if (after.book.commitId === next.commitId)
            return {
              status: "applied",
              result,
              notebook: after.book,
              reconciled: true,
            };
          // A concurrent create can also surface here as a non-conflict error.
          if (revision === null && after.revision !== null) continue;
          return { status: "failed", code: "WRITE_FAILED" };
        } catch {
          return {
            status: "unknown",
            code: "WRITE_UNKNOWN",
            next: "read-before-retry",
          };
        }
      }
    }
    return { status: "failed", code: "BUSY" };
  }

  const fail = (error) => {
    if (error instanceof NotebookError)
      return { status: "failed", code: error.code, detail: error.detail };
    return { status: "failed", code: "READ_FAILED" };
  };

  function run(operation, claimedHouseholdId = householdId) {
    const job = tail.then(async () => {
      if (!(await gate(claimedHouseholdId)))
        return { status: "denied", code: "DENIED" };
      try {
        const outcome = await mutate(operation);
        if (outcome.status === "applied")
          for (const listener of listeners) {
            try {
              listener(outcome.notebook);
            } catch {
              /* a view must not break a commit */
            }
          }
        return outcome;
      } catch (error) {
        return fail(error);
      }
    });
    tail = job.catch(() => {});
    return job;
  }

  async function read(claimedHouseholdId = householdId) {
    if (!(await gate(claimedHouseholdId)))
      return { status: "denied", code: "DENIED" };
    try {
      return { status: "read", notebook: (await load()).book };
    } catch (error) {
      return fail(error);
    }
  }

  async function readList(
    reference,
    filter = "all",
    claimedHouseholdId = householdId,
  ) {
    const snapshot = await read(claimedHouseholdId);
    if (snapshot.status !== "read") return snapshot;
    try {
      return {
        status: "read",
        view: viewList(snapshot.notebook, reference, filter),
      };
    } catch (error) {
      return fail(error);
    }
  }

  return Object.freeze({
    run,
    read,
    readList,
    /** Called only after a durable commit, so the UI never shows unsaved state. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    schema: notebookSchema,
  });
}
