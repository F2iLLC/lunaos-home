# Home debug phone-hosted fictional read

Issue #14 phone-hosted direction experiment. The separate Android debug Home
package can serve one fixed fictional Alex record from its own encrypted
Android store to a Windows test client on private Wi-Fi. The phone-only vault
and the phone-to-Windows read use the same selected-record `VaultService` policy;
this listener shares only the explicitly approved read-only grant. It is not a
background service, production pairing, or a path for household information.

## Enforced boundary

- The non-exported Android vault screen prepares a transport identity in
  Android Keystore. Only its public certificate is exported. The record key is
  a separate authentication-bound Android Keystore key and never enters TLS.
- A disposable Windows client certificate is provisioned into this debug
  package's private no-backup directory. The Android screen shows its full
  SHA-256 fingerprint before the user separately allows one Windows read.
  The listener requires that exact certificate with TLS 1.3 client
  authentication; the Windows client pins the phone's exact certificate before
  sending request bytes. The fixture provisioning is not guided enrollment.
- The listener binds an ephemeral port on the phone's private IPv4 `wlan0`
  address only after Android device-credential verification, explicit Alex
  read-only approval, local-network permission, and client-identity review.
  It accepts one connection and only `READ ALEX`. It reads through
  `VaultService`, checks the same grant again before sending, then closes.
  End, background, lock, grant expiry, handshake failure, or a 30-second
  accept timeout closes it. The app registers no exported service or endpoint.
- The attended runner requires a separate test application ID, selected USB
  phone, Android API 37, final APK target/permissions, an assigned private
  Windows address, and a Wi-Fi route. Its result and disposable certificates
  stay outside Git. It never handles an Android credential.

## Selected-device result

On 2026-10-21, the current-source ARM64 debug APK (SHA-256
`9e15304e9e43eace514a5282e71336cb8b0b53bd119f429e0afe5f273004cd17`)
ran on a Samsung SM-S938U at Android API 37. A bare TCP preflight established
that Windows could reach the phone on the original private Wi-Fi access point;
the second access point had timed out on the same reverse direction. The
separate Home app obtained Android's local-network permission. The owner
completed Android's trusted device-credential prompt for a fictional Alex
Setup save, then completed a fresh prompt for Alex read-only access. The app
reviewed the full disposable Windows client fingerprint before enabling the
listener. Windows connected from its Wi-Fi address using TLS 1.3, pinned the
phone certificate, and received exactly `Alex Example — fictional library
visit: Monday` from the Android protected store. The encrypted 30-byte record
was byte-for-byte unchanged across the remote read. The app closed access and
disabled the old read control. The separate package and disposable
certificates were removed; the retained attended result reports `PASS` and
cleanup `PASS`.

This is one foreground, one-read physical proof of the phone-hosted direction.
It does not prove background availability, a second access point's reachability,
unauthorized-client rejection on this phone-hosted listener, interrupted
requests, durable enrollment/revocation, a phone-hosted write, arbitrary
records, or supported-device coverage. Android Settings backgrounding closes
the current grant; a network switch needs fresh approval. Production behavior
and independent security/UX acceptance remain in VLT-03 through VLT-08.
