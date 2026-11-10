// Maps an ACTUAL notebook outcome to the chibi notebook animation. The mapping
// accepts only service results or dialog outcomes, so the avatar can never play
// a success animation for an operation that did not durably happen.
export const NOTEBOOK_ANIMATIONS = Object.freeze({
  "new-page": "Luna opens a fresh notebook page",
  scribble: "Luna scribbles with an oversized pencil",
  read: "Luna opens her notebook and reads",
  checkmark: "Luna draws a cheerful checkmark",
  "cross-out": "Luna crosses something out",
  "erase-rewrite": "Luna erases and rewrites a heading",
  hover: "Luna pauses with pencil hovering",
  puzzled: "Luna looks puzzled",
});

const FOR_OPERATION = Object.freeze({
  create_list: "new-page",
  add_items: "scribble",
  edit_item: "scribble",
  move_item: "scribble",
  reorder_item: "scribble",
  remove_item: "cross-out",
  delete_list: "cross-out",
  clear_list: "cross-out",
  rename_list: "erase-rewrite",
});

/** @returns {{animation:string,success:boolean}} */
export function avatarForOutcome(outcome) {
  if (outcome?.status === "clarify")
    return { animation: "hover", success: false };
  if (outcome?.status === "read") return { animation: "read", success: true };
  if (outcome?.status !== "applied")
    return { animation: "puzzled", success: false };
  const { result } = outcome;
  if (result.op === "complete_item")
    return {
      animation: result.completed ? "checkmark" : "scribble",
      success: true,
    };
  // Nothing was written (every item was already there): no success animation.
  if (result.op === "add_items" && result.added.length === 0)
    return { animation: "puzzled", success: false };
  const animation = FOR_OPERATION[result.op];
  return animation
    ? { animation, success: true }
    : { animation: "puzzled", success: false };
}

/**
 * Overlay state for the animation layer. Notebook animations are a transient
 * overlay on top of Luna's base state (awake, wake glow, sleep, timer), so they
 * never replace or restart those states. Sleep and ringing timers outrank the
 * overlay; the overlay is dropped rather than queued while they are active.
 */
export function createNotebookOverlay({
  now = () => Date.now(),
  durationMs = 2200,
} = {}) {
  let current = null;
  return Object.freeze({
    play(outcomeAvatar, baseState) {
      if (["sleeping", "timer-ringing"].includes(baseState)) return null;
      current = { ...outcomeAvatar, until: now() + durationMs };
      return current;
    },
    active() {
      if (current && now() >= current.until) current = null;
      return current;
    },
    clear() {
      current = null;
    },
  });
}
