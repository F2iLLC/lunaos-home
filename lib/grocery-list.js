import { groceryCommand, groceryList, groceryRevision, GroceryConflictError } from './grocery-contract.js';

function fail(code) {
  const error = new Error('The grocery change could not be prepared.');
  error.code = code;
  throw error;
}

// Pure transition, shared by future storage adapters. The caller must authorize
// first, then read and commit under its atomic revision boundary. Returning a
// candidate is NOT evidence that anything has been saved.
export function applyGroceryMutation(current, input, actor, nextRevision = crypto.randomUUID()) {
  const parsed = groceryCommand.safeParse(input);
  if (!parsed.success || parsed.data.action === 'query') fail('INVALID');
  const command = parsed.data;
  const stored = groceryList.safeParse(current);
  if (!stored.success) fail('READ_FAILED');
  const list = stored.data; // Zod returns a deep copy; never mutate caller state.
  if (list.id !== command.listId || list.householdId !== command.householdId) fail('NOT_FOUND');
  if (list.revision !== command.expectedRevision) throw new GroceryConflictError();
  if (!groceryRevision.safeParse(nextRevision).success || nextRevision === list.revision) fail('INVALID');

  const index = list.items.findIndex(item => item.id === (command.action === 'add' ? command.item.id : command.itemId));
  if (command.action === 'add') {
    if (index !== -1) throw new GroceryConflictError();
    if (list.items.length === 500) fail('BUSY');
    list.items.push(command.item);
  } else {
    if (index === -1) fail('NOT_FOUND');
    if (command.action === 'remove') list.items.splice(index, 1);
    else if (command.action === 'edit') {
      for (const [key, value] of Object.entries(command.patch)) {
        // Null clears optional fields; undefined is invalid in this transition.
        if (value === undefined) fail('INVALID');
        if (value === null) delete list.items[index][key];
        else list.items[index][key] = value;
      }
    } else list.items[index].completed = command.action === 'check';
  }

  const candidate = groceryList.safeParse({ ...list, revision: nextRevision, updatedBy: actor });
  if (!candidate.success) fail('INVALID');
  return candidate.data;
}
