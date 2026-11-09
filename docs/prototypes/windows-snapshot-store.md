# WindowsSnapshotFileStore v1: native snapshot adapter

This increment implements the Windows adapter selected in the
[durability matrix](../architecture/grocery-durability-matrix.md) behind the
shared `VersionedVaultRecordStore` v2 contract and runs it through the
[adapter conformance suite](../architecture/versioned-record-store-conformance.md)
and the grocery fault matrix. It advances [VLT-03](https://github.com/F2iLLC/lunaos-home/issues/6)
and [GROC-02](https://github.com/F2iLLC/lunaos-home/issues/141). It is a
developer-harness result with fictional records. The selected Software KSP
protector and an unlock-session lifecycle are implemented behind the seam, but
their attended Windows-dialog evidence is not recorded yet. Nothing here
qualifies production key release, enables a Home storage route, or authorizes
sensitive use.

## What exists and what does not

The crate `src-tauri/crates/windows-snapshot-store` is standalone. It is not a
dependency of the Tauri application, exposes no Tauri command, and the Home
GUI, MCP tools and sessions do not load it. The recorded
[integration blocker](../architecture/grocery-durability-matrix.md#native-integration-blocker)
still applies: connecting any native store to Home before the #6
enrollment/unlock/recovery lifecycle exists would turn a fictional preview into
real vault storage.

The crate separates two concerns:

- **Snapshot store.** One encrypted file per store holds the complete record
  snapshot. Every mutation is a compare-and-swap on one record's revision,
  committed by writing a flushed same-directory pending file, verifying it
  byte-for-byte and by decryption, replacing the snapshot atomically with
  `MoveFileExW` (`REPLACE_EXISTING | WRITE_THROUGH`), and reading the committed
  file back before acknowledging. This layer is implemented and tested.
- **Key protector.** The `KeyProtector` trait wraps the store's random
  256-bit data key at initialization and unwraps it for each operation. Two
  protectors exist:
  - the **developer-harness fixture protector** (Cargo feature
    `developer-harness`): the automated suites supply a 32-byte fixture key
    per invocation. It is not persisted and is not a key-release method. A
    default build refuses it and fault injection with `INVALID`.
  - the **Software KSP protector** (`src/ksp.rs`, every build): the selected
    method, described [below](#software-ksp-protector-and-unlock-sessions).
    It is implemented and unit-tested against the provider, but its
    Windows-dialog behavior has **not** been exercised in an attended run on
    this source.

  There is no DPAPI, application-prompt or cross-protector fallback in any
  build: a snapshot names its protector in the authenticated header and is
  refused under any other.

## Format and bounds

```text
LunaOSHome.SnapshotStore.1\n
{"format":1,"storeId":"<uuid>","protector":"fixture-aes256-gcm","wrappedKey":"<hex>","commit":"<uuid>"}\n
<12-byte nonce><16-byte tag><AES-256-GCM ciphertext>
```

The magic line and canonical header are the authenticated additional data.
The ciphertext is canonical JSON `{ "records": { id: { revision, data } } }`
with sorted keys; decoding re-encodes and compares bytes, so a noncanonical
file, header or snapshot is refused before any cryptographic operation. Each
commit uses a fresh nonce and commit identifier. AES-256-GCM and the system RNG
come from Windows CNG; no cryptographic primitive is implemented in the crate.

Bounds: one encoded `{ revision, data }` row is at most 262144 bytes (the same
ceiling as the DPAPI probe and the reference adapter), a snapshot holds at most
256 records and 4 MiB of plaintext, and the worker reads at most 1 MiB of
input. Record IDs, revisions and record shapes are validated natively before
any storage access; the complete field-level schema remains the shared Zod
contract in `lib/vault-record-contract.js`, which the Node adapter applies
before invoking the worker.

## Worker protocol, locking and outcomes

`lib/windows-snapshot-store.js` spawns the worker executable once per
operation with one bounded JSON request on stdin and reads one JSON response
line (fixture protector only), or once per [unlock session](#software-ksp-protector-and-unlock-sessions)
with the single fixed argument `--session`. No shell, data-bearing arguments
or network are involved; the executable path is a trusted local build selected
by the operator. Each operation holds an
exclusive lease on `.lock` (share mode none) for its whole duration, waiting
up to five seconds for another holder with exponential backoff, treating only sharing and lock violations as contention, and never deleting another process's
lock. Concurrent writers from the same revision therefore commit at most once;
the loser sees a definite conflict once the lock is free.

| Worker result                       | Adapter behavior                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `CONFLICT`                          | `VaultConflictError`: definite comparison refusal before any persisted byte changed.                                    |
| `UNSUPPORTED`                       | `VaultUnsupportedRecordError`: the profile-only edit path met a grocery record.                                         |
| `INVALID`, `BUSY`, `STORAGE_FAILED` | Generic failure before the replacement boundary; the last committed snapshot is intact and the pending file is removed. |
| `COMMIT_UNKNOWN`                    | Generic failure after a replacement attempt; the caller must read back and must not replay.                             |

Failure responses carry only a code and a static reason identifier. No path,
record value, revision or OS diagnostic appears in them. The `directory`
returned by `init`/`open` is privileged developer metadata for the harness and
is never returned through a Home session or MCP tool.

Store directories are `%LOCALAPPDATA%\LunaOSHome\SnapshotStores\<store ID>`.
The store ID must be a canonical lowercase UUID; reparse points on the path are
refused; the leaf directory is created with an explicit DACL granting full
control to the current user and LocalSystem only, with inheritance disabled.
That is defense in depth under the user profile, not proof of cross-account
denial. The user-selected production location and its backup exclusions remain
Home setup work.

## Software KSP protector and unlock sessions

**Protector.** `SoftwareKspProtector` keeps one persisted, non-exportable
RSA-2048 key per store in the Microsoft Software Key Storage Provider, named
`LunaOSHome.VaultKey.<store id>`, created under CNG's
`NCRYPT_UI_FORCE_HIGH_PROTECTION_FLAG` policy. Windows owns the dialog in
which the owner creates and later enters a **separate vault password**; no
code in this repository receives it. The data key is wrapped with
RSA-OAEP-SHA256 (a public-key operation that never prompts) and the header
records `software-ksp-rsa2048-oaep-sha256`. This is not Windows sign-in, not
Windows Hello and not TPM-backed, and resetting the Windows account does not
recover the key.

**One gesture per session.** The first unwrap on an opened protector asks
Windows for the password; later unwraps on the same handle are silent. Before
that first release an opened protector tries a silent unwrap on a second
handle and refuses the key (`protector-not-password-protected`) if it
succeeds, so a key that answers without the dialog is never used. The data
key itself is still unwrapped per operation and wiped afterwards; between
requests the process holds the provider handle, not key bytes.

**Session = process.** `windows-snapshot-store-worker.exe --session` serves
one unlock session: a start line (`session-create` or `session-open`), then
one JSON request per line with an `id`, answered in order. It is the only
mode that accepts `{ "kind": "software-ksp" }`; a one-request process
refuses it (`protector-requires-session`). The session's native owner window
(`src/owner.rs`) parents the Windows dialog, then minimizes without taking
focus. The session ends by process exit, which closes every key handle, when:

| Trigger | Reported reason |
| --- | --- |
| `lock` request, or the caller closing the pipe | `locked` |
| Windows lock, unlock, logoff, disconnect, suspend or resume | `session-event` |
| The owner closes the session window | `window-closed` |
| No request for 5 minutes | `idle` |
| The password gesture not completing within 120 seconds | `unlock-timeout` |
| 30 minutes since the session started, whatever its activity | `expired` |

The limits are constants in a default build; only a developer-harness worker
accepts shortened test limits. A new process always starts locked: nothing is
cached on disk or handed to another process. The adapter
(`openWindowsSnapshotSession`) rejects a request made after the end with
`VaultLockedError`; a request in flight when the session dies fails with the
generic storage failure, because its commit outcome is unknown and must be
read back, exactly like `COMMIT_UNKNOWN`.

**Setup and removal.** `session-create` enrolls the key, initializes the
store and proves one release before reporting `unlocked`; if that first
unlock is cancelled or fails, the new store and key are removed so setup can
be repeated, and an existing store or key is refused untouched
(`exists`, `protector-exists`). A missing or duplicate key is refused before
any window appears. `Store::discard` removes a store without any key release
(the only way to clear a store whose password is lost); it inspects every
entry first and is reachable only from a developer-harness worker today.
Authenticated `cleanup` is unchanged.

**Deliberate difference from the envelope prototype.** The
[KSP envelope prototype](windows-ksp-envelope.md) bounded each fictional read
to a five-second visit with its owner window in the foreground. A session
drops the foreground requirement after the password gesture, because Home's
GUI and an assistant-delegated request run in other windows; the bound is the
table above instead. That trade is a design decision for independent review,
not a settled security claim: an unlocked session serves any same-user process
that holds its pipe, and no protection against a compromised unlocked device
is claimed.

## Build and run

On Windows with Node 24+, PowerShell 7 and the stable Rust toolchain:

```powershell
npm ci --ignore-scripts
npm run build:snapshot-store      # developer-harness worker into target/developer-harness
npm run test:snapshot-store       # crate unit tests with the same feature
node --test test/windows-snapshot-store.test.js test/windows-snapshot-session.test.js
```

The attended Software KSP journey needs a person at the Windows dialog and an
interactive terminal. It uses a disposable key and fictional records, never
asks for a password in the terminal, and removes the key and store at the end:

```powershell
node scripts/test-attended-snapshot-session.mjs
```

A default-feature build (`cargo build --locked` in the crate) lands in
`target/debug` and cannot be mistaken for the harness worker; the adapter
looks only in `target/developer-harness`. The Node tests skip with an explicit
reason when the worker is not built or the platform is not Windows. The hosted
`windows-2025` job builds the worker, runs the crate tests and runs the suite on
every pull request; it corroborates the probe but does not exercise Windows 11
Home.

## Observed result

Recorded on Windows 11 Home 10.0.26300, Node v24.19.0, PowerShell 7.6.9,
cargo 1.99.1 and rustc 1.99.1, on the source head of the pull request that
added this document, with the fixture protector only:

| Check                                                                      | Result                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Crate unit tests (`developer-harness`)                                     | 19 passed: CNG AES-GCM known answer, lock contention and permanent lock errors, canonical file/snapshot format with single-byte corruption sweep, validation, fixture protector round trip and refusal, commit classification, injected faults, compare-and-swap lifecycle through reopen, tamper refusal without overwrite, no plaintext or revision at rest.                                                                                                                        |
| Adapter conformance C-01 to C-16                                           | 16 passed on the native adapter through the Node worker, including C-12 concurrent writers from independent processes and C-14 persisted bytes.                                                                                                                                                                                                                                                                                            |
| Fault matrix (grocery list and receipt through `createGroceryPersistence`) | Eight stages: before write, during write, after write, before replacement, disk full (simulated), process interruption (abrupt worker exit), tampered pending file reopen to the **old** list with no receipt; after replacement reopens to the **new** list with its receipt and reports `COMMIT_UNKNOWN`. An interrupted worker leaves exactly one ciphertext-only pending file that later operations never promote; cleanup removes it. |
| Protector and tamper checks                                                | A different fixture key cannot open the store; a flipped ciphertext byte fails reads and edits without rewriting the file; a stale pending file is ignored; a default-feature build refuses the fixture protector.                                                                                                                                                                                                                         |
| Directory DACL (`icacls`)                                                  | Explicit entries for `NT AUTHORITY\SYSTEM` and the current user only, no inherited entries.                                                                                                                                                                                                                                                                                                                                                |
| Shared service over the adapter                                            | `createVaultSessionService` and grocery persistence run unchanged: receipt retry after reopen, profile session cannot read or reinterpret the grocery record.                                                                                                                                                                                                                                                                              |
| Lockfile inventory                                                         | Every package/version in the crate's `Cargo.lock` is already present in `src-tauri/Cargo.lock`; a test enforces this.                                                                                                                                                                                                                                                                                                                      |
| Default build                                                              | `cargo build --locked` and `cargo clippy --all-targets` pass with and without the feature; the worker also type-checks for a non-Windows target and exits with a clear message there.                                                                                                                                                                                                                                                      |

## Session and protector checks without a dialog

Recorded on the same host for the pull request that added the Software KSP
protector and session mode. None of these rows involves the Windows password
dialog; they are not key-release evidence.

| Check | Result |
| --- | --- |
| Crate unit tests (`developer-harness`) | 32 passed: the earlier tests plus the Software KSP protector against an unnamed, unprotected provider key (wrap/unwrap, tamper, wrong length, another key), rejection of a key that releases silently, missing-key refusal without a dialog, a store lifecycle on a provider key, the watchdog verdicts, the phase clock, a hidden session run, and the shared session-monitor tests. |
| Session conformance C-01 to C-16 | 16 passed through `openWindowsSnapshotSession` with the fixture protector, including C-12 across independent session processes. |
| Session lifecycle | Many requests in one session; `lock` then `VaultLockedError`; another key cannot start a session; idle expiry with activity restarting the timer; lifetime expiry despite activity; abrupt worker exit mid-mutation reported as an unknown outcome and reopened to the old record. |
| Session fault matrix | The eight stages reopen the complete old record, or the new one after replacement, both with one fault per session and with faults injected inside a single continuing session. |
| Software KSP refusals | A session for a store with no key fails with `protector-missing` before any window; the one-request adapter cannot carry the protector. |
| Default-feature worker | Refuses the fixture protector, test limits and unauthenticated discard in session mode; the Software KSP protector is compiled in. |

## Limits and next steps

This is not production adapter qualification. Open items, each a separate
gate in the durability matrix: the attended Software KSP journey on this
source (create, unlock, wrong password, cancel, close-to-lock, Windows lock,
restart-locked); rerunning the complete conformance suite on the Software KSP
build; independent review of the session model above; Home enrollment, unlock,
method change, credential reset,
migration and clean-device recovery; the user-selected storage location and
backup exclusions; physical power loss, real disk exhaustion, abandoned-lock
recovery and hostile same-user processes; anti-rollback for a replaced
snapshot file; and independent review before any sensitive record is routed
through this store. The crate's fixture protector must never be used with real
records.
