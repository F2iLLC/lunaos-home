# Synthetic direct TLS and reconnect experiment

Session 2 / issue #14. This module is deliberately separate from Home's HTTP preview, MCP tools, native shell and Android manifests. It binds only to `127.0.0.1`, uses an in-memory synthetic store in tests and is not a production bridge or encrypted-at-rest vault. No public listener, relay, discovery, firewall change or real record is introduced.

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

## Next native integration

This is real TLS over loopback between Node peers, not an Android GUI or phone/computer round trip. The concrete next adapter must use Android's maintained TLS provider, keep identity keys out of the WebView, implement local host/peer identity approval and selected-scope delivery, then read the same authoritative synthetic record on a disposable Android target. It must be an explicitly separate network-enabled experiment; the existing offline Home variant must retain its no-network boundary.

After that adapter, prove physical private-network reachability, sleep/suspension, reconnect/revocation, and truthful unknown-write UI. Pairing enrollment, native storage/key custody, OS unlock and grants are distinct acceptance boundaries. Recovery, production PKI and independent sensitive-use review remain open. No Session 2 completion, merge, deployment or Actions enablement follows from this evidence.
