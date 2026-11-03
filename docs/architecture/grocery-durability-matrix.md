# Grocery durability and adapter qualification matrix

Status: synthetic qualification evidence only. This matrix does not close #6,
#10, #151 or #141 and does not qualify a production adapter.

## Boundary and supported-platform intent

The production-facing boundary is the versioned `VersionedVaultRecordStore`
contract v2: one compare-and-swap commit contains the complete grocery list and
its successful mutation receipt. The store owns revision comparison and the
atomic durable replacement. A failed acknowledgement is reconciled by a read;
if that read fails, the result remains `unknown` and the caller must read later
before any retry. This is the boundary exercised by PR #206.

The selected first production-support target is **Windows 11 x64 desktop**.
The owner directed selection of an unlock method compatible with this PC. The
host reports Windows Home, build 26300, and a ready TPM 2.0. PDE is unavailable
on this edition. The selected implementation candidate is the Microsoft
Software KSP with a separate vault-key password entered only in its
OS-owned high-protection dialog. This is a separate vault-password method; it
is not Windows Hello, TPM-backed custody, or authentication tied to the Windows
account. The earlier disposable KSP experiment is compatibility evidence only,
not implementation or qualification evidence. The app must not collect or
persist this password.

The intended adapter is `WindowsSnapshotFileStore v1`: a native Tauri/Rust
adapter that commits the complete versioned record snapshot as one encrypted
file, using a flushed same-directory temporary file, atomic replacement and
readback. It must fail closed if the Software KSP protector is missing,
unavailable, canceled, or cannot unwrap the record key; it must never fall back
to DPAPI. The candidate's attended production flow still needs a reviewed
integration and operator-run credential/lifecycle evidence. This selection is
an implementation direction, not a qualification or release claim. #6 remains
open until key custody, unlock, migration and failure acceptance are reviewed
and integrated.

### Windows key-release assessment (2026-11-03)

The current official platform documentation establishes these boundaries:

