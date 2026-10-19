# Windows visit gate for the protected-record transport

This dependent Session 2 increment joins the existing Windows native verification
gate to the direct TLS protected-record host. It does not replace the native
verification protocol, accept a remote `verified` flag, or make DPAPI key release
dependent on Windows Hello. The unchanged native child still obtains a trusted
OS result and monitors its window/session/power lifecycle. The supervisor reads
only that owned child's private output pipe.

## Enforcement boundary

`startWindowsVerifiedDirectHost` composes the existing native gate, local
enrollment controller, TLS service and supplied storage adapter. The shared
record service calls the gate's synchronous `requireVerified` check when issuing
a record grant, before enqueueing an operation, when queued work runs, and after
a read completes. A confirmed write still uses the existing applied/unknown
contract; closing a socket before its receipt reaches the client reports UNKNOWN.

Pairing authenticates a device and is deliberately distinct from the Windows
visit and record scope. An admitted TLS connection cannot read or obtain a grant
before native verification. A reconnect during an open visit needs a new grant.
Ending the visit clears enrollment reviews, closes the TLS listener/sockets,
invalidates grants and queued work, ends the local preview, and stops the owned
child. Replaying receipts cannot reopen the ended gate. A fresh supervisor visit
requires new verification, pairing and record approval.

The gate retains its three-minute verification deadline and five-minute verified
visit. It checks monotonic elapsed time on access even when the timer callback
has not fired. Cancellation, unavailable monitoring, invalid/reordered/duplicate
receipts, stdout EOF/error, child error/exit and either deadline close access.
The existing Rust monitor translates lock, session and power events to the same
session-ended receipt; no new event simulation is registered in production code.

The native window for this connection experiment displays a fixed informational
page only. It has no unrelated record buttons, record API or verification action.
Only the exact GET `/windows-vault` path is served, with no-store and restrictive
CSP headers. Native URL/navigation restrictions and private URL delivery remain
unchanged. Receipt-driven closure removes the temporary HTTP listener without
waiting for the child exit event. Startup failure does not issue a verification
URL.

## Reproduce without an OS prompt

```powershell
node --test test/windows-verified-direct-host.test.js test/windows-native-gate.test.js
```

Tests supply a **controlled child/event source**, use real local TLS sockets,
and use the actual Windows DPAPI adapter in protected-store cases. They do not
invoke Windows authentication or prove current live lock/sleep delivery.

Observed checks include:

- Pair before verification: no grant/read; monitor readiness alone grants nothing.
  After a controlled verified receipt, selected read works and read-only edit
  fails. Reconnect rejects the old grant; end denies reconnect and late receipts.
- Cancellation/monitor/pipe/child failures, malformed receipts and both timeouts
  close access. Elapsed expiry and invalid clock deny access before timer delivery.
- A real DPAPI-decrypted read is held at the adapter return boundary. An accepted
  queued edit waits behind it. Session end withholds the read, prevents the edit,
  and leaves the committed record unchanged.
- A real DPAPI edit commits before a held acknowledgement. Session end yields
  UNKNOWN at the TLS client, with exactly one write and no replay. A new controlled
  visit, pairing and fresh read-only grant read the committed result from the
  reopened encrypted store. No physical power-loss claim is made.
- A deadline reached after reading suppresses returned contents. Launcher tests
  show the informational page, refuse a fabricated HTTP verification request,
  close HTTP/TLS on pipe end, and refuse a child that exits during startup.

## Attended native path — not executed in this increment

Build this checkout's native Windows debug target using the repository's native
build/toolchain instructions. Retain the dedicated emulator/debug-keystore
requirements from [the protected-record experiment](enrolled-protected-record.md).
From an attended Windows terminal:

```powershell
node scripts/test-android-direct-tls.mjs <new-output-directory-outside-repo> <debug-keystore> --protected-gui --interactive-host --native-verification
```

The launcher refuses an unattended terminal and loads only this checkout's fixed
debug binary path. Complete verification in the trusted Windows prompt, then
compare identities and approve the selected read in the local terminal. No PIN
or password is requested by the script. Native verification alone grants no
record access. Closing the window, cancelling verification or an ended visit
fails closed; no automatic retry or alternate verification signal is used.

The recorded validation does **not** include this attended native-child → Windows
prompt → Android GUI chain. The original native prompt acceptance remains
evidence for its tested revision only. Current live OS cancellation, lock, sleep,
resume and five-minute expiry with Android need attended acceptance. New Android
device compatibility is not claimed: this increment changes the Node supervisor
and service, not the Android APK or Rust monitor. A frontend bundle build is not
a new native binary or OS acceptance result.

Production enrollment/durable trust, physical networking, recovery and independent
security review remain open. This is an application access gate around CurrentUser
DPAPI, not authentication-bound cryptographic key release. Actions stays disabled;
the offline Home networking boundary and personal phone are unchanged.

## Validation for this increment

All 108 Windows-compatible Node tests passed, including the eight new real-socket
composition/launcher cases and the existing native-gate cases. The offline
frontend bundle built successfully. Linux-only container checks remain
platform-limited. No native authentication prompt, Windows lock/sleep action,
Android launch or personal-phone action was performed. This is controlled-event
and actual TLS/DPAPI evidence, not a live OS acceptance result.
