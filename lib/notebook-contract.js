import { z } from "zod";

// One notebook engine for every kind of list. A list's `type` is metadata only;
// groceries, chores, movies and anything new share these exact transitions.
export const NOTEBOOK_VERSION = 1;
export const MAX_NOTEBOOK_LISTS = 50;
export const MAX_NOTEBOOK_ITEMS = 200;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const text = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => value.isWellFormed());
const stamp = z.string().datetime();

export const notebookItem = z
  .object({
    id,
    text: text(160),
    quantity: z.number().finite().positive().max(1_000_000).optional(),
    unit: text(40).optional(),
    notes: z
      .string()
      .max(500)
      .refine((value) => value.isWellFormed())
      .optional(),
    completed: z.boolean(),
    position: z.number().int().min(0).max(MAX_NOTEBOOK_ITEMS),
    createdAt: stamp,
    updatedAt: stamp,
  })
  .strict();

export const notebookList = z
  .object({
    id,
    name: text(80),
    description: text(240).optional(),
    type: text(40).optional(),
    createdAt: stamp,
    updatedAt: stamp,
    items: z.array(notebookItem).max(MAX_NOTEBOOK_ITEMS),
  })
  .strict();

export const notebook = z
  .object({
    version: z.literal(NOTEBOOK_VERSION),
    householdId: id,
    // Fresh on every commit so a lost acknowledgement can be reconciled by readback.
    commitId: z.string().uuid(),
    lists: z.array(notebookList).max(MAX_NOTEBOOK_LISTS),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.lists.map((list) => list.id)).size === value.lists.length,
    { message: "List identifiers must be unique." },
  );

export const emptyNotebook = (householdId) =>
  notebook.parse({
    version: NOTEBOOK_VERSION,
    householdId,
    commitId: crypto.randomUUID(),
    lists: [],
  });

export class NotebookError extends Error {
  constructor(code, detail = {}) {
    super(`Notebook operation failed: ${code}`);
    this.code = code;
    this.detail = detail;
  }
}

// ---- Matching -------------------------------------------------------------

const FILLER = new Set([
  "my",
  "the",
  "a",
  "an",
  "our",
  "list",
  "lists",
  "of",
  "to",
  "for",
  "on",
]);
export const normalize = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
// Canonical comparison form only (never displayed): groceries/grocery, movies/movie.
const stem = (word) => {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("ie")) w = w.slice(0, -2) + "y";
  return w;
};
const tokens = (value) => normalize(value).split(" ").filter(Boolean).map(stem);
const significant = (value) =>
  tokens(value).filter((token) => !FILLER.has(token));

/**
 * Resolve a spoken list reference. Never guesses between several candidates.
 * @returns {{status:'found',list:object}|{status:'ambiguous',candidates:object[]}|{status:'none'}}
 */
export function resolveList(book, reference) {
  const direct = book.lists.find((list) => list.id === reference);
  if (direct) return { status: "found", list: direct };
  const wanted = significant(reference);
  if (wanted.length === 0) {
    const literal = book.lists.filter(
      (list) => normalize(list.name) === normalize(reference),
    );
    return literal.length === 1
      ? { status: "found", list: literal[0] }
      : { status: "none" };
  }
  const exact = book.lists.filter(
    (list) =>
      normalize(list.name) === normalize(reference) ||
      significant(list.name).join(" ") === wanted.join(" "),
  );
  if (exact.length === 1) return { status: "found", list: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact };
  const partial = book.lists.filter((list) => {
    const have = new Set([
      ...significant(list.name),
      ...(list.type ? significant(list.type) : []),
    ]);
    return wanted.every((token) => have.has(token));
  });
  if (partial.length === 1) return { status: "found", list: partial[0] };
  if (partial.length > 1) return { status: "ambiguous", candidates: partial };
  return { status: "none" };
}

function resolveItem(list, reference, { completed } = {}) {
  const pool = list.items.filter(
    (item) => completed === undefined || item.completed === completed,
  );
  const byId = pool.find((item) => item.id === reference);
  if (byId) return byId;
  const key = normalize(reference);
  const exact = pool.filter((item) => normalize(item.text) === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1)
    throw new NotebookError("AMBIGUOUS_ITEM", {
      candidates: exact.map((item) => item.text),
    });
  const wanted = tokens(reference);
  const partial = pool.filter((item) => {
    const have = new Set(tokens(item.text));
    return wanted.length > 0 && wanted.every((token) => have.has(token));
  });
  if (partial.length === 1) return partial[0];
  if (partial.length > 1)
    throw new NotebookError("AMBIGUOUS_ITEM", {
      candidates: partial.map((item) => item.text),
    });
  throw new NotebookError("ITEM_NOT_FOUND", { reference });
}