* Windows Hello application credentials keep private keys in the OS and expose
  requested cryptographic operations, such as signing; the app does not receive
  key material. The documented `KeyCredential` flow is challenge signing, not
  release of an arbitrary vault data key. The existing Home
  `UserConsentVerifier` call returns a verification result and gates app access;
  it does not unwrap or release an encryption key. See Microsoft's
  [Windows Hello app guidance](https://learn.microsoft.com/en-us/windows/apps/develop/security/windows-hello).
* `DataProtectionProvider` uses DPAPI and binds protected data to a security
  descriptor such as a user SID. This is user-scoped data protection, not
  authentication-bound release. See Microsoft's
  [Windows data protection guidance](https://learn.microsoft.com/en-us/windows/uwp/security/data-protection).
* Windows Personal Data Encryption (PDE) can protect custom app content through
  its APIs and uses Windows Hello for Business. Its supported configuration
  requires Windows 11 Enterprise/Education or qualifying licenses, Entra join,
  enabled policy and Hello sign-in; Pro and Home are excluded. Key availability
  follows sign-in and PDE lock-level rules, rather than an app-controlled
  per-operation prompt. See Microsoft's [PDE overview](https://learn.microsoft.com/en-us/windows/security/operating-system-security/data-protection/personal-data-encryption/), [PDE configuration](https://learn.microsoft.com/en-us/windows/security/operating-system-security/data-protection/personal-data-encryption/configure) and [PDE CSP edition/OS scope](https://learn.microsoft.com/en-us/windows/client-management/mdm/personaldataencryption-csp).

Microsoft documents asymmetric encryption and RSA in the Software KSP, and
CNG's high-protection policy requiring provider UI for protected-key use. The
existing experiment observed an OS-owned separate key-password dialog on this
PC. The selected product direction is this reviewed separate vault-password
method, not Windows Hello or TPM binding. See Microsoft's [CNG KSP list](https://learn.microsoft.com/en-us/windows/win32/seccertenroll/cng-key-storage-providers) and [NCRYPT UI policy](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/ns-ncrypt-ncrypt_ui_policy).

PDE cannot qualify on the observed Windows Home edition. The owner selected the
local-compatible route: integrate the Software KSP high-protection prompt as a
separate vault-password method. This does not bind release to Windows sign-in,
Hello or the TPM. Microsoft documents CNG's high-protection UI and the Software
KSP's asymmetric encryption support in its [CNG KSP list](https://learn.microsoft.com/en-us/windows/win32/seccertenroll/cng-key-storage-providers) and [NCRYPT UI policy](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/ns-ncrypt-ncrypt_ui_policy). The disposable experiment remains compatibility evidence only. The production integration, attended lifecycle evidence and review remain outstanding; DPAPI `CurrentUser` and an app prompt are not fallback release methods.

Android remains an intended follow-on platform, with an eventual native
`AndroidSnapshotFileStore` using Keystore and app-private no-backup storage.
Android 16/API 36 emulator and Android 17/API 37 physical-device combinations
are qualification targets only; the minimum supported Android release,
Keystore requirements and file commit behavior are not selected. Android is
not in the first production-support scope. No other platform is claimed.

| Target | Intended production adapter / implementation under test | Decision and qualification |
| --- | --- | --- |
| Windows 11 Home x64 desktop | Selected target/design: `WindowsSnapshotFileStore v1` (native Tauri/Rust, encrypted whole-record snapshot) using Microsoft Software KSP high-protection UI and a separate vault-key password; **not implemented**. Existing evidence: `WindowsProbeStore v2` in `lib/windows-probe-store.js` + `scripts/windows-vault-worker.ps1`, DPAPI `CurrentUser`, `records.bin`, flushed same-directory temp and `File.Move`. | Key-method direction selected for this PC; adapter integration and operator-run key lifecycle evidence remain open. KSP key loss/password loss locks the snapshot until the separately reviewed VLT-07 recovery route succeeds. Probe remains developer-only. Production path/ACLs, hard-crash durability, recovery and hostile-process boundary remain open. |
| Android follow-on | Intended: `AndroidSnapshotFileStore` (native adapter, Keystore and app-private no-backup snapshot). No grocery persistence implementation exists. | Follow-on qualification target only; excluded from first support scope. Minimum OS, provider/hardware requirement, backup/transfer behavior and atomic replacement semantics remain open. |

The snapshot adapter names describe intended designs; neither is implemented
as a production adapter yet. Android emulator or native-shell tests elsewhere
in the repository do not qualify grocery persistence.

### Native integration blocker

`WindowsSnapshotFileStore v1` cannot yet be integrated safely into the current
Home application. `src-tauri/tauri.conf.json` has bundling disabled and labels
the app as having no secure vault storage. `src-tauri/src/lib.rs` exposes only
debug-only preview/demo modules and no Windows grocery command or native store
that implements the shared JavaScript `VersionedVaultRecordStore` v2 contract.
The KSP example encrypts one fixed fictional envelope; it has no list/receipt
serialization, compare-and-swap commit, or app lifecycle integration. The
application also has no accepted enrollment, unlock, method-change, credential
reset, migration or recovery flow for this vault method. Connecting the example
as grocery storage would silently turn a fictional preview into real vault
storage before the #6 setup/recovery boundaries exist. The blocking work is
therefore product integration and lifecycle design, not KSP availability on
this PC. No native adapter qualification is claimed.

## Fault-injection matrix

The Windows rows below execute the actual developer-only DPAPI probe and reopen
the encrypted store after each injected error. `old` means the previous list
and its existing receipt history remain, with no receipt for the attempted
request. `new` means the updated list and its matching success receipt are both
present. The generic contract rows use a commit-boundary simulator. They
assert that persistence sends list and receipt together in one compare-and-swap
call, then exercise modeled pre/post-replacement outcomes; they are not
filesystem evidence.

| Adapter / injected fault | Reopened state | Evidence boundary |
| --- | --- | --- |
| Windows probe v2: before write | old pair | actual Windows DPAPI file adapter |
| Windows probe v2: during write | old pair | partial temporary ciphertext; actual adapter |
| Windows probe v2: after write, before flush/replacement | old pair | full temporary ciphertext then injected error; actual adapter |
| Windows probe v2: before replacement | old pair | actual adapter |
| Windows probe v2: after replacement | new pair | replacement completed, then acknowledgement failed; actual adapter |
| Windows probe v2: disk full | old pair | simulated partial write and exception; not a volume quota or physical disk-full condition |
| Windows probe v2: process interruption | old pair | simulated partial-write worker failure; not a hard process kill, OS crash or power-loss test |
| Windows probe v2: tampered temporary | old pair | temporary ciphertext bit changed before replacement; actual adapter |
| Generic contract simulator: before write, partial write, after write/before replace, before replace, simulated disk full, simulated interruption, tampered temp | old pair | in-memory commit-slot model only |
| Generic contract simulator: after replace, simulated interruption after replace | new pair | in-memory commit-slot model only |

The Windows adapter matrix covers every requested stage. It does not establish
physical power-loss atomicity, filesystem guarantees across all Windows
filesystems, abandoned-lock recovery, or the production adapter's behavior.
The fault hook is a developer-test input; no Home product route exposes it.

## Restart and retry matrix

For every mutation below, the tests commit, construct a new persistence
executor, and retry. The identical request ID and actor return the stored
receipt without another write. Reusing the ID with a changed command or actor
returns `REQUEST_ID_REUSED`; a new request against the pre-mutation revision
conflicts. A lost acknowledgement after commit also reopens to the receipt with
exactly one write.

| Mutation | Restart retry | Lost acknowledgement and restart |
| --- | --- | --- |
| Add | pass | pass |
| Edit | pass | pass |
| Check | pass | pass |
| Uncheck | pass | pass |
| Remove | pass | pass |

When the write commits but reconciliation cannot read the store, the command
returns `unknown` with `read-before-retry`; it performs one write and does not
replay. A later explicit query reads the committed list and receipt. A future
query returns the committed list while the durable receipt remains in the
stored record. A future production UI must preserve this unknown state and
require that read before a new mutation attempt.

## Backup, restore and schema rollback against #10

The existing VLT-07 archive is schema 1 for bounded profile records. Tests cover
authenticated round-trip, wrong recovery key, tampering, truncation, unknown
archive version, rejection of unrecognized/credential-shaped fields, and
refusal to reinterpret a grocery-list record. Windows v2 snapshot export and
restore are deliberately unsupported. Record version mismatch and downgrade
tests fail closed; there is no v2-to-v1 schema rollback or silent migration.

Therefore grocery-list backup, clean-device restore, restore interrupted at
replacement, recovery-key custody, fresh enrollment after restore, old-grant
rejection for grocery data, and post-restore rollback resistance are **not
qualified**. The profile-only VLT-07 tests documented in
[`portable-backup.md`](../prototypes/portable-backup.md) do not satisfy those
cases. This work leaves #10 open and makes no recovery or deletion-erasure
claim.

## Isolation boundary against #151

The Windows probe test proves that a profile session cannot read or edit a
grocery-tagged record as a profile. This is a record-type boundary within one
synthetic store. It does not audit Home configuration, app-private paths, key
authority, session audiences, logs, backups, child environments, queues/jobs or
operation alongside a synthetic enterprise installation. REUSE-02 remains
unqualified; no compromised-unlocked-device protection is claimed.

## Reproduction and recorded result

Observed on **Microsoft Windows 11 Home 64-bit, version 10.0.26300, build
26300**, **Node.js v24.19.0**, and **PowerShell 7.6.9**. The Windows adapter is
the repository's version-2 synthetic probe using installed .NET
`System.Security.Cryptography.ProtectedData` and `DataProtectionScope.CurrentUser`.
No Android adapter version exists. All fixtures are fictional.

The exact inherited evidence scope was checked at merged PR #212 head
`685b65a5b096caa8bf6e6da7cbd7a51c21bf6f19`: it tests the JavaScript
`WindowsProbeStore v2` DPAPI `CurrentUser` adapter plus generic in-memory
commit-boundary simulations, not a native Rust `WindowsSnapshotFileStore`.
Restart tests exercise add, edit, check, uncheck and remove, including same-ID
retry, changed command/actor, stale revision, and lost acknowledgement. The
fault probe reopens after eight injected stages; disk-full and process
interruption are simulated. Backup tests cover the profile-only schema-1
archive and reject grocery data; snapshot backup, restore and schema rollback
remain unsupported. These existing tests are the synthetic baseline and are
not repeated here as native-adapter evidence.

Commands and results from this checkout:

| Command | Result |
| --- | --- |
| `npm run build:native` | passed; emits the offline fictional frontend only and does not add a vault adapter. |
| `cargo test --manifest-path src-tauri/Cargo.toml --example windows_key_release_probe` | 19 passed, 0 failed. Fixed-record Software KSP envelope tests only; no grocery store integration. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 9 passed, 0 failed. Existing native preview/session tests only. |
| `cargo build --manifest-path src-tauri/Cargo.toml --example windows_key_release_probe` | passed after pinning `windows-future` 0.3.2 to match `windows` 0.62.2. A fresh checkout previously failed because 0.100.0 introduced incompatible `windows-core` types; this was a build defect, not evidence about a grocery adapter. |
| `node --test test/grocery-persistence.test.js test/portable-vault-backup.test.js` | 31 passed, 0 failed |
| `node --test test/windows-grocery-persistence.test.js` | 3 passed, 0 failed, 0 skipped on Windows; includes DPAPI reopen/retry and eight injected fault cases |
| `node --test test/grocery-persistence.test.js test/windows-grocery-persistence.test.js test/portable-vault-backup.test.js` | 34 passed, 0 failed, 0 skipped on this follow-on worktree; Windows 10.0.26300 (Windows 11 Home per the host record above), Node.js v24.19.0, PowerShell 7.6.9. Synthetic probe/contract evidence only. |
| `node --test test/windows-grocery-persistence.test.js test/windows-record-revisions.test.js test/windows-portable-backup.test.js test/vault-store-lifecycle.test.js test/portable-backup-enrollment.test.js` | 11 passed, 0 failed, 0 skipped on Windows |
| `npm test` | 405 passed, 0 failed, 0 skipped |
| `git diff --check` | passed |

Attended local compatibility check (not grocery or production qualification):
on Windows 11 Home x64, version 10.0.26300 build 26300, source commit
`014d99d8a43619240e4a7613904e2c3cbf69ead9`, executable SHA-256
`678ab78152abc7ecdf8848d07e361b80db3278fed7dd2fb89ec83d256812c2a9`, the
disposable Software KSP envelope runner completed `--envelope-attended-prepare`
with exit 0 (`PREPARED_NOT_RESTART_VERIFIED`), including an OS-owned
high-protection dialog and fictional envelope creation. A fresh process ran
`--envelope-check-locked` with exit 0 and denied silent decryption. Its
`--envelope-attended-verify-restart` step returned exit 1,
`cold-restart-not-observed`, before prompting because this check had not
observed a Windows restart. This is local operator-attended compatibility
evidence only; it does not establish restart recovery, key lifecycle, app
integration or grocery durability. The disposable key and envelope are being
removed in the explicit cleanup step; no password or key material is recorded.

The full suite and focused suites ran on the Windows host above. The Ubuntu
GitHub Actions job skips Windows-only tests; this PR adds a separate
`windows-2025` `Windows grocery probe` job that records its Windows, Node and
PowerShell versions and runs `node --test
test/windows-grocery-persistence.test.js`. Its result is reported separately
from the local evidence above. On PR #212 head
`498972e9715da40d29c77fc099c63a274a29e734`, the hosted job passed 3 tests with
0 failures and 0 skips on Microsoft Windows Server 2025 Datacenter 10.0.26100
(build 26100), runner image `windows-2025-vs2026` version `20261030.294.1`,
Node.js v24.22.2, and PowerShell 7.6.9. Its exact command was
`node --test test/windows-grocery-persistence.test.js`. GitHub-hosted checks on PR #206 ran against head
`2f05f8d78cc6a7ab92a8cb13d410e4fe42c8a239`: `test`, `authorize`, and
`vigil / review` succeeded. Those checks predate this follow-up matrix and do
not qualify its additions.

## Reviewer decision record and remaining qualification gates

PR #206 was approved by member reviewer `F2iProject` and automated reviewer
`vigil-reviewer` at `2f05f8d`. Vigil recorded six of seven specialists
approving; Conformance did not run because no governing specification was
provided. The issue-206 source change was merged by GitHub as merge commit
`02364929250e1ea8a81dcafceebfd00bf9aff82e` at 2026-11-03 03:21 UTC. These
decisions apply to that merged head only.

Vigil reviewed PR #212 at commit `498972e9715da40d29c77fc099c63a274a29e734`
and returned **APPROVE**: six of seven specialists approved, with no findings;
Conformance did not run because no governing specification was supplied. The
review created non-blocking observations #218 (the fault names are intentionally
validated independently by the JavaScript caller and PowerShell worker so both
process boundaries fail closed) and #219 (stale counts in the PR description).
The matrix counts match the recorded commands; the PR description is updated
with those counts and the hosted Windows result. This is a commit-scoped review
record, not an approval of later changes.

The first adapter/platform and compatible key-method direction are recorded
above. The work still requires implementing `WindowsSnapshotFileStore v1`,
reviewing a governing conformance specification, and rerunning this
exact-version matrix against that adapter. The selected separate-password
method is not Windows-account authentication and makes no TPM-backed claim.
Android requires a separate adapter and independent qualification before it is
added to supported platforms. Backup/restore and schema rollback remain under
#10; isolation review remains under #151. Live issue states verified
2026-11-03: #6 OPEN (reopened after GitHub auto-closed it on PR #220 merge),
#10 OPEN, #151 OPEN, and #141 OPEN. PR #220 merged at decision head
`cf202a2af161aae0a84c6f867db1991282631340` as merge commit
`a5d1c95b634cfb01ae849c8bd9de66f50c0682ac`; this follow-on did not merge or
close any acceptance issue.
