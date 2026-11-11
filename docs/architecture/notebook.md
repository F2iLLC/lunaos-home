# Luna's universal notebook (issue #320)

One notebook engine, unlimited little notebooks. Groceries, chores, movies and
gifts are the same lists with a `type` label; nothing branches on list type.

## Shape

| Layer                   | File                                               | Role                                                                                    |
| ----------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Model + transitions     | `lib/notebook-contract.js`                         | Zod schemas, list/item resolution, pure `applyNotebookOperation`                        |
| Persistence + authority | `lib/notebook-service.js`                          | Only path to the data; household gate, CAS retry, readback reconciliation               |
| Language                | `lib/notebook-assistant.js`                        | Utterance parsing, active-list context, clarification, confirmation                     |
| Avatar                  | `lib/notebook-avatar.js`                           | Maps a real outcome to the notebook animation; overlay yields to sleep/timers           |
| Transport               | `lib/notebook-api.js`, `server.js` `/api/notebook` | Same service for UI and spoken text                                                     |
| UI                      | `src/notebook.js`, `#notebook` in `src/index.html` | Renders what the service returned; keeps no list store                                  |
| Vault connection        | `lib/vault-notebook.js`                            | The notebook as a record in the household vault; members and attribution from the vault |

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

## Where the lists live: the household vault on the Mac

Owner ruling, 2026-11-10: the Mac Studio is the vault host for everything. Luna's notebook is one record (`notebook-<household>`) in the household vault, next to the member details and the grocery list record. It is not a separate store. See [the Mac vault host record](mac-vault-host.md).

- `lib/vault-notebook.js` builds the notebook over whichever vault the process has. On the Mac with `LUNA_HOME_VAULT=1` that is the household vault. On Windows with `LUNA_HOME_FICTIONAL_SAVE=1` it is the developer preview store, which is not the household vault and is not for real household data.
- People come from the vault. A member is someone with a saved detail there. The notebook page offers "Writing as"; the choice is stored on each list and item as `updatedBy`. It is attribution only, never a permission, and is not remembered across a restart.
- The checklist page is the notebook list with type `checklist`. Its categories are the items' `category`. With no vault it stays a list for the visit, as before.
- Without a vault `/api/notebook` answers 503 and nothing is stored.

Both Windows encrypted stores also accept the `household-notebook` record kind (`scripts/windows-vault-worker.ps1`, `src-tauri/crates/windows-snapshot-store`), covered by `test/windows-notebook-persistence.test.js` in the `Windows grocery probe` CI job. The PowerShell worker needs PowerShell 7.5 or later for notebook records and refuses them on older versions.

## Known limits

- Items are split on commas and the word "and", so "Fast and Furious" becomes two items.
- Speech recognizer casing is not corrected beyond capitalizing the first letter.
- The Android voice listener and `LunaFace.java` are not wired to this assistant yet. On the device, "add ..." is still treated as a timer attempt and is not forwarded anywhere.
- The Echo Show and the Windows page do not reach the Mac vault yet. The relay on the Mac still answers questions only.
- The grocery list record and the notebook are in the same vault but are still two records with two contracts. "Put milk on the grocery list" writes a notebook list, not the grocery record.
- The Windows developer store does not wait for its file lock, so two requests that overlap (a read during a write) can fail there. They are reported as failed and nothing is lost. The Mac vault store waits for its lock.
- "Writing as" is one choice per running Home process, not per browser tab or per speaker. Everything written while it is set, including what Luna is told, is attributed to that member. Per-session identity comes with the vault sessions on the Mac.
- Members are read from the saved example details (`fictionalDetails`). Household member records proper belong to VLT-04.