function listOrThrow(book, reference) {
  const found = resolveList(book, reference);
  if (found.status === "found") return found.list;
  if (found.status === "ambiguous")
    throw new NotebookError("AMBIGUOUS_LIST", {
      candidates: found.candidates.map((list) => list.name),
    });
  throw new NotebookError("LIST_NOT_FOUND", { reference });
}

// ---- Operations -----------------------------------------------------------

const itemInput = z
  .object({
    text: text(160),
    quantity: z.number().finite().positive().max(1_000_000).optional(),
    unit: text(40).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();
const ref = z.string().trim().min(1).max(160);
const listRef = ref;

export const notebookOperation = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("create_list"),
      name: text(80),
      type: text(40).optional(),
      description: text(240).optional(),
    })
    .strict(),
  z
    .object({ op: z.literal("rename_list"), list: listRef, name: text(80) })
    .strict(),
  z
    .object({
      op: z.literal("delete_list"),
      list: listRef,
      confirmed: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      op: z.literal("clear_list"),
      list: listRef,
      scope: z.enum(["all", "completed"]).default("all"),
      confirmed: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      op: z.literal("add_items"),
      list: listRef,
      items: z.array(itemInput).min(1).max(50),
      allowDuplicate: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      op: z.literal("edit_item"),
      list: listRef,
      item: ref,
      patch: z
        .object({
          text: text(160).optional(),
          quantity: z
            .number()
            .finite()
            .positive()
            .max(1_000_000)
            .nullable()
            .optional(),
          unit: text(40).nullable().optional(),
          notes: z.string().max(500).nullable().optional(),
        })
        .strict()
        .refine((value) => Object.keys(value).length > 0),
    })
    .strict(),
  z
    .object({
      op: z.literal("complete_item"),
      list: listRef,
      item: ref,
      completed: z.boolean().default(true),
    })
    .strict(),
  z.object({ op: z.literal("remove_item"), list: listRef, item: ref }).strict(),
  z
    .object({
      op: z.literal("move_item"),
      from: listRef,
      to: listRef,
      item: ref,
    })
    .strict(),
  z
    .object({
      op: z.literal("reorder_item"),
      list: listRef,
      item: ref,
      position: z.number().int().min(0).max(MAX_NOTEBOOK_ITEMS),
    })
    .strict(),
]);

export const READ_ONLY_VIEWS = Object.freeze(["lists", "list"]);

const touch = (list, now) => {
  list.updatedAt = now;
};
const renumber = (list) =>
  list.items.forEach((item, index) => {
    item.position = index;
  });
const clean = (object) =>
  Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );

/**
 * Pure transition. Returns a validated candidate plus a factual result. A
 * candidate is not evidence of persistence; only the store commit is.
 * @returns {{notebook:object,result:object}}
 */
