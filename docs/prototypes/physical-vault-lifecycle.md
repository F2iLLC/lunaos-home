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

The runner rejects an unsupported `network` event before device setup. A prior
argument list accepted that name but skipped the interruption checks, so such a
run could have reported a false pass after an ordinary read. No network-loss or
roaming result is counted from that path; a dedicated physical scenario must
observe the disconnection and recovery before this acceptance check can pass.

```powershell
node scripts/test-attended-physical-vault.mjs <new-output-outside-repo> <debug-keystore> <explicit-adb-target> <exact-model> <api> <host-private-ipv4> lock
node scripts/test-attended-physical-vault.mjs <another-new-output> <debug-keystore> <explicit-adb-target> <exact-model> <api> <host-private-ipv4> sleep
node scripts/test-attended-physical-vault.mjs <third-new-output> <debug-keystore> <explicit-adb-target> <exact-model> <api> <host-private-ipv4> expiry
node scripts/test-attended-physical-vault.mjs <new-restore-output> <debug-keystore> <explicit-adb-target> <exact-model> <api> <host-private-ipv4> restore
node scripts/test-attended-physical-vault.mjs <new-host-loss-output> <debug-keystore> <explicit-adb-target> <exact-model> <api> <host-private-ipv4> host-loss
node scripts/test-attended-physical-vault.mjs <new-link-reset-output> <debug-keystore> <explicit-adb-target> <exact-model> <api> <host-private-ipv4> link-reset
node scripts/test-attended-physical-vault.mjs <new-wifi-cycle-output> <debug-keystore> <explicit-usb-adb-target> <exact-model> <api> <host-private-ipv4> wifi-cycle
node scripts/test-attended-windows-cancel.mjs <fourth-new-output-outside-repo>
```

Only the separate TLS listener and, for `link-reset`, a disposable byte-forwarding
TCP relay bind to the explicitly supplied private address; the TLS listener's
default remains loopback. The relay does not terminate TLS. Public/wildcard
addresses and hostnames are refused.
The native informational HTTP page stays loopback-only. There was no adb port
forward/reverse, public tunnel, cloud relay, firewall-rule change or network-profile
change. Wireless adb only controlled the test phone; record traffic used the
explicit LAN endpoint. The fixture TLS server name remains `localhost` (certificate
name, not route); CA validation, hostname validation and exact host fingerprint
remain enforced, and the client authenticates with its Android Keystore identity.
The fixture certificate and short-lived offer are provisioned through debug tools,
so this is not production pairing or durable trust establishment.

