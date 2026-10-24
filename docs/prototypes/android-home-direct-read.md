# Home debug direct read of a protected Windows record

Issue #14 experiment. A separate Android **debug** action in Home launches the
existing native TLS client screen inside the Home package. It can read a fixed
fictional Alex record from the Windows DPAPI store through the Windows verified
host and its enforcing session service. This is a joined GUI path, not sync
between the phone-only store and the Windows store or a production enrollment
flow. No household data belongs in this build.

## Boundary

- Home's local main window can request only identity preparation or opening the
  non-exported native connection screen. JavaScript receives success/failure,
  never a key, pairing offer, approval, grant, or record. The existing phone-only
  vault still uses its separate Android credential and scope approval.
- Identity preparation is an explicit debug action. Android Keystore generates
  or reuses the exact test transport-key alias and writes only its public
  certificate into Home's private no-backup directory. The transport key is not
  the phone vault key. It can coexist with Home's authentication-bound record
  keys; a missing identity is not silently replaced while opening a connection.
  The same explicit action renews an expired transport certificate, clears its
  old test pairing config and public certificate, and requires fresh host
  pairing with the new fingerprint. Opening a connection never rotates it.
- The private-network test controller supplies the public host CA, exact host
  fingerprint, private IPv4 address, short-lived pairing offer, and selected
  phone model/API through the debuggable app's private directory. The standalone
  probe retains its packaged public CA; Home reads its provisioned public CA.
  Both clients still require TLS 1.3, certificate and hostname validation, the
  approved host fingerprint, and separate host and phone approvals. No public
  listener, cleartext transport, tunnel, or arbitrary server address is added.
- Only the Android debug manifest requests `INTERNET`, `USE_BIOMETRIC`, and
  `ACCESS_LOCAL_NETWORK`; the latter is requested at runtime when both the
  device and Home target API37+ and a
  denial keeps Connect disabled. [Android 17 requires this permission](https://developer.android.com/privacy-and-security/local-network-permission)
  for an app targeting API37 to make a direct LAN TCP connection. The
  generated main manifest remains permission-free. The connection Activity is
  non-exported. Preparation refuses unknown generated Android sources and
  components, including variant source sets. The release app and ordinary
  desktop launch have no connection entry point.

## Attended sequence to verify

Use a separately identified debug Home package on a selected Android API30+
test device and a Windows private-network host. Keep all synthetic store and
provisioning files outside Git. Inspect the final APK permissions, backup and
cleartext settings, exported components, signer, and ABI before installation.

1. In Home, choose **Prepare or renew fictional computer identity**. Retrieve only the
   public test certificate through the debug provisioning channel. On the host,
   open one synthetic DPAPI store, commit a fixed fictional record, and start
   the attended Windows verified direct host. Complete Windows verification
   only in its trusted prompt.
2. Provision the public CA, exact host pin, and private address to this test
   package. Open Home's fictional computer connection screen, then grant
   Android's local-network permission only after its system prompt appears.
   Show and compare the full host and Android certificate fingerprints before
   issuing a one-use offer. Separately approve the computer on Android, connect,
   approve the selected read on the Windows host, allow that read on Android,
   and read the committed fictional record.
3. Exercise denied or expired pairing, read without either approval, End,
   background and cold restart, host removal, and unavailable host. After each
   closure, confirm the old grant cannot read and the displayed content clears.
   Reconnect requires fresh approval. Count actual store reads and writes; a
   successful read must come from the reopened encrypted store, not a built-in
   Android string.

## Attended Samsung result

On 2026-10-21, the separate ARM64 debug Home package (APK SHA-256
`a386aa5165d8f69bbbece2e81774783b98b7b04443450bd0ccfabe82945105bb`)
ran on one Samsung SM-S938U at API 37 over private Wi-Fi. The installed app
had the local-network permission granted through Android's system dialog. The
phone reached the exact Windows listener port; the attended Windows native
verification completed in its OS prompt. Home displayed the full host and
phone identities before a one-use pairing decision. After separate host and
phone read approvals, Home displayed the fixed Alex record read from the
reopened Windows DPAPI store over authenticated TLS. The host counted one
read and zero writes. End cleared the record display and disabled the old
read control without a second store read. The synthetic Windows store and
separate test app were removed; cleanup passed. The result is one joined
physical read and End check, not the other failure and lifecycle permutations
listed above. No credential, household data, or private transport material
was captured in the retained result.

On 2026-10-21, a full current-source ARM64 debug rebuild (APK SHA-256
`3edeaf3030ffebbdf4b0a69b56ca8fcbea6eeef4c2068818c3e895d316fe1347`)
passed the attended joined Home reconnect check on the same Samsung API 37.
The first approved read displayed the committed fictional Alex record. End
cleared it and disabled the old read control. Home then connected with a new
connection ID; before a fresh host grant the record stayed hidden and Read
stayed disabled. A fresh host read approval alone still left Read disabled.
Only after the separate phone read approval did a second protected-store read
display the record. The host counted exactly two reads and zero writes; the
encrypted store stayed byte-for-byte unchanged. A final End cleared the screen.
The separate app and synthetic Windows store were removed; cleanup passed.
This checks one explicit End/reconnect path, not background, cold restart,
revocation, or unavailable-host behavior in the joined Home package.

The [Session 10 attended handoff](session-three-storage-pairing-handoff.md#session-10-attended-home-lock-and-sleep-results) records later joined Home checks on the same declared Samsung and Windows PC. A real Windows lock and a real suspend each ended the verified visit during an active fictional read grant; the phone cleared the record and a reconnect failed without another store read. Each run had one read, zero writes, and passing cleanup. These are lifecycle results for the read-only debug path, not a vault-key release or cold PC restart result.

The [Session 11 handoff](session-three-storage-pairing-handoff.md#session-11-attended-rogue-certificate-result) records a live listener check while the physical phone held an approved read. A second TLS-trusted but unpaired fictional certificate from the Windows PC could neither resume nor use the phone offer; the host made no additional record read. This is not a second physical-phone test.

The private certificate and offer provisioning above is test infrastructure,
not a reviewed onboarding path. Android's direct screen does not itself prompt
for device credentials; the Windows verified visit gates the protected host
in this slice. The phone-only record and the Windows record are independent.
This read-only client does not demonstrate the phone write/unknown-acknowledgement
flow, durable enrollment, phone-hosted service, clean-device recovery,
authentication-bound Windows key release, or independent security acceptance.
