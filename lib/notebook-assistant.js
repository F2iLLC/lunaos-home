import { resolveList } from "./notebook-contract.js";
import { avatarForOutcome } from "./notebook-avatar.js";

// ---- Utterance parsing (pure, no I/O) -------------------------------------

const NUMBER_WORDS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  dozen: 12,
};
const UNIT =
  /^(gallons?|pounds?|lbs?|ounces?|oz|dozen|cartons?|boxes|box|bags?|cans?|bottles?|loaf|loaves|jars?|packs?|packages?|liters?|cups?|bunch(?:es)?)$/i;
// Targets that belong to other Luna features; never treat them as lists.
const NOT_LISTS =
  /^(?:the |my )?(?:timer|timers|alarm|alarms|calendar|reminder|reminders|schedule|volume|music)$/i;

const strip = (value) =>
  value
    .trim()
    .replace(/^(?:my|the|our)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
const cap = (value) => value.charAt(0).toUpperCase() + value.slice(1);

export function splitItems(phrase) {
  return phrase
    .replace(/[.!?]+$/, "")
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [first, second, ...rest] = part.split(/\s+/);
      const lower = first.toLowerCase();
      const numeric = /^\d+(?:\.\d+)?$/.test(first)
        ? Number(first)
        : NUMBER_WORDS[lower];
      if (numeric !== undefined && second) {
        if (UNIT.test(second) && rest.length > 0) {
          const body = rest[0].toLowerCase() === "of" ? rest.slice(1) : rest;
          if (body.length > 0)
            return {
              text: cap(body.join(" ")),
              quantity: numeric,
              unit: second.toLowerCase(),
            };
        }
        // "2 apples" keeps the count; "a/an" before a plain noun is just an article.
        if (!["a", "an"].includes(lower)) {
          if (second.toLowerCase() === "dozen" || UNIT.test(second))
            return { text: cap(part) };
          return { text: cap([second, ...rest].join(" ")), quantity: numeric };
        }
        return { text: cap([second, ...rest].join(" ")) };
      }
      return { text: cap(part) };
    });
}

const WAKE = /^(?:(?:hey|ok|okay)[,\s]+)?luna[,.!\s]*/i;

/**
 * @returns {null | {action:string, [key:string]:unknown}} null means "not a notebook request".
 */
