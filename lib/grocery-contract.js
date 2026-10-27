import { z } from 'zod';

// Home-owned command vocabulary. These identifiers select data; none confer
// authority. A transport must bind the command to a live Home session.
export const GROCERY_CONTRACT_VERSION = 1;
export const groceryId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const groceryRevision = z.string().uuid();
const requestId = z.string().uuid();
const label = z.string().trim().min(1).max(120).refine(value => value.isWellFormed());
const notes = z.string().max(1000).refine(value => value.isWellFormed());
const quantity = z.number().finite().positive().max(1_000_000);
const unit = z.string().trim().min(1).max(40).refine(value => value.isWellFormed());
const actor = z.object({ kind: z.enum(['human', 'assistant']), id: groceryId }).strict();

export const groceryItem = z.object({
  id: groceryId,
  label,
  quantity: quantity.optional(),
  unit: unit.optional(),
  notes: notes.optional(),
  completed: z.boolean(),
}).strict();

export const groceryList = z.object({
  id: groceryId,
  householdId: groceryId,
  label,
  items: z.array(groceryItem).max(500),
  revision: groceryRevision,
  updatedBy: actor,
}).strict().refine(value => new Set(value.items.map(item => item.id)).size === value.items.length,
  { message: 'Item identifiers must be unique within a list.' });

const base = { version: z.literal(GROCERY_CONTRACT_VERSION), requestId, householdId: groceryId, listId: groceryId };
const target = { expectedRevision: groceryRevision };
const itemFields = {
  label: label.optional(),
  quantity: quantity.nullable().optional(),
  unit: unit.nullable().optional(),
  notes: notes.nullable().optional(),
};
const patch = z.object(itemFields).strict().refine(value => Object.keys(value).length > 0,
  { message: 'An edit must change at least one item field.' });

export const groceryCommand = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('add'), ...target, item: groceryItem.omit({ completed: true }).extend({ completed: z.boolean().default(false) }) }).strict(),
  z.object({ ...base, action: z.literal('edit'), ...target, itemId: groceryId, patch }).strict(),
  z.object({ ...base, action: z.literal('check'), ...target, itemId: groceryId }).strict(),
  z.object({ ...base, action: z.literal('uncheck'), ...target, itemId: groceryId }).strict(),
  z.object({ ...base, action: z.literal('remove'), ...target, itemId: groceryId }).strict(),
  z.object({ ...base, action: z.literal('query'), itemId: groceryId.optional() }).strict(),
]);

export const groceryReceipt = z.discriminatedUnion('status', [
  z.object({ version: z.literal(GROCERY_CONTRACT_VERSION), status: z.literal('applied'), requestId, listId: groceryId, revision: groceryRevision, actor }).strict(),
  z.object({ version: z.literal(GROCERY_CONTRACT_VERSION), status: z.literal('queried'), requestId, list: groceryList, actor }).strict(),
  z.object({ version: z.literal(GROCERY_CONTRACT_VERSION), status: z.literal('denied'), requestId: requestId.nullable(), code: z.enum(['INVALID', 'DENIED', 'DISCLOSURE_REQUIRED', 'NOT_FOUND', 'BUSY', 'READ_FAILED']) }).strict(),
  z.object({ version: z.literal(GROCERY_CONTRACT_VERSION), status: z.literal('conflict'), requestId, listId: groceryId, expectedRevision: groceryRevision.nullable(), code: z.enum(['CONFLICT', 'REQUEST_ID_REUSED']) }).strict(),
  z.object({ version: z.literal(GROCERY_CONTRACT_VERSION), status: z.literal('unknown'), requestId, listId: groceryId, code: z.literal('WRITE_UNKNOWN'), next: z.literal('read-before-retry') }).strict(),
]);

export class GroceryConflictError extends Error {
  constructor() { super('The grocery list changed. Read it again before making another change.'); this.code = 'CONFLICT'; }
}

