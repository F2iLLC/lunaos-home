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
Windows 11 Home is the first edition being qualified within that target: the
owner directed selection of an unlock method compatible with this PC, which
reports Windows 11 Home, build 26300, and a ready TPM 2.0. The selected
key-release method and its non-claims are stated once, in the
[Windows key-release assessment](#windows-key-release-assessment-2026-11-03)
below.

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

**Selected method.** PDE cannot qualify on the observed Windows 11 Home
edition, so the owner selected the local-compatible route: the Microsoft
Software KSP, under CNG's high-protection policy that requires provider UI for
protected-key use, with a separate vault-key password entered only in that
OS-owned dialog. Microsoft documents asymmetric (RSA) encryption in the
Software KSP and the high-protection UI policy; see the
[CNG KSP list](https://learn.microsoft.com/en-us/windows/win32/seccertenroll/cng-key-storage-providers)
and [NCRYPT UI policy](https://learn.microsoft.com/en-us/windows/win32/api/ncrypt/ns-ncrypt-ncrypt_ui_policy).
This is a separate vault-password method. It does not bind release to Windows
sign-in, Windows Hello or the TPM, and makes no TPM-backed claim. The app must
not collect or persist the password, and neither DPAPI `CurrentUser` nor an app
prompt is a fallback release method. The earlier disposable experiment observed
the OS-owned dialog on this PC; it is compatibility evidence only, not
implementation or qualification evidence. The production integration, attended
lifecycle evidence and review remain outstanding.

Android remains an intended follow-on platform, with an eventual native
`AndroidSnapshotFileStore` using Keystore and app-private no-backup storage.
Android 16/API 36 emulator and Android 17/API 37 physical-device combinations
are qualification targets only; the minimum supported Android release,
Keystore requirements and file commit behavior are not selected. Android is
not in the first production-support scope. No other platform is claimed.

| Target | Intended production adapter / implementation under test | Decision and qualification |
| --- | --- | --- |
| Windows 11 x64 desktop (first edition: Home) | Selected target/design: `WindowsSnapshotFileStore v1` (native Tauri/Rust, encrypted whole-record snapshot) using Microsoft Software KSP high-protection UI and a separate vault-key password; **not implemented**. Existing evidence: `WindowsProbeStore v2` in `lib/windows-probe-store.js` + `scripts/windows-vault-worker.ps1`, DPAPI `CurrentUser`, `records.bin`, flushed same-directory temp and `File.Move`. | Key-method direction selected for this PC; adapter integration and operator-run key lifecycle evidence remain open. KSP key loss/password loss locks the snapshot until the separately reviewed VLT-07 recovery route (portable backup and recovery, #10) succeeds. Probe remains developer-only. Production path/ACLs, hard-crash durability, recovery and hostile-process boundary remain open. |
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

Results are scoped to the commit they were recorded at; test counts change as
tests are added, so re-run a command rather than trusting an old count. The
Node.js rows were re-run at `37ee2c4` (`main` after #222) on the host above;
the Rust rows were recorded during #222 and have not been re-run.

| Command | Result |
| --- | --- |
| `npm run build:native` (recorded during #222) | passed; emits the offline fictional frontend only and does not add a vault adapter. |
| `cargo test --manifest-path src-tauri/Cargo.toml --example windows_key_release_probe` (recorded during #222) | 19 passed, 0 failed. Fixed-record Software KSP envelope tests only; no grocery store integration. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` (recorded during #222) | 9 passed, 0 failed. Existing native preview/session tests only. |
| `cargo build --manifest-path src-tauri/Cargo.toml --example windows_key_release_probe` (recorded during #222) | passed after pinning `windows-future` 0.3.2 to match `windows` 0.62.2. A fresh checkout previously failed because 0.100.0 introduced incompatible `windows-core` types; this was a build defect, not evidence about a grocery adapter. |
| `node --test test/grocery-persistence.test.js test/portable-vault-backup.test.js` | 31 passed, 0 failed |
| `node --test test/windows-grocery-persistence.test.js` | 3 passed, 0 failed, 0 skipped on Windows; includes DPAPI reopen/retry and eight injected fault cases |
| `node --test test/grocery-persistence.test.js test/windows-grocery-persistence.test.js test/portable-vault-backup.test.js` | 34 passed, 0 failed, 0 skipped. Synthetic probe/contract evidence only. |
| `node --test test/windows-grocery-persistence.test.js test/windows-record-revisions.test.js test/windows-portable-backup.test.js test/vault-store-lifecycle.test.js test/portable-backup-enrollment.test.js` | 11 passed, 0 failed, 0 skipped on Windows |
| `npm test` | 375 tests: 368 passed, 7 failed, 0 skipped. All 7 failures are JVM tests that need `javac`, which this host lacks (`spawnSync javac ENOENT`); none is a grocery or vault test. The 405-pass figure recorded during #222 was not reproduced. |
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
integration or grocery durability. Cleanup is complete: after the operator's
typed `begin`, the runner's explicit cleanup step (`--envelope-cleanup`)
exited 0 and recorded `disposable-key-and-envelope-removed` and `PASS` for
the same source head and binary (recorded 2026-11-03 in `756c6db`). No
disposable Software KSP key or envelope from this check remains on the host. No
password or key material is recorded.

The Ubuntu GitHub Actions job skips Windows-only tests. The separate
`windows-2025` `Windows grocery probe` job in `.github/workflows/test.yml`
records its Windows, Node and PowerShell versions and runs
`node --test test/windows-grocery-persistence.test.js` on every pull request and push to `main`;
its per-run results live in GitHub Actions, separate from the local evidence
above. Hosted runners use Windows Server 2025, not Windows 11 Home, so they
corroborate the probe but do not exercise the target edition.

## Remaining qualification gates

Per-commit review and approval history belongs to the pull requests that
produced this record (#206, #212, #220, #221, #222), not to this document.

The first adapter/platform and compatible key-method direction are recorded
above. The work still requires implementing `WindowsSnapshotFileStore v1`,
reviewing a governing conformance specification, and rerunning this
exact-version matrix against that adapter. The selected separate-password
method is not Windows-account authentication and makes no TPM-backed claim.
Android requires a separate adapter and independent qualification before it is
added to supported platforms. Backup/restore and schema rollback remain under
#10; isolation review remains under #151. Durable persistence acceptance
remains under #141, and key custody and unlock under #6; check those issues for
their current state.