export function parseUtterance(raw) {
  let t = String(raw ?? "")
    .replace(WAKE, "")
    .trim()
    .replace(/^(?:please|actually|um|uh|and|also)[,\s]+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  if (!t) return null;
  let m;

  if (/^(?:yes|yeah|yep|yup|sure|confirm(?:ed)?|do it|go ahead)$/i.test(t))
    return { action: "yes" };
  if (/^(?:no|nope|cancel|never ?mind|don'?t|stop|keep it)$/i.test(t))
    return { action: "no" };
  if (
    /^(?:what|which) lists do i have$|^(?:show|read|tell) (?:me )?(?:all )?(?:of )?my lists$|^what'?s in my notebook$/i.test(
      t,
    )
  )
    return { action: "lists" };

  if (
    (m = t.match(
      /^(?:create|make|start|set up|begin|new)\s+(?:me\s+)?(?:a\s+|an\s+|my\s+|the\s+)?(?:new\s+)?(?:list|notebook)\s+(?:of|for|called|named|about)\s+(.+)$/i,
    ))
  ) {
    return { action: "create", name: cap(m[1].trim()) };
  }
  if (
    (m = t.match(
      /^(?:create|make|start|set up|begin)\s+(?:me\s+)?(?:a\s+|an\s+|my\s+|the\s+)?(?:new\s+)?(.+?\s+list)$/i,
    )) &&
    !/\s(?:from|to)\s/i.test(m[1])
  ) {
    return { action: "create", name: cap(m[1].trim()) };
  }

  if ((m = t.match(/^rename\s+(.+?)\s+(?:to|as)\s+(.+)$/i)))
    return { action: "rename", list: strip(m[1]), name: cap(m[2].trim()) };
  if ((m = t.match(/^move\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+)$/i)))
    return {
      action: "move",
      item: strip(m[1]),
      from: strip(m[2]),
      to: strip(m[3]),
    };
  if (
    (m = t.match(
      /^(?:clear|empty|wipe)\s+(?:out\s+)?(?:all\s+)?(?:the\s+)?(completed|finished|done)\s+(?:items\s+)?(?:from|on|off)\s+(.+)$/i,
    ))
  )
    return { action: "clear", scope: "completed", list: strip(m[2]) };
  if ((m = t.match(/^(?:clear|empty|wipe)\s+(?:out\s+)?(.+)$/i)))
    return { action: "clear", scope: "all", list: strip(m[1]) };

  if (
    !/\s(?:from|off)\s/i.test(t) &&
    (m = t.match(
      /^(?:delete|remove|get rid of|throw away)\s+(.+?\s+(?:list|notebook))$/i,
    ))
  )
    return { action: "delete", list: strip(m[1]) };

  if (
    (m = t.match(
      /^(?:add|put|place)\s+(.+?)\s+(?:to|on|onto|into|in)\s+(.+)$/i,
    ))
  ) {
    const target = strip(m[2]);
    if (NOT_LISTS.test(target)) return null;
    return { action: "add", items: splitItems(m[1]), list: target };
  }
  if (
    (m = t.match(/^(?:add|put)\s+(.+?)(?:\s+(?:too|also|as well))?$/i)) &&
    !/\b(?:minutes?|seconds?|hours?)\b/i.test(m[1])
  ) {
    return { action: "add", items: splitItems(m[1]) };
  }

  if (
    (m = t.match(
      /^(?:mark|check)\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished|checked)(?:\s+(?:on|in|from)\s+(.+))?$/i,
    ))
  )
    return { action: "complete", item: strip(m[1]), list: m[2] && strip(m[2]) };
  if (
    (m = t.match(
      /^(?:check|cross|tick)\s+(.+?)\s+off(?:\s+(?:of\s+|from\s+|on\s+)?(.+))?$/i,
    )) ||
    (m = t.match(
      /^(?:check|cross|tick)\s+off\s+(.+?)(?:\s+(?:of|from|on)\s+(.+))?$/i,
    ))
  )
    return { action: "complete", item: strip(m[1]), list: m[2] && strip(m[2]) };
  if (
    (m = t.match(
      /^(?:un-?check|un-?mark|reopen)\s+(.+?)(?:\s+(?:on|in|from)\s+(.+))?$/i,
    ))
  )
    return {
      action: "uncomplete",
      item: strip(m[1]),
      list: m[2] && strip(m[2]),
    };

  if (
    (m = t.match(
      /^(?:remove|delete|take|drop|scratch)\s+(.+?)(?:\s+(?:from|off(?: of)?|on)\s+(.+))?$/i,
    ))
  ) {
    const target = m[2] && strip(m[2]);
    if (target && NOT_LISTS.test(target)) return null;
    return { action: "remove", item: strip(m[1]), list: target };
  }

  if (
    /^what(?:'s| is)? left$|^what do i have left$|^what(?:'s| is) still (?:on it|to do)$/i.test(
      t,
    )
  )
    return { action: "show", filter: "active" };
  if (
    /^what (?:have i|did i) (?:finish(?:ed)?|complete(?:d)?|do(?:ne)?)$/i.test(
      t,
    )
  )
    return { action: "show", filter: "completed" };
  if ((m = t.match(/^what(?:'s| is| are)\s+(?:left\s+)?(?:on|in)\s+(.+)$/i)))
    return { action: "show", list: strip(m[1]), filter: "active" };
  if (
    (m = t.match(
      /^(?:show|read|open|tell)\s+(?:me\s+)?(.+?\s+(?:list|notebook))$/i,
    ))
  )
    return { action: "show", list: strip(m[1]), filter: "active" };
  return null;
}

// ---- Dialog ---------------------------------------------------------------

const join = (names) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

export function createNotebookAssistant({
  service,
  now = () => Date.now(),
  contextTtlMs = 120_000,
  confirmTtlMs = 30_000,
} = {}) {
  if (!service) throw new TypeError("A notebook service is required.");
  let context = null; // { listId, name, at }
  let pending = null; // { kind, at, ... }
  const fresh = (entry, ttl) => entry && now() - entry.at <= ttl;

  const done = (reply, outcome, extra = {}) => ({
    handled: true,
    reply,
    status: outcome.status,
    avatar: avatarForOutcome(outcome),
    ...extra,
  });
  const ask = (reply, state) => {
    pending = { ...state, at: now() };
    return done(reply, { status: "clarify" }, { awaiting: state.kind });
  };
  const remember = (outcome) => {
    const r = outcome.result;
    if (outcome.status === "applied" && r.listId && r.op !== "delete_list")
      context = { listId: r.listId, name: r.listName, at: now() };
    if (outcome.status === "applied" && r.op === "delete_list") context = null;
  };

  async function target(listRef) {
    const snapshot = await service.read();
    if (snapshot.status !== "read") return { outcome: snapshot };
    const book = snapshot.notebook;
    if (listRef) {
      const found = resolveList(book, listRef);
      return { book, found };
    }
    if (fresh(context, contextTtlMs)) {
      const found = resolveList(book, context.listId);
      if (found.status === "found") return { book, found };
      context = null;
    }
    return { book, found: { status: "unspecified" } };
  }

  function failureReply(outcome) {
    if (outcome.status === "denied")
      return "I can't open that notebook from here.";
    if (outcome.status === "unknown")
      return "I couldn't confirm that was saved. Please check the list before trying again.";
    switch (outcome.code) {
      case "LIST_NOT_FOUND":
        return "I couldn't find that list.";
      case "ITEM_NOT_FOUND":
        return "I couldn't find that item on the list.";
      case "AMBIGUOUS_ITEM":
        return `Which one: ${join(outcome.detail.candidates)}?`;
      case "DUPLICATE_LIST":
        return `You already have a list called ${outcome.detail.name}.`;
      case "DUPLICATE_ITEM":
        return `${outcome.detail.item} is already on ${outcome.detail.list}.`;
      case "LIMIT":
        return "That list is full.";
      case "BUSY":
        return "The notebook is busy right now. Nothing was changed.";
      default:
        return "I couldn't save that, so nothing changed.";
    }
  }

  function successReply(outcome) {
    const r = outcome.result;
    switch (r.op) {
      case "create_list":
        return `I made your ${r.listName}${/list$/i.test(r.listName) ? "" : " list"}!`;
      case "add_items":
        if (r.added.length === 0)
          return `${join(r.skipped)} ${r.skipped.length === 1 ? "is" : "are"} already on ${r.listName}.`;
        return `Added ${r.added.length === 1 ? r.added[0] : r.added.length === 2 ? "both" : `${r.added.length} items`} to ${r.listName}!${r.skipped.length ? ` ${join(r.skipped)} ${r.skipped.length === 1 ? "was" : "were"} already there.` : ""}`;
      case "complete_item":
        return r.completed
          ? `Checked off ${r.item}.`
          : `Put ${r.item} back on ${r.listName}.`;
      case "remove_item":
        return `Removed ${r.item}.`;
      case "rename_list":
        return `Renamed ${r.previousName} to ${r.listName}.`;
      case "delete_list":
        return `Deleted ${r.listName}.`;
      case "clear_list":
        return `Cleared ${r.removed} ${r.removed === 1 ? "item" : "items"} from ${r.listName}.`;
      case "move_item":
        return `Moved ${r.item} from ${r.fromName} to ${r.listName}.`;
      default:
        return "Done.";
    }
  }

  async function execute(operation, label = null) {
    const outcome = await service.run(operation);
    if (outcome.status === "applied") {
      remember(outcome);
      return done(successReply(outcome), outcome, { result: outcome.result });
    }
    if (outcome.code === "CONFIRMATION_REQUIRED") {
      const { action, list, count } = outcome.detail;
      return ask(
        action === "delete_list"
          ? `Delete ${list}${count ? ` and its ${count} ${count === 1 ? "item" : "items"}` : ""}? Say yes to confirm.`
          : `Clear ${count} ${count === 1 ? "item" : "items"} from ${list}? Say yes to confirm.`,
        { kind: "confirm", operation: { ...operation, confirmed: true } },
      );
    }
    if (outcome.code === "AMBIGUOUS_LIST")
      return ask(`Which list: ${join(outcome.detail.candidates)}?`, {
        kind: "list",
        retry: operation,
        key: label,
      });
    return done(failureReply(outcome), outcome);
  }

  const build = (intent, list) => {
    switch (intent.action) {
      case "add":
        return { op: "add_items", list, items: intent.items };
      case "complete":
        return {
          op: "complete_item",
          list,
          item: intent.item,
          completed: true,
        };
      case "uncomplete":
        return {
          op: "complete_item",
          list,
          item: intent.item,
          completed: false,
        };
      case "remove":
        return { op: "remove_item", list, item: intent.item };
      default:
        return null;
    }
  };

  /** Handle one finalized utterance. `handled:false` means "not for the notebook". */
  async function handle(utterance) {
    const intent = parseUtterance(utterance);

    // A pending question only accepts its direct answer; anything else drops it.
    const waiting = fresh(
      pending,
      pending?.kind === "confirm" ? confirmTtlMs : contextTtlMs,
    )
      ? pending
      : null;
    pending = null;
    if (waiting?.kind === "confirm") {
      if (intent?.action === "yes") return execute(waiting.operation);
      if (intent?.action === "no")
        return done(
          "Okay, I left it alone.",
          { status: "read" },
          { cancelled: true },
        );
    }
    if (waiting?.kind === "list" && !intent?.action) {
      const answer = strip(String(utterance).replace(WAKE, ""));
      if (/^(?:cancel|never ?mind|no)$/i.test(answer))
        return done(
          "Okay, never mind.",
          { status: "read" },
          { cancelled: true },
        );
      // An answer that names no list is unrelated speech, not a reply.
      const snapshot = await service.read();
      if (
        snapshot.status === "read" &&
        resolveList(snapshot.notebook, answer).status === "none"
      ) {
        context = null;
        return { handled: false };
      }
      return waiting.retry.op
        ? execute({ ...waiting.retry, list: answer })
        : route({ ...waiting.retry, list: answer });
    }
    if (waiting?.kind === "list" && intent?.action === "no")
      return done("Okay, never mind.", { status: "read" }, { cancelled: true });
    if (!intent || intent.action === "yes" || intent.action === "no") {
      context = null;
      return { handled: false };
    }
    return route(intent);
  }

  async function route(intent) {
    if (intent.action === "lists") {
      const snapshot = await service.read();
      if (snapshot.status !== "read")
        return done(failureReply(snapshot), snapshot);
      const names = snapshot.notebook.lists.map((list) => list.name);
      return done(
        names.length
          ? `You have ${names.length} ${names.length === 1 ? "list" : "lists"}: ${join(names)}.`
          : "You don't have any lists yet.",
        { status: "read" },
        { lists: names },
      );
    }
    if (intent.action === "create")
      return execute({ op: "create_list", name: intent.name });
    if (intent.action === "rename")
      return execute({
        op: "rename_list",
        list: intent.list,
        name: intent.name,
      });
    if (intent.action === "delete")
      return execute({ op: "delete_list", list: intent.list });
    if (intent.action === "clear")
      return execute({
        op: "clear_list",
        list: intent.list,
        scope: intent.scope,
      });
    if (intent.action === "move")
      return execute({
        op: "move_item",
        from: intent.from,
        to: intent.to,
        item: intent.item,
      });

    // Everything below needs exactly one resolved target list.
    const { found, outcome } = await target(intent.list);
    if (outcome) return done(failureReply(outcome), outcome);
    if (found.status === "ambiguous") {
      return ask(
        `Which list: ${join(found.candidates.map((list) => list.name))}?`,
        { kind: "list", retry: intent },
      );
    }
    if (found.status === "unspecified") {
      return ask("Which list do you mean?", { kind: "list", retry: intent });
    }
    if (found.status === "none") {
      return done(`I couldn't find a list called ${intent.list}.`, {
        status: "failed",
      });
    }

    if (intent.action === "show") {
      const view = await service.readList(found.list.id, intent.filter);
      if (view.status !== "read") return done(failureReply(view), view);
      context = { listId: found.list.id, name: found.list.name, at: now() };
      const names = view.view.items.map((item) =>
        item.quantity
          ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""} ${item.text}`
          : item.text,
      );
      const word = intent.filter === "completed" ? "finished" : "left";
      return done(
        names.length
          ? `Your ${found.list.name.replace(/\s+list$/i, "")} list contains ${join(names)}.`
          : intent.filter === "completed"
            ? `Nothing is checked off on ${found.list.name} yet.`
            : `${found.list.name} is empty.`,
        { status: "read" },
        { view: view.view, word },
      );
    }
    return execute(build(intent, found.list.id));
  }

  return Object.freeze({
    handle,
    get activeListId() {
      return fresh(context, contextTtlMs) ? context.listId : null;
    },
  });
}

// Used by tests and the UI to describe the fixture without extra parsing paths.
export { resolveList };