export function grocerySessionRequirement(command) {
  const parsed = groceryCommand.parse(command);
  return Object.freeze({
    action: parsed.action === 'query' ? 'read' : 'edit',
    recordId: parsed.listId,
    expectedRevision: parsed.action === 'query' ? undefined : parsed.expectedRevision,
    householdId: parsed.householdId,
  });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const denied = (code, id = null) => groceryReceipt.parse({ version: 1, status: 'denied', requestId: id, code });

// withSessionAuthority must keep its approved Home session active for the whole
// callback, rechecking grant/session state at execution time. This port cannot
// mint grants, authenticate devices, or provide durable idempotency by itself.
export function createGroceryCommandService({ withSessionAuthority, execute, maxRequestIds = 4096 }) {
  if (typeof withSessionAuthority !== 'function' || typeof execute !== 'function') throw new TypeError('Session authority and command executor are required.');
  if (!Number.isInteger(maxRequestIds) || maxRequestIds < 1) throw new TypeError('maxRequestIds must be a positive integer.');
  const requests = new Map();

  async function run(raw) {
    const parsed = groceryCommand.safeParse(raw);
    if (!parsed.success) return denied('INVALID', requestId.safeParse(raw?.requestId).success ? raw.requestId : null);
    const command = parsed.data;
    const requirement = grocerySessionRequirement(command);

    try {
      return await withSessionAuthority(requirement, async context => {
        const actorResult = actor.safeParse(context?.actor);
        if (!actorResult.success || context.householdId !== command.householdId || context.listId !== command.listId) return denied('DENIED', command.requestId);
        const isAssistant = actorResult.data.kind === 'assistant';
        if ((context.assistant !== undefined && typeof context.assistant !== 'boolean') ||
          (context.selectedContentDisclosed !== undefined && typeof context.selectedContentDisclosed !== 'boolean') ||
          (typeof context.assistant === 'boolean' && context.assistant !== isAssistant) ||
          (context.selectedContentDisclosed === true && !isAssistant)) return denied('DENIED', command.requestId);
        if (command.action === 'query' && isAssistant && context.selectedContentDisclosed !== true) return denied('DISCLOSURE_REQUIRED', command.requestId);

        const fingerprint = canonical(command);
        const prior = requests.get(command.requestId);
        if (prior) {
          if (prior.fingerprint !== fingerprint) {
            return groceryReceipt.parse({ version: 1, status: 'conflict', requestId: command.requestId, listId: command.listId,
              expectedRevision: command.action === 'query' ? null : command.expectedRevision,
              code: 'REQUEST_ID_REUSED' });
          }
          return prior.promise;
        }
        if (requests.size >= maxRequestIds) return denied('BUSY', command.requestId);

        const promise = (async () => {
          try {
            const result = await execute(command, Object.freeze({ ...context, actor: actorResult.data }));
            if (command.action === 'query') {
              const list = groceryList.parse(result);
              if (list.id !== command.listId || list.householdId !== command.householdId ||
                (command.itemId && !list.items.some(item => item.id === command.itemId))) return denied('NOT_FOUND', command.requestId);
              const selected = command.itemId ? { ...list, items: list.items.filter(item => item.id === command.itemId) } : list;
              return groceryReceipt.parse({ version: 1, status: 'queried', requestId: command.requestId, list: selected, actor: actorResult.data });
            }
            const revision = groceryRevision.parse(result?.revision);
            return groceryReceipt.parse({ version: 1, status: 'applied', requestId: command.requestId,
              listId: command.listId, revision, actor: actorResult.data });
          } catch (error) {
            if (error?.code === 'CONFLICT') return groceryReceipt.parse({ version: 1, status: 'conflict', requestId: command.requestId,
              listId: command.listId, expectedRevision: command.expectedRevision, code: 'CONFLICT' });
            if (error?.code && ['DENIED', 'DISCLOSURE_REQUIRED', 'INVALID', 'NOT_FOUND', 'BUSY', 'READ_FAILED'].includes(error.code)) return denied(error.code, command.requestId);
            if (command.action === 'query') return denied('READ_FAILED', command.requestId);
            return groceryReceipt.parse({ version: 1, status: 'unknown', requestId: command.requestId, listId: command.listId,
              code: 'WRITE_UNKNOWN', next: 'read-before-retry' });
          }
        })();
        requests.set(command.requestId, { fingerprint, promise });
        return promise;
      });
    } catch (error) {
      if (error?.code === 'CONFLICT' && command.action !== 'query') return groceryReceipt.parse({
        version: 1, status: 'conflict', requestId: command.requestId, listId: command.listId,
        expectedRevision: command.expectedRevision, code: 'CONFLICT',
      });
      if (error?.code === 'WRITE_UNKNOWN' && command.action !== 'query') return groceryReceipt.parse({
        version: 1, status: 'unknown', requestId: command.requestId, listId: command.listId,
        code: 'WRITE_UNKNOWN', next: 'read-before-retry',
      });
      if (['DENIED', 'DISCLOSURE_REQUIRED', 'INVALID', 'NOT_FOUND', 'BUSY', 'READ_FAILED'].includes(error?.code)) return denied(error.code, command.requestId);
      return denied('DENIED', command.requestId);
    }
  }

  return Object.freeze({ execute: run, get requestCount() { return requests.size; } });
}
