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

## Attended native path

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

The attended native-child → Windows prompt → Android GUI chain passed on
2026-10-19 UTC with source `e8d267cd985438541c50f429a61f87fe21043dea`.
The Windows native binary was freshly built from that checkout. The user completed
the trusted Windows prompt; the assistant compared both displayed test identities
and answered the local terminal's fixed fictional scope prompts. The runner drove
the Android controls. This is actual OS verification plus agent-operated test
approval, not evidence of a user manually comparing identities or approving scopes.

Artifacts (SHA-256):

- Windows debug binary: `1be4ce154ed76ba63d8728535d502975bf58986d20ad1fa006fdecc752fa0972`.
- Android probe APK: `dc09e324ffd22f9f9d0dcea0ef164a459d6c342ea96369ce9da13b46220e5142`.

On the dedicated Android16/API36 x86_64 emulator, the real native visit gate
authorized four separate read-only grants and four successful readbacks of
`Library visit: Thursday from protected storage` from the reopened Windows DPAPI
store. There were five read attempts and zero remote writes. Checks covered:

- Initial identity/scope controls closed; interrupted pairing before a grant
  reconnects without replaying the one-use offer.
- End clears the displayed record; reconnect requires fresh selected-read approval.
- Home/background clears content and authority; return requires identity and read
  approval again.
- Force-stop/relaunch preserves the native connection identity but requires fresh
  identity and read approval; the consumed offer is not replayed.
- Damaged encrypted bytes cause the fifth read to fail and clear displayed content.
  The original bytes were restored and a local read confirmed the committed value.

The final run exited successfully, including cleanup of the owned native child,
listeners, synthetic store and probe package. Package absence was checked before
stopping the dedicated emulator. Evidence is retained outside Git in the
`attended-protected-v3` run directory. Two earlier attended attempts ended when
the ten-second local read-approval prompt expired; neither is counted as a pass.
The final run continuously handled those synthetic prompts without changing the
approval deadline, authentication gate or assertions.

This emulator run did not exercise live OS cancellation, lock, sleep, resume or
five-minute expiry. A subsequent [physical-phone test](physical-vault-lifecycle.md)
verified Windows lock and brief S3 sleep/wake; cancellation and five-minute expiry
still need attended acceptance. This run used emulator host-loopback,
not a physical Android network. Its Keystore provider reports software security
level 0; no hardware-backed custody claim is made. No personal-phone action was
performed. The Android APK and Rust monitor source are unchanged by this increment.

Production enrollment/durable trust, broader network/host-direction testing,
recovery and independent security review remain open. This is an application access gate around CurrentUser
DPAPI, not authentication-bound cryptographic key release. Actions stays disabled;
the offline Home networking boundary is unchanged. The later phone check uses a
separate disposable test package.

## Validation for this increment

All 108 Windows-compatible Node tests passed, including the eight new real-socket
composition/launcher cases and the existing native-gate cases. The offline
frontend bundle and subsequent full Windows native debug build passed. The
attended chain above adds real Windows verification and Android emulator evidence
to those controlled-event/TLS/DPAPI checks. Linux-only container checks remain
platform-limited. Live Windows lock/sleep and physical-device network results are
recorded separately, not inferred from this emulator result. Session 2 remains open.
