import { z } from "zod";
import { avatarForOutcome } from "./notebook-avatar.js";
import { notebookOperation } from "./notebook-contract.js";

const request = z.discriminatedUnion("action", [
  z.object({ action: z.literal("snapshot") }).strict(),
  z.object({ action: z.literal("op"), operation: notebookOperation }).strict(),
  z
    .object({
      action: z.literal("say"),
      text: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      action: z.literal("member"),
      memberId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,80}$/)
        .nullable(),
    })
    .strict(),
]);

/**
 * Transport-neutral adapter used by the local server. The UI and the spoken
 * path run through the same service, so a voice change shows up on the next
 * snapshot and a UI change is visible to the next spoken query.
 */
export function createNotebookApi({ service, assistant, people }) {
  // Household members come from the vault, when this notebook is connected to one.
  const household = async () =>
    people ? { members: await people.list(), member: people.current() } : {};
  const snapshot = async () => {
    const read = await service.read();
    return {
      ...(read.status === "read" ? { notebook: read.notebook } : {}),
      ...(await household()),
    };
  };
  return Object.freeze({
    async request(raw) {
      const parsed = request.safeParse(raw);
      if (!parsed.success)
        return {
          status: "failed",
          reply: "Luna could not read that request.",
          avatar: avatarForOutcome({ status: "failed" }),
        };
      const input = parsed.data;
      if (input.action === "snapshot") {
        const read = await service.read();
        return read.status === "read"
          ? { status: "read", notebook: read.notebook, ...(await household()) }
          : {
              status: read.status,
              reply: "Luna could not open her notebook.",
              avatar: avatarForOutcome(read),
            };
      }
      if (input.action === "member") {
        const chosen = people ? await people.choose(input.memberId) : false;
        return {
          status: chosen ? "read" : "failed",
          reply: chosen ? "" : "That person is not in this household's vault.",
          ...(chosen ? {} : { avatar: avatarForOutcome({ status: "failed" }) }),
          ...(await snapshot()),
        };
      }
      if (input.action === "say") {
        const outcome = await assistant.handle(input.text);
        return { ...outcome, ...(await snapshot()) };
      }
      const outcome = await service.run(input.operation);
      const reply =
        outcome.status === "applied"
          ? "Saved."
          : outcome.status === "unknown"
            ? "I couldn't confirm that was saved. Please check the list."
            : outcome.code === "CONFIRMATION_REQUIRED"
              ? "Please confirm that first."
              : "Nothing was changed.";
      return {
        status: outcome.status,
        code: outcome.code,
        reply,
        avatar: avatarForOutcome(outcome),
        ...(await snapshot()),
      };
    },
  });
}
