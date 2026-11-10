# Luna's universal notebook (issue #320)

One notebook engine, unlimited little notebooks. Groceries, chores, movies and
gifts are the same lists with a `type` label; nothing branches on list type.

## Shape

| Layer                   | File                                               | Role                                                                              |
| ----------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Model + transitions     | `lib/notebook-contract.js`                         | Zod schemas, list/item resolution, pure `applyNotebookOperation`                  |
| Persistence + authority | `lib/notebook-service.js`                          | Only path to the data; household gate, CAS retry, readback reconciliation         |
| Language                | `lib/notebook-assistant.js`                        | Utterance parsing, active-list context, clarification, confirmation               |
| Avatar                  | `lib/notebook-avatar.js`                           | Maps a real outcome to the notebook animation; overlay yields to sleep/timers     |
| Transport               | `lib/notebook-api.js`, `server.js` `/api/notebook` | Same service for UI and spoken text                                               |
| UI                      | `src/notebook.js`, `#notebook` in `src/index.html` | Renders what the service returned; keeps no list store                            |
| Windows preview         | `lib/windows-notebook.js`                          | Opt-in wiring of the service to the DPAPI store for `npm start` and the assistant |

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

## Windows storage

Both Windows encrypted stores accept the `household-notebook` record kind: the DPAPI probe store (`scripts/windows-vault-worker.ps1`) and `WindowsSnapshotFileStore` (`src-tauri/crates/windows-snapshot-store`). Each checks the record's shape and bounds before any storage access, and each refuses a profile edit aimed at a notebook record. `test/windows-notebook-persistence.test.js` proves, on both, that spoken lists survive a restart unchanged and unreadable on disk, that a failed write is reported as failed, and that a lost acknowledgement is settled by readback. It runs in the `Windows grocery probe` CI job.

The local preview keeps lists only when started with `LUNA_HOME_NOTEBOOK=1` on Windows (`npm start` or the assistant). It then uses a dedicated DPAPI store under the signed-in Windows account, created when the first list is saved. Without the variable `/api/notebook` answers 503 and nothing is stored. Each request starts a PowerShell worker, so a spoken change takes a few seconds in the preview.

The PowerShell worker needs PowerShell 7.5 or later for notebook records. Earlier versions rewrite timestamp text when they parse JSON, so the worker refuses notebook records there instead of changing them. The snapshot-store crate is still not linked into Home; that waits for the vault lifecycle gates.

## Known limits

- Items are split on commas and the word "and", so "Fast and Furious" becomes two items.
- Speech recognizer casing is not corrected beyond capitalizing the first letter.
- The Android voice listener and `LunaFace.java` are not wired to this assistant yet. On the device, "add ..." is still treated as a timer attempt and is not forwarded anywhere.
- The device has no store this service can use yet, so lists made in the Windows preview are not visible on the Echo Show.
