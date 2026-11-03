import { z } from 'zod';
import { groceryCommand, groceryCommandFingerprint, groceryList, groceryReceipt, GroceryConflictError } from './grocery-contract.js';
import { applyGroceryMutation } from './grocery-list.js';
import { groceryStoredRecord, versionedVaultRecord, VaultConflictError } from './vault-record-contract.js';

const fail = code => {
  const error = new Error('The grocery list could not be read or saved.');
  error.code = code;
  throw error;
};

function record(value, listId, householdId) {
  let stored;
  try { stored = groceryStoredRecord.parse(versionedVaultRecord.parse(value).data); }
  catch { fail('READ_FAILED'); }
  if (stored.list.id !== listId || stored.list.householdId !== householdId) fail('NOT_FOUND');
  return stored;
}

function matchingOutcome(stored, command, actor, fingerprint) {
  const prior = stored.outcomes.find(outcome => outcome.requestId === command.requestId);
  if (!prior) return null;
  if (prior.fingerprint !== fingerprint || prior.receipt.actor.kind !== actor.kind || prior.receipt.actor.id !== actor.id) {
    return groceryReceipt.parse({ version: 1, status: 'conflict', requestId: command.requestId,
      listId: command.listId, expectedRevision: command.expectedRevision, code: 'REQUEST_ID_REUSED' });
  }
  return prior.receipt;
}

// Uses the same versioned encrypted store and its per-record compare-and-swap
// boundary. The list and successful mutation receipt are one payload and one
// commit, so reopening the store can reconcile a repeated request ID.
export function createGroceryPersistence({ store, newRevision = () => crypto.randomUUID(), maxOutcomes = 512 } = {}) {
  if (!store || store.contractVersion !== 2 || !['read', 'create', 'edit'].every(key => typeof store[key] === 'function')) {
    throw new TypeError('A versioned encrypted-store adapter is required.');
  }
  if (!Number.isInteger(maxOutcomes) || maxOutcomes < 1 || maxOutcomes > 512) throw new TypeError('maxOutcomes must be between 1 and 512.');

  async function createList(input) {
    const list = groceryList.parse(input);
    const data = groceryStoredRecord.parse({ kind: 'grocery-list', list, outcomes: [] });
    return store.create(list.id, data);
  }

  async function execute(input, context) {
    const command = groceryCommand.parse(input);
    if (command.action === 'query') {
      let current;
      try { current = await store.read(command.listId); } catch { fail('READ_FAILED'); }
      if (current == null) fail('NOT_FOUND');
      return record(current, command.listId, command.householdId).list;
    }

    const actor = z.object({ kind: z.enum(['human', 'assistant']), id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/) }).strict().parse(context?.actor);
    const fingerprint = groceryCommandFingerprint(command);
    let current;
    try { current = await store.read(command.listId); } catch { fail('READ_FAILED'); }
    if (current == null) fail('NOT_FOUND');
    const stored = record(current, command.listId, command.householdId);
    const prior = matchingOutcome(stored, command, actor, fingerprint);
    if (prior) return prior;
    if (stored.list.revision !== command.expectedRevision) throw new GroceryConflictError();
    if (stored.outcomes.length >= maxOutcomes) fail('BUSY');

    // The shared pure transition prepares a candidate; only the encrypted
    // compare-and-swap below makes it durable.
    const updated = applyGroceryMutation(stored.list, command, actor, newRevision());
    const receipt = groceryReceipt.parse({ version: 1, status: 'applied', requestId: command.requestId,
      listId: command.listId, revision: updated.revision, actor });
    const nextData = groceryStoredRecord.parse({ kind: 'grocery-list', list: updated,
      outcomes: [...stored.outcomes, { requestId: command.requestId, fingerprint, receipt }] });

    try {
      await store.edit(command.listId, nextData, current.revision);
      return receipt;
    } catch (error) {
      // A lost acknowledgement can still be resolved by reading the atomic
      // payload. Never issue a second mutation from this path.
      let after;
      try { after = await store.read(command.listId); } catch { throw error; }
      if (after != null) {
        const latest = record(after, command.listId, command.householdId);
        const committed = matchingOutcome(latest, command, actor, fingerprint);
        if (committed) return committed;
      }
      if (error instanceof VaultConflictError) throw new GroceryConflictError();
      throw error;
    }
  }

  return Object.freeze({ createList, execute });
}
