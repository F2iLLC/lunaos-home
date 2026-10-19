# Attended Windows lifecycle and physical Android connection

On October 18, 2026 (America/Chicago; October 19 UTC), a Samsung SM-S938U running
Android17/API37 read a fictional record from a reopened Windows CurrentUser DPAPI
store over native mutually authenticated TLS1.3 on the local Wi-Fi network.
Separate visits verified real Windows lock and brief S3 sleep/wake. Both ended
host access, and the phone could not reconnect or cause another store read.

## Boundary and reproduction

This is a separate disposable test APK, not a network permission added to Home.
The existing emulator runner remains restricted to its named API36 AVD. The
physical runner requires explicit adb target, exact model/API and an assigned
private IPv4 host address. It refuses to replace an installed probe. An app-private
opt-in must match the physical model/API before the UI or non-destructive identity
instrumentation can run. Destructive identity/race instrumentation retains its
emulator restriction. No household record or Home package/file is accessed.

```powershell
node scripts/test-attended-physical-vault.mjs <new-output-outside-repo> <debug-keystore> <explicit-adb-target> <exact-model> <api> <host-private-ipv4> lock
node scripts/test-attended-physical-vault.mjs <another-new-output> <debug-keystore> <explicit-adb-target> <exact-model> <api> <host-private-ipv4> sleep
node scripts/test-attended-physical-vault.mjs <third-new-output> <debug-keystore> <explicit-adb-target> <exact-model> <api> <host-private-ipv4> expiry
node scripts/test-attended-windows-cancel.mjs <fourth-new-output-outside-repo>
```

Only the separate TLS listener binds to the explicitly supplied private address;
its default remains loopback. Public/wildcard addresses and hostnames are refused.
The native informational HTTP page stays loopback-only. There was no adb port
forward/reverse, public tunnel, cloud relay, firewall-rule change or network-profile
change. Wireless adb only controlled the test phone; record traffic used the
explicit LAN endpoint. The fixture TLS server name remains `localhost` (certificate
name, not route); CA validation, hostname validation and exact host fingerprint
remain enforced, and the client authenticates with its Android Keystore identity.
The fixture certificate and short-lived offer are provisioned through debug tools,
so this is not production pairing or durable trust establishment.

The user completes verification only in the trusted Windows prompt. The assistant
compares the exact on-screen synthetic identities and approves the fixed
Alex/Library visit read-only scope; it drives the Android buttons. After the first
read, the runner requests the physical lock or sleep action. It requires the
owned native child's exact bounded `lock` or `suspend` event and the ended gate;
window close or a simulated event cannot satisfy that assertion. A follow-up
review found that the original runner could accept a native event after the
60-second read grant had already expired. The revised runner records monotonic
time before issuing the grant and accepts the event only if it arrives during
that 60-second window. A boundary test rejects the deadline and later events.
The original lock/sleep results did not record this interval, so they show that
the native event ended the Windows visit but do not by themselves prove that it
ended an active read grant. Fresh attended lock and sleep runs measured and passed
that narrower criterion, as recorded below.
These stderr labels are evidence only and cannot authorize a record operation.

For sleep, after waking/unlocking, type `back` in the test terminal. This is only
readiness acknowledgement. The actual suspend event is still mandatory. The
runner waits for read-only adb readiness, then tests the old visit and denied
reconnect. It never retries a record write or issues a new grant after resume.

## Observed results