The `wifi-cycle` scenario is **prepared but not yet physically run**. It refuses
wireless adb and requires the explicitly selected phone to appear as a USB adb
device before APK setup. After a fictional LAN read during an active grant, it
checks a `wlan0` route to the private host, disables Wi-Fi only on that phone,
requires the route to disappear, tests old read and offline reconnect denial,
then re-enables Wi-Fi and requires the route to return before checking that a
new connection awaits fresh host approval. Its cleanup also re-enables Wi-Fi
and checks the route; a failure must be reported rather than counted as a pass.
This will test a real radio interruption on the selected device, not roaming
between access points. No phone network setting was changed to prepare it.

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
| Five-minute visit expiry | **Inconclusive as deadline evidence.** A new Windows-verified visit served one fictional read over physical Wi-Fi. The gate remained verified after the phone's 60-second grant expired and the visit closed 299,755 ms after verification was observed. No native lifecycle event was collected; the old read was closed, no content appeared, reconnect was denied, and reads/writes remained 1/0. Cleanup passed. That runner did not record a trusted reason for closure, so a child or pipe failure near the deadline could have produced the same result. The revised runner now requires the gate's explicit `visit-deadline` reason; an attended rerun is needed to accept this check. |
| Timed lock during active grant | A fresh `lock` receipt arrived 36,302 ms after grant issuance, before its 60-second deadline. The phone's still-enabled old read was attempted and denied, content cleared, reconnect was denied, and reads/writes remained 1/0. Cleanup passed. |
| Timed sleep during active grant | A fresh `suspend` receipt arrived 26,504 ms after grant issuance, before its 60-second deadline. After wake, the phone's old read was closed, content remained clear, reconnect was denied, and reads/writes remained 1/0. Cleanup passed. This was another brief sleep, not extended-sleep evidence. |
| Second physical Android device | A user-selected Echo Show 8 with a custom `lineage_crown` Android 11/API30 build read the same kind of fictional Windows record over direct Wi-Fi in a separate disposable run. This does not establish support for stock Echo Show software or make it a phone-only vault host. |
| Host identity rejection on two devices | Both the Echo Show 8 and Samsung rejected a wrong TLS host name and a wrong pinned host fingerprint before pairing. Each then completed a separately approved fictional read: one store read, zero writes. |
| Android background on two devices | During an active 60-second read grant, moving each test client Home cleared its displayed content and local scope. On return, the read and connect controls were disabled until identity review. A new connection waited for fresh host approval and made no second store read. The Windows visit stayed verified. |
| Physical device removal | After the Echo Show 8 read once, the host removed its paired identity. Its old read failed and cleared the display when attempted; reconnect was denied without another store read. Previously displayed information cannot be recalled from an already admitted device. |
| Physical client ends connection | On the Samsung, tapping the disposable client's End connection control after one read cleared the displayed content and old scope. Its reconnect waited for fresh host approval and made no second store read; Windows remained verified. |
| Restored Windows store and physical client | On October 19 UTC, the Samsung read one fictional record from a newly created Windows encrypted store after the source store was removed and its portable archive imported with an in-memory recovery key. The phone rejected a wrong host name and fingerprint before pairing. After host removal of that client, its old read and reconnect failed without another store read. The run recorded one read, zero writes, unchanged restored ciphertext, and passing cleanup. This used the same Windows user and PC, not a clean second device or a user-held key. |
| Owned host becomes unavailable | On October 19 UTC, the Samsung read one fictional record, then the runner confirmed the read grant remained active and stopped only its owned TLS host while Windows verification remained active. The five-second limit includes host closure and socket teardown. The phone's old read failed and cleared the displayed content when attempted; reconnect failed. The encrypted bytes stayed unchanged, with one store read, zero writes and passing cleanup. This tests host unavailability, not physical Wi-Fi interruption or roaming, and does not show immediate display clearing without another phone action. |
| Client link reset while host stays up | On October 19 UTC, the Samsung read one fictional record through a disposable private-address TCP relay. With the read grant still active, the runner dropped the phone-host socket pair while the verified Windows gate and TLS host remained active. After bounded teardown, the old read failed and cleared the displayed content when attempted; reconnect waited for fresh host approval with the read control disabled. One store read, zero writes and cleanup passed. This controlled link reset is not a physical Wi-Fi interruption or roaming test, and does not show immediate display clearing before a phone action. |

The Echo's first attempt crashed in the test identity reporter before pairing: the
reporter called `KeyInfo.getSecurityLevel()`, unavailable on API30. The corrected
reporter uses that method only on API31+ and exposes the older
`isInsideSecureHardware()` provider signal separately. The complete Echo run
then passed. The Echo provider reported `insideSecureHardware=false`; the
Samsung provider reported `securityLevel=1` and
`insideSecureHardware=true`. These are provider reports, not independent
attestation or a claim about protected record-key custody. Transport keys do
not unlock the vault.

The additional successful APK SHA-256 values were
`d2dce62e5c5bc2bf8285a5b3d68edf70cb11238f0fc1a7c1d65e39f5f4eafe42`
(Echo background),
`1966f12b7f9721facca78182d3f0a79985c7a4207c1153f9f80fa747b74ad654`
(Samsung background), and
`df73d21c2da873a1b506402cb321fd93a2bee35086fb7efabd5c8b18204e529c`
(Echo removal), and
`f9a8b24f71510b1f43e4d60ed9b60590196ca4ad5df99643758b64e37fbe3689`
(Samsung client end). All four runs reported cleanup passing. The disposable test
package was independently absent from both devices afterward; no test listener
remained listening. Raw output stays outside Git.