export function applyNotebookOperation(
  current,
  rawOperation,
  {
    now = new Date().toISOString(),
    newId = () => crypto.randomUUID(),
    newCommitId = () => crypto.randomUUID(),
  } = {},
) {
  const parsed = notebookOperation.safeParse(rawOperation);
  if (!parsed.success) throw new NotebookError("INVALID");
  const operation = parsed.data;
  const stored = notebook.safeParse(current);
  if (!stored.success) throw new NotebookError("READ_FAILED");
  const book = stored.data; // deep copy
  let result;

  switch (operation.op) {
    case "create_list": {
      if (book.lists.length >= MAX_NOTEBOOK_LISTS)
        throw new NotebookError("LIMIT");
      const clash = book.lists.find(
        (list) => normalize(list.name) === normalize(operation.name),
      );
      if (clash)
        throw new NotebookError("DUPLICATE_LIST", { name: clash.name });
      const list = {
        id: `list-${newId()}`.slice(0, 80),
        name: operation.name,
        ...clean({ type: operation.type, description: operation.description }),
        createdAt: now,
        updatedAt: now,
        items: [],
      };
      book.lists.push(list);
      result = { listId: list.id, listName: list.name };
      break;
    }
    case "rename_list": {
      const list = listOrThrow(book, operation.list);
      const clash = book.lists.find(
        (other) =>
          other.id !== list.id &&
          normalize(other.name) === normalize(operation.name),
      );
      if (clash)
        throw new NotebookError("DUPLICATE_LIST", { name: clash.name });
      result = {
        listId: list.id,
        previousName: list.name,
        listName: operation.name,
      };
      list.name = operation.name;
      touch(list, now);
      break;
    }
    case "delete_list": {
      const list = listOrThrow(book, operation.list);
      if (!operation.confirmed)
        throw new NotebookError("CONFIRMATION_REQUIRED", {
          action: "delete_list",
          list: list.name,
          count: list.items.length,
        });
      book.lists.splice(book.lists.indexOf(list), 1);
      result = {
        listId: list.id,
        listName: list.name,
        removed: list.items.length,
      };
      break;
    }
    case "clear_list": {
      const list = listOrThrow(book, operation.list);
      const doomed = list.items.filter(
        (item) => operation.scope === "all" || item.completed,
      );
      if (!operation.confirmed)
        throw new NotebookError("CONFIRMATION_REQUIRED", {
          action: "clear_list",
          list: list.name,
          count: doomed.length,
        });
      list.items = list.items.filter((item) => !doomed.includes(item));
      renumber(list);
      touch(list, now);
      result = { listId: list.id, listName: list.name, removed: doomed.length };
      break;
    }
    case "add_items": {
      const list = listOrThrow(book, operation.list);
      const added = [];
      const skipped = [];
      for (const input of operation.items) {
        const key = normalize(input.text);
        // Only an *active* identical item counts as a duplicate; finished items
        // and deliberate repeats ("another milk") are legitimate.
        if (
          !operation.allowDuplicate &&
          list.items.some(
            (item) => !item.completed && normalize(item.text) === key,
          )
        ) {
          skipped.push(input.text);
          continue;
        }
        if (list.items.length >= MAX_NOTEBOOK_ITEMS)
          throw new NotebookError("LIMIT");
        const item = {
          id: `item-${newId()}`.slice(0, 80),
          ...clean(input),
          completed: false,
          position: list.items.length,
          createdAt: now,
          updatedAt: now,
        };
        list.items.push(item);
        added.push(item.text);
      }
      if (added.length > 0) touch(list, now);
      result = { listId: list.id, listName: list.name, added, skipped };
      break;
    }
    case "edit_item": {
      const list = listOrThrow(book, operation.list);
      const item = resolveItem(list, operation.item);
      for (const [key, value] of Object.entries(operation.patch)) {
        if (value === null) delete item[key];
        else item[key] = value;
      }
      item.updatedAt = now;
      touch(list, now);
      result = { listId: list.id, listName: list.name, item: item.text };
      break;
    }
    case "complete_item": {
      const list = listOrThrow(book, operation.list);
      const item = resolveItem(list, operation.item, {
        completed: !operation.completed,
      });
      item.completed = operation.completed;
      item.updatedAt = now;
      touch(list, now);
      result = {
        listId: list.id,
        listName: list.name,
        item: item.text,
        completed: operation.completed,
      };
      break;
    }
    case "remove_item": {
      const list = listOrThrow(book, operation.list);
      const item = resolveItem(list, operation.item);
      list.items.splice(list.items.indexOf(item), 1);
      renumber(list);
      touch(list, now);
      result = { listId: list.id, listName: list.name, item: item.text };
      break;
    }
    case "move_item": {
      const from = listOrThrow(book, operation.from);
      const to = listOrThrow(book, operation.to);
      if (from.id === to.id) throw new NotebookError("INVALID");
      const item = resolveItem(from, operation.item);
      if (to.items.length >= MAX_NOTEBOOK_ITEMS)
        throw new NotebookError("LIMIT");
      if (
        to.items.some(
          (other) =>
            !other.completed && normalize(other.text) === normalize(item.text),
        )
      ) {
        throw new NotebookError("DUPLICATE_ITEM", {
          item: item.text,
          list: to.name,
        });
      }
      from.items.splice(from.items.indexOf(item), 1);
      renumber(from);
      touch(from, now);
      item.position = to.items.length;
      item.updatedAt = now;
      to.items.push(item);
      touch(to, now);
      result = {
        fromId: from.id,
        fromName: from.name,
        listId: to.id,
        listName: to.name,
        item: item.text,
      };
      break;
    }
    case "reorder_item": {
      const list = listOrThrow(book, operation.list);
      const item = resolveItem(list, operation.item);
      list.items.splice(list.items.indexOf(item), 1);
      list.items.splice(
        Math.min(operation.position, list.items.length),
        0,
        item,
      );
      renumber(list);
      touch(list, now);
      result = {
        listId: list.id,
        listName: list.name,
        item: item.text,
        position: item.position,
      };
      break;
    }
  }

  const candidate = notebook.safeParse({ ...book, commitId: newCommitId() });
  if (!candidate.success) throw new NotebookError("INVALID");
  return { notebook: candidate.data, result: { op: operation.op, ...result } };
}

/** Read-only projection. `filter`: 'active' | 'completed' | 'all'. */
export function viewList(book, reference, filter = "all") {
  const list = listOrThrow(book, reference);
  const items = list.items
    .filter(
      (item) => filter === "all" || (filter === "completed") === item.completed,
    )
    .sort((a, b) => a.position - b.position);
  return { listId: list.id, listName: list.name, type: list.type, items };
}
