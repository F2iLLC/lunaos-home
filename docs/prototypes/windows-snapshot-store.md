# WindowsSnapshotFileStore v1: native snapshot adapter

This increment implements the Windows adapter selected in the
[durability matrix](../architecture/grocery-durability-matrix.md) behind the
shared `VersionedVaultRecordStore` v2 contract and runs it through the
[adapter conformance suite](../architecture/versioned-record-store-conformance.md)
and the grocery fault matrix. It advances [VLT-03](https://github.com/F2iLLC/lunaos-home/issues/6)
and [GROC-02](https://github.com/F2iLLC/lunaos-home/issues/141). It is a
developer-harness result with fictional records. It does not qualify
production key release, enable a Home storage route, or authorize sensitive use.

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
  256-bit data key at initialization and unwraps it for each operation. The
  only protector compiled is the **developer-harness fixture protector**
  (Cargo feature `developer-harness`): the automated suites supply a 32-byte
  fixture key per invocation. It is not persisted and is not a key-release
  method. The selected production protector, Microsoft Software KSP under the
  CNG high-protection UI policy with a separate vault-key password, is **not
  implemented** here. Its attended owner-window lifecycle lives in the
  [KSP envelope prototype](windows-ksp-envelope.md) and must be integrated
  behind this seam deliberately. A default build (no feature) refuses the
  fixture protector and fault injection with `INVALID`; there is no DPAPI or
  prompt fallback in any build.

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
line. No shell, arguments or network are involved; the executable path is a
trusted local build selected by the operator. Each operation holds an
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

## Build and run

On Windows with Node 24+, PowerShell 7 and the stable Rust toolchain:

```powershell
npm ci --ignore-scripts
npm run build:snapshot-store      # developer-harness worker into target/developer-harness
npm run test:snapshot-store       # crate unit tests with the same feature
node --test test/windows-snapshot-store.test.js
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

## Limits and next steps

This is not production adapter qualification. Open items, each a separate
gate in the durability matrix: the Software KSP protector behind the seam with
the attended owner-window lifecycle; rerunning the conformance suite and fault
matrix on that build; Home enrollment, unlock, method change, credential reset,
migration and clean-device recovery; the user-selected storage location and
backup exclusions; physical power loss, real disk exhaustion, abandoned-lock
recovery and hostile same-user processes; anti-rollback for a replaced
snapshot file; and independent review before any sensitive record is routed
through this store. The crate's fixture protector must never be used with real
records.