The restored-store run used disposable APK SHA-256
`fd15562dca17e435f4b92726b791e86f88112ec57535912221f02236f560a557`.
The archive and key stayed in process memory, the source synthetic store was
removed before import, and the destination synthetic store and test package
were removed afterward. The key was zeroed in the runner. This is physical
client access after a same-PC import, not proof of portable recovery-key custody
or recovery onto a clean device. Raw evidence remains outside Git in
`physical-restore-v2`; the earlier `physical-restore-v1` stopped before pairing
because this checkout lacked its native preview binary and is not a pass.

The final host-unavailable run used disposable APK SHA-256
`c21c9a32b58c714a3cd0449a9447837580b0d540d579ca2688d71058bb74aeec`.
The successful `physical-host-loss-v3` evidence remains outside Git. It asserts
the read grant is still active before shutdown and starts the five-second limit
before awaiting host closure. The earlier `physical-host-loss-v2` passed the
original assertions but did not prove those two narrower conditions. The first
attempt (`physical-host-loss-v1`) performed the fictional read but inspected the
connection list before asynchronous socket teardown completed, so it is
incomplete rather than a pass. The revised runner waits up to five seconds for
the owned connection to disappear and still fails if it remains. The final
run reported cleanup passing; the disposable package and final listener were
independently absent afterward.

The final controlled link-reset run used disposable APK SHA-256
`02a54be5cb4afdbe813d02df3a91926ce6002c2ee764b9df4b3ff370af3a20c5`.
`physical-link-reset-v2` passed with cleanup passing and asserted the read grant
was active before disruption. The earlier `physical-link-reset-v1` passed the
original assertions but did not include that grant-age check. The relay forwarded TLS
bytes without terminating the connection or changing the phone's network
settings. The Windows gate stayed verified and the host remained available.
Raw evidence stays outside Git. Actual Wi-Fi interruption and roaming remain
unverified.

The disposable Android TLS client now checks connection presence once per second
while a fictional record is displayed. Each check names the displayed record and
requires its selected read grant to remain valid. It has a two-second receive
limit, touches no vault record, and clears the displayed record and local scope
if the connection or that record's read permission is unavailable. This bounds
detection of a silent connection loss while the app remains foregrounded; it is
not an instant transport event notification. The host-side selected-record
presence contract is covered by synthetic Node tests (19/19 focused transport
tests pass). The changed Android client has not been built or exercised on a
phone here because no Android device is connected and the Android build tools
are unavailable; the broader Windows storage suite also cannot run here
because `pwsh` is unavailable. Physical Wi-Fi loss and roaming remain unverified.

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
The cancellation result and inconclusive expiry attempt remain outside Git in
`windows-cancel-v2` and `physical-expiry-v1` respectively. The expiry APK SHA-256 is
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

All 132 Windows-compatible Node tests passed, including refusal of public/wildcard
test bindings and bounded lifecycle-event collection that cannot verify the gate.
Both actual phone APK builds and successful runs exercised the modified Java
sources. Existing TLS negative tests still require certificate, hostname, pin,
pairing and record authorization. Linux-only container checks remain platform-limited.

These results show local-network access and native visit closure on lock/sleep on
the Samsung and PC, plus bounded read, background, host-identity and removal
checks on the two selected Android devices.
They do not complete Session 2 or production acceptance. Extended sleep,
network roaming/interruption, phone-hosted operation, production enrollment,
recovery and independent security review remain open. The
[recovery handoff](session-2-recovery-handoff.md) records why current ciphertext
is not a portable user-held backup. DPAPI remains CurrentUser
encryption with an application presence gate, not authentication-bound key release.
Actions remains disabled; no merge or deployment is implied.
