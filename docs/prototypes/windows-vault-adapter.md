# Windows encrypted adapter with session permissions

This [Session 2](https://github.com/F2iLLC/lunaos-home/issues/14) experiment connects the [permission service](session-permissions.md) to actual encrypted files through `lib/windows-probe-store.js`. It advances beyond the standalone [DPAPI probe](windows-storage.md), but is still developer-only and synthetic. An opt-in [Windows browser screen](windows-vault-screen.md) and [fixed-example assistant bridge](windows-assistant.md) use this adapter and service. The ordinary draft preview, its existing MCP tools and packaged native/Android app do not load it.

## Run locally

On Windows with Node 24+ and PowerShell 7:

```powershell
node scripts/probe-windows-vault.mjs
```

If `pwsh` is not on PATH, set `LUNA_HOME_PROBE_POWERSHELL` to the trusted installed PowerShell 7 executable for this process. Never take an executable path from a model, record or remote request. The script starts hidden child processes without a shell and sends data on stdin. Decrypted records travel only through the worker's stdout pipe to the local Node process; only summary booleans appear in the final report. No record content is placed in command arguments, logs or URLs, and no network listener is opened.

The test creates its own unique directory under the Windows LocalApplicationData `LunaOSHome/FictionalVaultAdapters` folder, outside the checkout, for the fixed Alex/Sam fixture. Successful completion removes that run directory. It does not open existing household files, change global settings or use credentials/API keys. No new dependencies or vendored code are introduced: the worker uses the installed .NET DPAPI wrapper already investigated in the first Windows probe.

## Storage behavior

The privileged adapter opens an identified synthetic store and provides `read`, `create` and `edit`. Record/member identifiers are opaque lowercase ASCII IDs; profile details have bounded `memberId`, `label` and `value` strings. A versioned envelope holds up to 64 records. All IDs and values inside the envelope are encrypted together; the filename does not identify a person or record. The adapter does not implement deletion.

`scripts/windows-vault-worker.ps1` validates its bounded input, uses a fixed application-specific base directory and rejects existing reparse-point ancestors. On creation it disables inherited directory ACLs and grants the current Windows user and LocalSystem access. These configured ACLs are not proof of cross-account denial. The worker protects the envelope with DPAPI CurrentUser and a public purpose value that includes the store ID; this is purpose binding, not a password or family grant.

Each operation acquires an exclusive create-new lock file before reading the envelope. Missing, malformed, oversized or undecryptable stores fail; there is no empty-store fallback. Create refuses an existing record, and edit refuses a missing record. Changes are encrypted before any bytes are written. The worker writes a unique same-directory temporary ciphertext file, flushes/closes it, then replaces `records.bin`. No plaintext journal or temporary data file is written by this worker. A second writer fails while the lock exists. The lock is removed when the operation exits normally or through its handled failure path.

Abrupt termination can leave a lock or temporary ciphertext behind. Such a lock blocks subsequent work; the adapter does not guess that it is stale or delete another writer's lock. Power-loss durability, abandoned-lock recovery and same-account hostile filesystem races remain untested. Same-directory replacement is not a claim that every crash point has been validated. Cleanup deletes only the known record file after acquiring the lock and removes the directory nonrecursively; unknown files are retained rather than recursively deleted.

The worker enforces size/schema bounds as well as the Node adapter. Failures returned through the adapter omit OS diagnostics and private paths. A service mutation failure remains an unknown outcome: the permission service invalidates that connection, never auto-retries, and requires new approval on reconnect. This adapter does not add durable operation IDs or a reconciliation screen.

## Observed integrated checks

Run on Windows build 26300, Node 24.19.0 and PowerShell 7.6.5 with the fixed fictional fixture:

| Check | Result |
| --- | --- |
| Enforced setup create/edit | Created Alex and Sam records; changed only Alex's workplace through the permission service and encrypted adapter. |
| Read-only, delete and expiry | Mutations were denied by the service; subsequent reads confirmed the intended values remained. |
| Separate disclosure | A simulated assistant connection could not read without disclosure; approved disclosure returned only Alex's selected value. No live model call occurred. |
| Fresh Node process | Reopened the protected store and read both records with a fresh approval. The old process's grant was rejected. This is not a machine reboot or OS unlock test. |
| Failure before a write | An injected adapter failure left the ciphertext byte-for-byte unchanged. The service reported `WRITE_UNKNOWN`, invalidated the connection and denied a queued retry without a second adapter call. A newly approved read and fresh Node process recovered the original value. |
| Lost write confirmation | After the real encrypted edit completed, an injected adapter error suppressed its receipt. The service reported `WRITE_UNKNOWN`, invalidated the connection and denied a queued overwrite. Both a newly approved read and a fresh Node process recovered the changed value and the untouched second member's record; the old grant stayed invalid. |
| Duplicate create / edit missing record | Both failed; the original ciphertext remained byte-for-byte unchanged. |
| Corruption | Altered ciphertext caused read and edit to fail without overwriting it. Restoring the saved original test bytes restored readability. This does not prove replay/rollback protection. |
| Concurrent writer | A held lock caused edit to fail; the encrypted file remained unchanged. |
| Output inspection / cleanup | Only `records.bin` remained after operations; the specified UTF-8/UTF-16 fixture markers were absent. The unique run directory was removed. This is not an inspection of OS paging, crash dumps, backups or all logs. |

The current-user DPAPI limitations still apply: another process under the same Windows user can decrypt, and Windows profile/recovery arrangements matter. No Home unlock prompt, hardware-bound key guarantee, backup exclusion or device-exclusive custody is established. Production typed Sign-ins and secret classification are not implemented by the profile-detail schema.

A separate [synthetic portable-backup candidate](portable-backup.md) exercises
record-only export and empty-store import using an independent recovery key.
It is not exposed through this adapter's GUI or assistant and is not a
clean-device recovery result.

The uncertain-write checks inject an error in the local adapter wrapper before a write or after a successful encrypted commit. They prove that a generic failure does not imply rollback and that this service does not automatically replay the write. They do not terminate a worker, interrupt filesystem replacement or simulate power loss. Fresh-process recovery is a test-controlled read with new permission, not a finished recovery screen or durable operation-ID protocol.

## Remaining Session 2 work

Extend the fixed-example browser/assistant experiment to reviewed native GUI and production assistant transport boundaries without exposing arbitrary paths or general approval authority. The separate assistant guide records the bounded live Claude Code result; it does not establish general integration. Prove trusted OS unlock/cancellation, the Android Keystore/private-storage counterpart and phone-only use, authenticated direct pairing, unknown-write recovery, host sleep and user-held backup/restore. Replace or deliberately approve the subprocess prototype approach before claiming a packaged native service. Independent security and product acceptance remain open; Session 2 is not complete. Public PR tests now run on hosted GitHub Actions under the [CI handoff](../ci-actions-setup.md); this work distributes no binaries.
