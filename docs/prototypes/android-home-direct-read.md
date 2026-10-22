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
- The private-network test controller supplies the public host CA, exact host
  fingerprint, private IPv4 address, short-lived pairing offer, and selected
  phone model/API through the debuggable app's private directory. The standalone
  probe retains its packaged public CA; Home reads its provisioned public CA.
  Both clients still require TLS 1.3, certificate and hostname validation, the
  approved host fingerprint, and separate host and phone approvals. No public
  listener, cleartext transport, tunnel, or arbitrary server address is added.
- Only the Android debug manifest requests `INTERNET` and `USE_BIOMETRIC`; the
  generated main manifest remains permission-free. The connection Activity is
  non-exported. Preparation refuses unknown generated Android sources and
  components, including variant source sets. The release app and ordinary
  desktop launch have no connection entry point.

## Attended sequence to verify

Use a separately identified debug Home package on a selected Android API30+
test device and a Windows private-network host. Keep all synthetic store and
provisioning files outside Git. Inspect the final APK permissions, backup and
cleartext settings, exported components, signer, and ABI before installation.

1. In Home, choose **Prepare fictional computer identity**. Retrieve only the
   public test certificate through the debug provisioning channel. On the host,
   open one synthetic DPAPI store, commit a fixed fictional record, and start
   the attended Windows verified direct host. Complete Windows verification
   only in its trusted prompt.
2. Show and compare the full host and Android certificate fingerprints before
   issuing a one-use offer. Provision the public CA, exact host pin, private
   address and offer to this test package. Open Home's fictional computer
   connection screen. Separately approve the computer on Android, connect,
   approve the selected read on the Windows host, allow that read on Android,
   and read the committed fictional record.
3. Exercise denied or expired pairing, read without either approval, End,
   background and cold restart, host removal, and unavailable host. After each
   closure, confirm the old grant cannot read and the displayed content clears.
   Reconnect requires fresh approval. Count actual store reads and writes; a
   successful read must come from the reopened encrypted store, not a built-in
   Android string.

The private certificate and offer provisioning above is test infrastructure,
not a reviewed onboarding path. Android's direct screen does not itself prompt
for device credentials; the Windows verified visit gates the protected host
in this slice. The phone-only record and the Windows record are independent.
This read-only client does not demonstrate the phone write/unknown-acknowledgement
flow, durable enrollment, phone-hosted service, clean-device recovery,
authentication-bound Windows key release, or independent security acceptance.