| Check | Observed result |
| --- | --- |
| Physical LAN read | Each final run read `Library visit: Thursday from protected storage` from the reopened encrypted Windows store. One store read and zero remote writes per run. |
| Windows lock | Native `lock` event at 02:50:42.714 UTC ended the visit. Subsequent phone checks showed no content, disabled read and denied reconnect, with no second storage read. |
| Windows sleep/wake | Native `suspend` at 02:59:59.999 UTC ended the visit. Windows System Kernel-Power events 42 and 107 independently report suspend at 03:00:00.043 and resume at 03:00:01.645 UTC. This was a brief S3 cycle, not extended sleep. |
| After wake | The phone's read control was already closed when inspected. No content remained, reconnect was denied and no additional store access occurred. We do not attribute immediate display clearing to the host event: the phone's own 60-second display/grant timer could expire during the attended wait. |
| Persistence | Original encrypted bytes were unchanged after each event. No write or automatic replay occurred. The sleep run's new verified visit successfully read after the earlier lock run; old visits stayed unusable. |
| Identity | The phone reported generated, non-exportable EC identity, null key encoding/format and security level 1. This is provider-reported custody, not independent hardware attestation. Transport identity is separate from vault unlock and is not itself user-authentication-bound. |
| Cleanup | Both successful runners exited zero with cleanup passing. The temporary test APK, owned host/native child and synthetic store were removed. Package absence and absence of the final test listeners were independently checked. |
| Verification cancellation | A separate attended Windows run received the native `canceled` status at 03:11:47.717 UTC. The gate stayed closed, the listener refused a connection, and no record was read or written. This did not use the physical Android client. |
| Five-minute visit expiry | A new Windows-verified visit served one fictional read over physical Wi-Fi. The Windows gate remained verified after the phone's 60-second grant expired, then closed 299,755 ms after verification was observed. No native lifecycle event was collected; the old read was closed, no content appeared, reconnect was denied, and reads/writes remained 1/0. Cleanup passed. |
| Timed lock during active grant | A fresh `lock` receipt arrived 36,302 ms after grant issuance, before its 60-second deadline. The phone's still-enabled old read was attempted and denied, content cleared, reconnect was denied, and reads/writes remained 1/0. Cleanup passed. |
| Timed sleep during active grant | A fresh `suspend` receipt arrived 26,504 ms after grant issuance, before its 60-second deadline. After wake, the phone's old read was closed, content remained clear, reconnect was denied, and reads/writes remained 1/0. Cleanup passed. This was another brief sleep, not extended-sleep evidence. |

Windows binary SHA-256:
`1be4ce154ed76ba63d8728535d502975bf58986d20ad1fa006fdecc752fa0972`.
It is the freshly built binary from the preceding attended run; Rust/native monitor
source did not change in this follow-up.

Final lock APK SHA-256:
`57b3bf99e91073c1425e3f2be8815a5bd772852cb267308a09ba6ebf46fc6221`.
Final sleep APK SHA-256:
`cd47876ae8e4b10a4c2e0f7c236603073befab86f53cca63bcb2601b065385ad`.
APKs include per-run disposable public CA material, so hashes differ. Local raw
evidence remains outside Git in `physical-lock-v3` and `physical-sleep-v4`; only
synthetic summarized results are published.
The cancellation and expiry results remain outside Git in `windows-cancel-v2`
and `physical-expiry-v1` respectively. The expiry APK SHA-256 is
`b32db919fe4058ecef3b1e6a5f6dd50371febb901924e9e313dcb90f56e19f99`.
Timed lock and sleep evidence remains outside Git in `physical-lock-timed-v2`
and `physical-sleep-timed-v2`. Their APK SHA-256 values are respectively
`567983ce3d418b5acec9664659e31fc4e37e26c42aadff3d7863c18223bddf94`
and `00e5a75ae6604abf5b9557e167ee5da825cb3d474d25fbd1c2171a198259597a`.

Earlier attempts are not counted as passes: the first preflight rejected an
adb-formatted model alias; initial physical setup lacked the app-private config
directory; Samsung's foreground field was absent from the emulator-specific
window dump; a verification prompt expired; a wireless adb connection dropped;
and one actual suspend ended the host correctly but the phone observation timed
out while the network recovered. The harness now uses Samsung's full window
focus field (retaining only test-app UI nodes), creates its own config directory,
and waits for post-resume acknowledgement/readiness. No authentication gate,
grant deadline or event assertion was relaxed.
One timed lock retry had no user action before its observation timeout; one timed
sleep retry lost its phone connection before approval. Neither is counted as a pass.

## Validation and remaining work

All 110 Windows-compatible Node tests passed, including refusal of public/wildcard
test bindings and bounded lifecycle-event collection that cannot verify the gate.
Both actual phone APK builds and successful runs exercised the modified Java
sources. Existing TLS negative tests still require certificate, hostname, pin,
pairing and record authorization. Linux-only container checks remain platform-limited.

These results show local-network access and native visit closure on lock/sleep on
this one phone and PC, including events during an active read grant.
They do not complete Session 2 or production acceptance. Live cancellation with
the physical client, extended sleep,
network roaming/interruption, phone-hosted operation, production enrollment,
recovery and independent security review remain open. DPAPI remains CurrentUser
encryption with an application presence gate, not authentication-bound key release.
Actions remains disabled; no merge or deployment is implied.
