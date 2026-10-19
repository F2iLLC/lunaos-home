# Synthetic direct TLS and reconnect experiment

Session 2 / issue #14. This module is deliberately separate from Home's HTTP preview, MCP tools, native shell and Android manifests. The host binds only to `127.0.0.1`, uses an in-memory synthetic store in tests and is not a production bridge or encrypted-at-rest vault. A separate disposable Android instrumentation package exercises the same host through the emulator's host-loopback alias. No public listener, relay, discovery, firewall change or real record is introduced.

## Transport and approval boundary

`lib/direct-vault-tls.js` uses Node's maintained OpenSSL-backed `node:tls` implementation with TLS1.3, mutual certificate authentication, explicit CA trust, normal server hostname verification and an additional locally approved SHA-256 certificate fingerprint. The host derives the peer ID from the verified certificate, never from a remote `deviceId`. Session resumption is refused. No custom encryption or key exchange is implemented. See [Node TLS](https://nodejs.org/api/tls.html) and [OpenSSL certificate tooling](https://docs.openssl.org/3.5/man1/openssl-req/).

The privileged local host controller approves an exact peer fingerprint, creating a random, single-use pairing offer with a bounded lifetime. The client separately requires the approved host fingerprint. The test harness represents these explicit decisions for disposable identities; this is **not** completed two-device identity-comparison UX or permission to approve a real family's pairing on their behalf. Production trust distribution, physical hardware custody, renewal and durable enrollment are not implemented. The [native identity follow-up](android-native-identity.md) now replaces the APK client-key fixture with device-generated Android Keystore custody.

Pairing admits an identity but grants no records. Only the local controller can approve a selected connection's read-only or setup scope through the existing `createVaultSessionService`. An approval receipt travels over TLS to that client. The network protocol has only pair, resume and execute operations: no admission, approval, arbitrary device ID, assistant destination or disclosure-control endpoint. This client is a local-device experiment; it cannot claim to be an assistant or obtain a hosted-model disclosure grant.

Each socket has a fresh connection ID and connection-bound grants. Disconnect, idle timeout, device removal or shutdown invalidate authority. Reconnect can recognize an already admitted certificate within the same host process, but never restore its old grants. Host restart forgets enrollment entirely. Revoking a peer also removes pending offers and disconnects its sockets.

Frames and outstanding work are bounded; strict schemas reject unknown fields/operations, and monotonically increasing connection-local sequence numbers reject replay. A sent mutation whose response is lost is `WRITE_UNKNOWN`. The client closes that connection and never reconnects or replays automatically. A later connection needs fresh read-only approval to inspect what happened. End cannot undo an already committed write. This is a thin transport contract, not durable exactly-once delivery or stale-edit/version-conflict resolution.

## Reproduce and evidence

Use Node24+ and an installed OpenSSL CLI. Windows tests discover Git for Windows OpenSSL; `HOME_TEST_OPENSSL` may select an explicit executable. Run:

```sh
node --test test/direct-vault-tls.test.js
```

Tests generate fresh EC test keys, a one-day private test CA and purpose-limited leaf certificates in a new OS temporary directory. They never use OS/user trust stores or commit keys. Cleanup verifies the exact generated directory before removing it. OpenSSL is test tooling; no new npm dependency or vendored third-party code is added.

Observed on Windows with Node24.19.0 and OpenSSL3.5.5: fourteen real TLS socket tests pass. They cover two fictional family-member reads after an approval received over TLS; readonly/delete denial; trusted-CA but unapproved peer; stolen/expired/cancelled/replayed offers; wrong host pin/name/CA; absent and independently untrusted client certificates; fresh grants after reconnect; peer/grant revocation and host restart; held-read disconnect/revocation with queued writes; lost acknowledgement after a committed write with one observed adapter call; sanitized adapter errors; idle/unavailable host; and malformed/oversized/spoofed/replayed frames. Malformed-frame tests require server closure before the watchdog, not merely silence.

The Windows-compatible suite passes (96 tests at this increment). An unrestricted `npm test` additionally runs Linux-only Android-container preparation tests; eight failed on this Windows host because that unchanged preparation entry point explicitly requires Linux. Those are not reported as passed or disabled to make this change green.

## Native Android evidence

