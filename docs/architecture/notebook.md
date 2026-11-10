# Luna's universal notebook (issue #320)

One notebook engine, unlimited little notebooks. Groceries, chores, movies and
gifts are the same lists with a `type` label; nothing branches on list type.

## Shape

| Layer                   | File                                               | Role                                                                          |
| ----------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Model + transitions     | `lib/notebook-contract.js`                         | Zod schemas, list/item resolution, pure `applyNotebookOperation`              |
| Persistence + authority | `lib/notebook-service.js`                          | Only path to the data; household gate, CAS retry, readback reconciliation     |
| Language                | `lib/notebook-assistant.js`                        | Utterance parsing, active-list context, clarification, confirmation           |
| Avatar                  | `lib/notebook-avatar.js`                           | Maps a real outcome to the notebook animation; overlay yields to sleep/timers |
| Transport               | `lib/notebook-api.js`, `server.js` `/api/notebook` | Same service for UI and spoken text                                           |
| UI                      | `src/notebook.js`, `#notebook` in `src/index.html` | Renders what the service returned; keeps no list store                        |

## Reused, not rebuilt

- The versioned encrypted-store contract (`store.read/create/edit`, per-record compare-and-swap, 262144-byte ceiling) and `VaultConflictError`.
- `lib/vault-record-contract.js`: one new tagged record kind, `household-notebook`.
- The grocery slice's rules: authorize first, a candidate is never evidence of a save, unknown outcomes stay unknown.
- The existing preview-server guards (host, origin, `X-Home-Preview`, CSP) and the `.list-panel`/`.quiet-button` UI patterns.

## Decisions

- **One record per household holds all lists.** A single compare-and-swap then covers rename, move-between-lists and delete, and the store needs no list index. Bounds: 50 lists, 200 items each, and the store ceiling.
- **Operations carry intent, not revisions.** On a conflict the service re-reads and re-applies (up to 5 times), so concurrent writers on two devices lose no updates.
- **Each commit carries a fresh `commitId`.** If an acknowledgement is lost, readback of that id decides: applied, failed, or `unknown` when the read also fails. The assistant never claims a save it cannot show.
- **Duplicates:** an identical _active_ item in the same list is skipped and reported. Finished items and an explicit repeat do not count.
- **"Cross off" completes** the item (it stays retrievable under completed); "remove/take off" deletes it.
- **Delete list / clear list** need a spoken or UI confirmation that expires after 30 s; any other utterance cancels it.
- **Context:** the active list lasts 120 s and is set only by a successful notebook operation. With no fresh context, or an ambiguous name, Luna asks. A reply that names no list is treated as unrelated speech.
- **Timers keep precedence.** `add 5 minutes to the timer` is not a notebook request.

## Known limits

- Items are split on commas and the word "and", so "Fast and Furious" becomes two items.
- Speech recognizer casing is not corrected beyond capitalizing the first letter.
- The Windows DPAPI snapshot store (Rust crate and PowerShell worker) validates record kinds and currently rejects `household-notebook`. Persistence across restart is proven on the reference store adapter only. The Android voice listener and `LunaFace.java` are not wired to this assistant yet.
