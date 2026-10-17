# Windows visit termination on session and power events

This debug-only follow-up to [native verification](windows-native-vault.md) ends a fictional visit when Windows reports lock, unlock, logoff, console/remote disconnect, remote-control change, suspend or resume. End-session and native-window destruction also close it. Unlock/resume never restores a grant: reopen the launcher and complete fresh OS verification and workflow/disclosure approvals.

## Implementation boundary

On the native HWND's UI thread, Home registers [WTS session notifications](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsregistersessionnotification) for **this session only**, registers [suspend/resume notifications](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registersuspendresumenotification), and installs a [window subclass](https://learn.microsoft.com/en-us/windows/win32/api/commctrl/nf-commctrl-setwindowsubclass). All three steps must succeed before a monitor-ready receipt precedes OS verification. Failure closes the process with no fallback access. Partial registration failure unregisters resources already acquired. Window destruction unregisters both notifications; final destruction removes the callback before releasing its owned context.

The monitor and OS-verification completion share a synchronized state. Ended cannot return to ready or verified. On a terminal event the native window is hidden and the application exits; the private pipe tells the supervisor to shut down the common GUI/assistant service. The supervisor requires monitor-ready **then** verified, handles split/coalesced pipe messages, and rejects missing, reordered, duplicate or unexpected receipts. Pipe/process failure and existing visit timeouts still close access. An old binary without the monitor-ready receipt fails closed; rebuild the executable when updating this source.

Revocation takes effect when the supervisor receives the event or child exit; this does not establish instantaneous cross-process revocation before Windows changes state. A read still pending at revocation is withheld, queued writes are denied, and an already committed write returns a receipt with access ended rather than a fictitious rollback. Previously disclosed information cannot be erased from an assistant. The gate remains an application control, not authentication-bound DPAPI key release or protection from a hostile same-account process. Silent notification-delivery failure, real sleep timing and platform-specific standby behavior remain physical acceptance questions.

The code never requests machine lock, sleep, shutdown or logoff and never handles authentication input. Diagnostic event labels are fixed strings without account/session identifiers or records. No HTTP/MCP endpoint can inject a native event or unlock the gate.

## Verified without locking or suspending the computer

On 2026-10-17 the Windows debug build and nine Rust tests passed. A hidden, owned test window successfully registered both actual Windows notification APIs and its subclass. `SendMessageW` addressed **only that window** with injected lock, suspend and resume messages; each reached the callback and ended the visit, preventing later verification. Invalid-HWND registration failed. Additional state tests cover the other terminal events, broken receipt output and verification/end concurrency. No broadcast message, OS lock/sleep operation or authentication prompt was used by these tests.

All 64 platform-neutral tests passed. Controlled-child tests prove absent monitor readiness denies access, monitor termination during authentication cannot reopen, a shared pending read is withheld, its queued edit does not reach storage, and an in-flight committed write returns an ended receipt without retry. These are injected events/controlled races, **not real Windows lock/sleep evidence**. Earlier real verification/cancellation and encrypted-record evidence remains recorded separately in the native guide; the human prompt has not been repeated with this monitor revision.

## Separate human test, pending

After rebuilding as in the native guide, with the person ready and their work saved:

```powershell
node scripts/probe-windows-native-vault.mjs --lock
# In a separate run:
node scripts/probe-windows-native-vault.mjs --sleep
```

For each run, the person completes the trusted Windows verification prompt. The harness creates only its own fixed synthetic examples, then prints that it is ready for the person to lock/unlock or sleep/resume Windows. It does not perform that action. Do not merely close the Home window. The requested lock/suspend notification must be observed along with the session-ended receipt; window closure or timeout does not pass. The harness checks old GUI/assistant reads are denied and removes its own fixture/process/server. These modes are prepared, **not yet run**.

For retained-record restart coverage, separately run the interactive launcher, add both examples, note its resume command locally, then manually lock/unlock or sleep/resume. Resume that same synthetic example using the printed ID. Confirm a new Windows prompt is required before new approvals, then read both records. Keep any old capabilities out of assistant messages and public artifacts. Verify that old connections/grants never regain access. The human must operate Windows verification; the assistant must not substitute credentials or claim an injected test passed this step.

Session 2, Android approval, pairing/recovery and independent native acceptance remain open. Actions stays disabled; no merge, deployment or binary distribution.