`scripts/android-direct-tls-probe` is a separate test APK with `INTERNET`, `testOnly`, no backup and no cleartext. Its exported `PairingActivity` is deliberately launchable only as a fictional emulator prototype; it refuses non-`ranchu` hardware. Self-targeted instrumentation provides transport and cancellation checks. It does not modify or instrument Home. Native Java uses Android's standard `SSLContext`, `KeyManagerFactory` and `TrustManagerFactory`, requires TLS1.3, enables HTTPS endpoint identification and checks the separately approved host certificate fingerprint. There is no permissive trust manager or WebView key path. See [Android endpoint identification](https://developer.android.com/reference/javax/net/ssl/SSLParameters#setEndpointIdentificationAlgorithm(java.lang.String)).

The APK connects only to `10.0.2.2`, the documented [Android emulator alias for host loopback](https://developer.android.com/studio/run/emulator-networking), with the TLS host name `localhost`. It uses no ADB reverse, external relay or physical network configuration. This demonstrates an actual Android-native socket to the Node host, **not physical phone/LAN reachability or a Home GUI integration**.

`scripts/test-android-direct-tls.mjs` checks the exact `HomeVaultAcceptance_API36` AVD on `emulator-5556`, `ranchu` hardware and unlocked user state. It refuses an existing probe install. The native probe independently requires `ranchu`. The initial #54 implementation used a disposable PKCS12 client fixture. Its hashes below are historical evidence for that version. The current runner generates the client identity in Android Keystore, transfers only its public certificate for explicit fixture enrollment, and writes short-lived configuration into the app-private no-backup directory after installation. The APK contains only the public host CA asset. See the [current custody and enrollment checks](android-native-identity.md); these debug test packages must not be distributed as a product.

With the dedicated emulator running and unlocked, configure `ANDROID_HOME` and `JAVA_HOME` (tested SDK platform/build-tools37.0.0, JDK21) and use PowerShell7/Node24:

```powershell
node scripts/test-android-direct-tls.mjs 'C:\scratch\new-direct-tls-run' 'C:\scratch\disposable-debug.keystore'
```

The debug keystore must use the standard disposable Android debug alias/password; never pass release credentials. No personal device or credential prompt is used. Host identity and scope decisions here are explicit fixture approvals by the local harness, not completed user-facing consent screens. The local `listConnections()` inspection API exists only on the controller object; it adds no remote discovery/approval operation.

Observed 2026-10-19 UTC on the dedicated Android16/API36 emulator:

| Check | Result |
| --- | --- |
| Android rejects wrong TLS host name | PASS: `SSLHandshakeException` before pairing |
| Android rejects mismatched approved host fingerprint | PASS: `SSLPeerUnverifiedException` before pairing |
| Pair and read Alex's authoritative Monday record | PASS over native TLS1.3 |
| Disconnect and resume | PASS: new connection ID; old grant denied |
| Receive fresh read-only approval and reread same record | PASS; two host reads and two distinct approvals total |
| Edit with read-only grant | DENIED; zero storage writes |
| Host revokes peer | Socket EOF before client timeout; subsequent resume denied |
| Cleanup | Probe uninstalled; listener closed |

Test APK SHA256: `143303c8d265f90cac97f2c9e0a15af520eb03b2a9edfafdb834fd04ec200511`. The bounded host fixture revokes 1.5 seconds after observing the second read; the native client must finish the read-only denial and observe EOF, not a timeout. The host independently requires two reads, zero writes, two approvals and actual revocation. A preliminary locked-at-boot run timed out before instrumentation started; it is not counted as passing, and the runner now checks unlocked state before installation.

## Remaining integration

Native Android identity custody now has a separate [tested follow-up](android-native-identity.md). The next implementation is actual two-device enrollment/host approval and connection to the encrypted storage adapter. The visible fixture approval screen below is not production enrollment or OS unlock. These are implementation work, not a request for the owner to build adapters. Physical private-network reachability, sleep/suspension and truthful unknown-write UI still need their own checks. Pairing enrollment, native storage/key custody, OS unlock and grants are distinct acceptance boundaries. Recovery, production PKI and independent sensitive-use review remain open. No Session 2 completion, merge, deployment or Actions enablement follows from this evidence.

## Separate native approval screen

`PairingActivity` displays the fictional computer fingerprint and fixed Alex/read-only scope. Connect remains disabled until the user approves that computer on the screen. The host independently approves the fixture certificate and sends the fixed scope; receiving it enables a separate **Allow selected read** button, without reading automatically. Only then is **Read Alex's record** enabled. End, background and expiry clear displayed contents and local authority. UI callbacks carry a generation number so late work cannot restore a closed screen. The TLS worker and its queue are bounded. Socket close runs away from the UI thread, independently of a blocked read.

Each explicit Connect first attempts authenticated resume with no grants. If that identity is not admitted, a new TLS connection may consume the existing short-lived, certificate-bound fixture offer. This is not an automatic record retry or fresh enrollment bypass: a revoked identity with a consumed offer still fails. Resume-first allows a cold process restart or a lost pairing response to recover admitted identity without storing/reusing grants or depending on a stale boolean.

This screen is deliberately labeled test-only. The original #54 screen used an APK client-key fixture; the current native-identity follow-up replaces that with Android Keystore. The host counterpart still uses explicit fixture approval in the test controller, not a finished host GUI. It neither substitutes for Android/Windows verification nor claims those gates have been integrated. A revocation is enforced by the host immediately; this simple screen clears previously displayed content on the next attempted read (or End/background/expiry), not through a pushed revocation UI event.

Run the same command with `--gui` to drive the actual native controls and record UI assertions, or `--race` for instrumentation that pauses the real TLS constructor while End is pressed, then proves a fresh connection and read. Both modes use the same exact-AVD guard and cleanup, and keep Home untouched. The UI run intentionally holds host approval after successful pairing, ends that connection, then reconnects; this exercises cancellation after consuming the offer but before receiving a grant.

An initial UI run reproduced `NetworkOnMainThreadException` during TLS close-notify on End. It was not counted as a pass. Closing on a separate thread fixes the source instead of weakening Android StrictMode or the test. Two other cancellation bugs were repaired before final checks: publishing a stale client after End during construction, and relying on pairing history captured before queued work. The generation/lock publication and authenticated resume path address those separately.

Final Android16/API36 visible-screen run: **PASS**, four authoritative reads, four fresh host approvals, zero writes. It checked initially disabled connect/read controls; separate computer and selected-read approvals; End after pairing but before grant arrival; normal End/reconnect; actual Home/background/return; cold force-stop/relaunch; and a refused read with cleared content after host revocation. Foreground departure is observed before reopening, and the screen closes access at `onPause`, including a brief interruption that never reaches `onStop`. Test APK SHA256: `84847c46b4b0577625871a971c60dffa2d93e9debd9b68cf2a33327b5c4b4f0e`.

The separate native race instrumentation also passed: it held the real TLS constructor after certificate verification, pressed End, released the barrier, and proved that a fresh connection, explicit selected-read approval and authoritative Monday read still succeed. One read, one approval, zero writes; APK SHA256 `8f38f46389c2e3a5a30b9925ab6f59f21383d8022de114831be133d38c3c4247`. This is controlled scheduling evidence, not a claim about all lifecycle races. Both runs removed the temporary package and closed their host listener.

After extracting the shared native TLS client for the screen, the original native transport regression passed again: host name/pin rejection, paired read, fresh reconnect approval, stale-grant/read-only denial and peer revocation/denied resume. Two reads, two approvals, zero writes; APK SHA256 `bb1a5f6f3a6f07cbde618ebd92117838d10997745c057b00cb49187e1b053a57`. The final temporary package was removed and the dedicated emulator was stopped.

## Review follow-up

The runner now requires the actual `ro.build.version.sdk` value to equal `36`, in addition to the AVD name and hardware checks. Compilation/dex generation and target preflight happen before creating the one-use offer. Only final asset packaging/signing (bounded to 45 seconds) and installation follow approval; the production 120-second bound and real monotonic clock are unchanged. Long GUI delays can still legitimately expire an offer. The builder exposes Compile/Package stages with an outside-checkout generated-directory marker so the long compilation does not consume the approval window.

Queued-disconnect/revocation tests now wait for a privileged local pending-request count of two: the host has accepted the edit behind the held read. The disconnect test additionally waits for the host to observe closure before releasing that read; local socket closure alone cannot establish when the peer learned about it, so writes remain unknown until reconciled. The transport invalidates grants on the socket's `end` event as well as `close`/error. Both tests observe queue drain and zero writes. The pending-count inspection is not exposed on the wire.

Replay tests cover both adjacent frames and a duplicate sent only after the first pairing response. TCP is allowed to deliver the original valid response before the replay closes the connection; the test requires no second response and server closure before its watchdog. It no longer assumes TCP preserves write boundaries.

After these fixes, all 96 Windows-compatible tests pass. A new actual API36 native transport run through the staged builder passes with two reads, two fresh approvals and zero writes; APK SHA256 `add3e10d75f365136b68febca712ce46d9e992144e71393ab0e2008b8e6dac96`. The unchanged native GUI/race evidence above remains separately identified. Temporary package/listener removed; emulator stopped.
