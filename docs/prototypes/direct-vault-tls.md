# Synthetic direct TLS and reconnect experiment

Session 2 / issue #14. This module is deliberately separate from Home's HTTP preview, MCP tools, native shell and Android manifests. The host binds only to `127.0.0.1`, uses an in-memory synthetic store in tests and is not a production bridge or encrypted-at-rest vault. A separate disposable Android instrumentation package exercises the same host through the emulator's host-loopback alias. No public listener, relay, discovery, firewall change or real record is introduced.

## Transport and approval boundary

`lib/direct-vault-tls.js` uses Node's maintained OpenSSL-backed `node:tls` implementation with TLS1.3, mutual certificate authentication, explicit CA trust, normal server hostname verification and an additional locally approved SHA-256 certificate fingerprint. The host derives the peer ID from the verified certificate, never from a remote `deviceId`. Session resumption is refused. No custom encryption or key exchange is implemented. See [Node TLS](https://nodejs.org/api/tls.html) and [OpenSSL certificate tooling](https://docs.openssl.org/3.5/man1/openssl-req/).

The privileged local host controller approves an exact peer fingerprint, creating a random, single-use pairing offer with a bounded lifetime. The client separately requires the approved host fingerprint. The test harness represents these explicit decisions for disposable identities; this is **not** completed two-device identity-comparison UX or permission to approve a real family's pairing on their behalf. Trust distribution, hardware/private-key custody, renewal and durable enrollment are not implemented.

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

`scripts/android-direct-tls-probe` is a separate self-targeted instrumentation APK with `INTERNET`, `testOnly`, no backup, no cleartext and no activity/service/provider. It does not modify or instrument Home. Native Java uses Android's standard `SSLContext`, `KeyManagerFactory` and `TrustManagerFactory`, requires TLS1.3, enables HTTPS endpoint identification and checks the separately approved host certificate fingerprint. There is no permissive trust manager or WebView key path. See [Android endpoint identification](https://developer.android.com/reference/javax/net/ssl/SSLParameters#setEndpointIdentificationAlgorithm(java.lang.String)).

The APK connects only to `10.0.2.2`, the documented [Android emulator alias for host loopback](https://developer.android.com/studio/run/emulator-networking), with the TLS host name `localhost`. It uses no ADB reverse, external relay or physical network configuration. This demonstrates an actual Android-native socket to the Node host, **not physical phone/LAN reachability or a Home GUI integration**.

`scripts/test-android-direct-tls.mjs` checks the exact `HomeVaultAcceptance_API36` AVD on `emulator-5556`, `ranchu` hardware and unlocked user state. It refuses an existing probe install. The native probe independently requires `ranchu`. The harness generates a new private test CA and disposable PKCS12 client identity, builds into a new directory outside the checkout, approves only that exact fictional identity and one fixed read-only scope, executes the probe, checks host-side counts, removes its package and closes the listener. Temporary CA/leaf source files are removed. The retained build APK/assets contain disposable one-day test identity material and must never be used as production keys or distributed as a product.

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

The next implementation is native identity custody and enrollment/selected-scope screens in an explicit network-enabled prototype, followed by connection to the encrypted storage adapter. These are implementation work, not a request for the owner to build adapters. Physical private-network reachability, sleep/suspension and truthful unknown-write UI still need their own checks. Pairing enrollment, native storage/key custody, OS unlock and grants are distinct acceptance boundaries. Recovery, production PKI and independent sensitive-use review remain open. No Session 2 completion, merge, deployment or Actions enablement follows from this evidence.
