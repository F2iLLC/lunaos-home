# Fictional phone edit with a revision check

This developer slice extends the existing Home debug connection screen only
when its app-private fixture configuration selects `versioned-edit-v1`.
Ordinary read-only configuration remains read-only. It is not production
enrollment, a general editor or authentication-bound Windows key release.
Only the fixed Alex / Library visit record and the proposal **Friday from
phone** are reachable. No new Android permission, exported component, Tauri
command or remotely callable approval is added.

## Enforcement and failure behavior

The phone reads the version-2 record envelope and retains its opaque revision
in native memory. A separate, privileged host decision grants only `edit` for
that record for up to 60 seconds. It supplies no read, create or delete
authority. The enrollment controller requires explicit `fictionalEdits: true`,
and the transport refuses this grant on a version-1 host. The phone accepts
only the expected grant mode and selected record. The user reviews the fixed
proposal and presses **Save Friday from phone**; the controller never presses
that button or either device's approval controls.

The save sends the originally read revision once. A definite `CONFLICT`
clears the draft and leaves the committed winner unchanged. A missing,
malformed or `WRITE_UNKNOWN` receipt clears authority and reports that the
change is unconfirmed. No retry queue or pending mutation is persisted. End,
backgrounding and restart also remove the cached revision. A fresh connection
inherits no grants; an explicit read with fresh approvals reconciles the
current record. Another save requires a newly read revision and a new local
edit decision. A confirmed save whose access already ended is displayed as
saved with access ended, not as an invitation to retry.

## Prepared attended runner

`scripts/run-attended-home-edit.ps1` takes the inspected APK, selected USB
serial/model/API, private PC address, exact clean source commit and both
SHA-256 build hashes. It refuses source/build drift and creates a unique
external evidence directory. `-PreflightOnly` checks source/build pins without
phone operations or native prompts. The underlying runner independently
requires a Windows terminal and typed `begin`, refuses an existing test
package, checks USB ownership and the exact private listener, and records
counts plus minimized outcomes. All passwords remain in the Windows prompt.
It never restarts the PC.

1. Complete the Windows prompt, compare identities and approve pairing on
   each device. Approve the host read, then wait for
   `PHONE_READ_APPROVAL_READY` before approving the phone read.
2. At the separate host edit prompt, type `edit` only to approve the fixed
   Friday proposal. After `PHONE_SAVE_READY`, review the phone's proposal and
   press **Save Friday from phone**. Do not press other controls early.
3. After the outcome, the runner reconnects without a new pairing offer.
   Approve only the reconciliation read on both devices. No edit is replayed.
4. Require `result: PASS`, the expected counts and `cleanup: PASS`; an initial
   `INCOMPLETE` receipt or component success is not a full passing run.

| Scenario | Controlled condition and required evidence |
| --- | --- |
| `stale-edit` | After the phone read, a simulated competing Windows author commits a newer revision through the same service contract. The phone must send its original revision, receive conflict and leave that ciphertext unchanged. Fresh readback shows the competing value. Two phone reads, one rejected phone edit attempt, zero phone commits, one separately counted competing commit. |
| `write-unknown` | The Windows adapter deliberately loses its receipt after committing one phone edit. The phone must report unconfirmed, close access and require fresh read approvals. Readback shows Friday, with two phone reads, one edit attempt and exactly one phone commit. |

The read grant and native visit remain bounded; a slow or denied approval can
make a run incomplete. The host edit decision is collected before starting
the phone's socket wait. Synthetic cleanup runs after success or failure and
removes only this attempt's test package, registry, store and temporary TLS
identities. Inspect a failed cleanup before starting another attempt.

## Validation boundary

Local tests exercise real loopback TLS for grant separation, wrong connection
and record, expiry, stale conflict, successful conditional save, and lost
receipt/readback. JVM tests execute the actual Java draft state through
duplicate saves, malformed revisions, conflict, uncertainty, End and restart.
Existing Windows DPAPI revision tests cover encrypted reopen and conditional
writes. APK compilation and inspection are separate from attended UI evidence.

No physical stale-edit or lost-receipt result is claimed by preparation.
The second physical rogue phone, shutdown during an active read, guided
enrollment, integrated key custody, recovery and sensitive-use acceptance
remain open. Exact source/build/local/hosted/attended results belong in the PR
and Session 3 handoff; do not close VLT-03 or VLT-05 from this prototype.
