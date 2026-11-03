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

The qualification targets to resolve are Windows 11 desktop and Android
phone: the README names Android as the first mobile target, and the roadmap
names Windows 11 as the first desktop candidate. This is the intended target
plan for adapter selection, not a compatibility or release-support claim.
Production platform adapters are **not selected**:

| Target | Named implementation under test | Production decision and qualification |
| --- | --- | --- |
| Windows 11 desktop | `WindowsProbeStore v2`: `lib/windows-probe-store.js` + `scripts/windows-vault-worker.ps1`, DPAPI `CurrentUser`, encrypted `records.bin`, flushed same-directory temporary ciphertext and `File.Move` replacement | Developer-only synthetic probe. Not the production adapter; production key release, location, crash durability, recovery and hostile-process boundary remain unselected/unqualified. |
| Android phone | No grocery persistence adapter exists. Android Keystore plus app-private storage is the existing vault prototype direction. | Candidate only; no adapter implementation or grocery fault/restart qualification. Keystore provider/hardware level and file replacement semantics are not selected. |

No other platform is claimed. In particular, Android emulator or native-shell
tests elsewhere in the repository do not qualify grocery persistence.

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

Commands and results from this checkout:

| Command | Result |
| --- | --- |
| `node --test test/grocery-persistence.test.js test/portable-vault-backup.test.js` | 31 passed, 0 failed |
| `node --test test/windows-grocery-persistence.test.js` | 2 passed, 0 failed; includes Windows DPAPI reopen/retry and eight fault cases |
| `node --test test/windows-grocery-persistence.test.js test/windows-record-revisions.test.js test/windows-portable-backup.test.js test/vault-store-lifecycle.test.js test/portable-backup-enrollment.test.js` | 9 passed, 0 failed at the time of this focused run |
| `npm test` | 404 passed, 0 failed, 0 skipped |
| `git diff --check` | passed |

The full suite ran on the Windows host above. GitHub-hosted checks on PR #206
ran against head `2f05f8d78cc6a7ab92a8cb13d410e4fe42c8a239`: `test`,
`authorize`, and `vigil / review` succeeded. Those checks predate this follow-up
matrix and do not qualify its additions.

## Reviewer decisions and remaining gates

PR #206 was approved by member reviewer `F2iProject` and automated reviewer
`vigil-reviewer` at `2f05f8d`. Vigil recorded six of seven specialists
approving; Conformance did not run because no governing specification was
provided. The issue-206 source change was merged by GitHub as merge commit
`02364929250e1ea8a81dcafceebfd00bf9aff82e` at 2026-11-03 03:21 UTC. These
decisions apply to that merged head only.

Vigil approved this matrix/test follow-up at commit `9278ae9`: six of seven
specialists approved, with no findings; Conformance did not run. Testing
recorded two non-blocking observations, tracked in #213 (assert the generic
simulator boundary) and #214 (negative coverage for fault-hook validation).
This revision adds the requested candidate-payload assertions and negative
tests. The approval and observations above apply to `9278ae9`; they do not
pre-approve later commits. A member review and governing conformance decision
remain pending.

Before adapter/platform qualification, reviewers still need to select the
production implementation for Windows and Android, decide whether both remain
supported targets, approve a governing conformance specification, and review
the exact-version matrix including the unsupported cases above. Issues #6,
#10 and #151 remain open.
