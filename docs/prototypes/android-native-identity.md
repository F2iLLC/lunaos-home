# Android transport identity custody experiment

Session 2 / #14. This extends the separate synthetic TLS prototype from #54. It does not change offline Home, its authenticated record store, personal-phone settings, OS unlock or workflow grants. Only the dedicated account-free Android16/API36 emulator is supported by this runner.

## What changed

The APK no longer carries a client private key or PKCS12 file. `NativeIdentity` asks the platform `AndroidKeyStore` provider to generate an EC P-256 signing identity under one fixed, app-owned test alias. Creation refuses to overwrite an existing identity. Loading a missing identity fails instead of silently creating another one. Only the explicit test enrollment action creates it; only the explicit removal action deletes that alias.

`SyntheticTlsClient` loads the native key handle with the platform `KeyManagerFactory`; Android's TLS provider performs the actual handshake. The client requires the expected single identity, null private-key encoding and null key format. No private-key serialization, custom signature implementation, custom encryption or permissive trust manager is introduced.

The key permits SHA-256 and the platform's `DIGEST_NONE` operation because TLS computes its handshake digest before asking Keystore to sign it. This is Android's documented TLS key configuration, not unhashed TLS. TLS remains restricted to version 1.3, with certificate validation, host-name verification and the approved host fingerprint. See [Android Keystore](https://developer.android.com/privacy-and-security/keystore) and [TLS digest requirements](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder#setDigests(java.lang.String...)).

The transport key intentionally does not require an OS authentication prompt for each handshake. It proves device identity only: it cannot unlock the vault, approve its own pairing or obtain records without the host's separate selected-record grant. Production integration must retain the independently tested OS vault-unlock gate.

## Enrollment and custody boundary

1. Build/install the separate test-only, debuggable package. Its only asset is the public host CA certificate; the runner checks the APK archive for this exact asset set.
2. Explicitly create the identity on Android, inspect its provider properties and export only the public X.509 certificate into a fixed no-backup file.
3. The fixture controller retrieves that public certificate from this exact package on the already verified emulator. The host trusts that exact certificate and separately approves its fingerprint, producing a one-use 120-second pairing offer.
4. Write only the host identity, port and short-lived offer into a fixed app-private no-backup configuration file. The offer is created after compilation, installation and identity creation. No approval clock freeze or lifetime extension is used.
5. The existing native screen still requires explicit approval of the displayed computer and a separate selected read. Host-side fixture approval remains independent; reconnect never inherits old grants.

The debug transfer uses `run-as` for this owned test package and fixed filenames. The package must be debuggable for that test-only enrollment channel. It does not grant access to Home or other apps. This is **not** a production trust-distribution flow, hardware attestation, release package or completed two-device enrollment UI. Production pairing must replace the debug provisioning channel with a reviewed user-controlled identity exchange.

The Android API reports `getEncoded() == null` and `getFormat() == null`, plus generated origin. Successful TLS then demonstrates use of the native private-key handle. Those observations establish provider non-exportability in this test; they do not prove resistance to a compromised app/OS or hardware-backed protection. The emulator reports security level `0` (software). No physical-device, TEE or StrongBox claim is made.

## Reproduction

Use the same SDK/JDK and dedicated emulator prerequisites as the [direct TLS experiment](direct-vault-tls.md). The runner checks the exact AVD name, emulator serial, `ranchu` hardware, actual API36 and unlocked state, and refuses an existing test-package install. It never chooses the attached personal phone.

```powershell
node scripts/test-android-direct-tls.mjs 'C:\scratch\new-identity-run' 'C:\scratch\disposable-debug.keystore' --identity
node scripts/test-android-direct-tls.mjs 'C:\scratch\new-identity-screen-run' 'C:\scratch\disposable-debug.keystore' --gui
```

`--identity` proves native TLS, removal/missing-key refusal, replacement rejection before approval and explicit re-enrollment. `--gui` exercises the actual native screen, including cold process restart. `--race` retains the held-constructor cancellation check. Each run builds into a new outside-checkout directory, checks host-side read/write/approval counts, removes its temporary package and closes its host listener. Test logs/results stay outside Git; public evidence below records only relevant facts.

## Observed evidence

The initial identity run generated a non-exportable key but could not retrieve its public certificate because the test package was not debuggable. A second run exposed the missing TLS-specific digest authorization. Neither failed run is counted as a pass. The package setting and documented platform digest configuration were fixed without weakening TLS checks or test expectations.

The subsequent API36 identity lifecycle run passed:

- Both device-generated identities returned null private-key encoding/format, generated origin, EC algorithm, authorized SHA-256/NONE digests and software security level 0.
- Native TLS rejected wrong host names and mismatched host fingerprints; approved pairing read Alex's authoritative Monday record, rejected stale grants and read-only edits, and denied resume after host revocation.
- Identity inspection after the client process retained the same public fingerprint.
- Removing the key denied new client construction and did not recreate the alias.
- Explicit creation produced a different public fingerprint. The old host rejected that replacement during TLS; its rejection counter increased, with no connection admission or additional record read.
- Only a new explicit host trust/pairing decision admitted the replacement. The full TLS checks passed again with new grants. Across both enrollments: four authoritative reads, zero writes, two fresh read approvals in each phase.

Lifecycle APK SHA256: `33fb4a26d94caa1b785082b61efb77a285ef536a6a9a4a43c62bd77d46662c09`. This run preceded the additional existing-identity overwrite-refusal assertion; subsequent screen evidence is recorded separately.

The subsequent native GUI run passed all seven existing screen checks with the Keystore identity: initial gates closed; cancellation after pairing but before grant arrival; separate computer/read approval; End/reconnect; observed Home/background/return; cold force-stop/relaunch with fresh approvals; and denied read/cleared content after host revocation. The host counted four reads, four fresh approvals and zero writes. Inspection after the run matched the original public fingerprint, establishing actual TLS use of the same native identity across cold restart. The additional create-over-existing attempt was refused and left its public fingerprint unchanged. APK SHA256: `3eb0b64af26eb5ce02e40705fe6c025ab7e1a3aef859e002c22ee0847aa9582f`.

The held-constructor regression also passed with the native identity: End during paused real TLS construction, release, fresh pairing/approval and Monday read. One read, one approval, zero writes, unchanged native public fingerprint; APK SHA256 `9b4c9000448992230dc448e4d1b03f0f395d9470a06c8458db9265f428e4f2aa`. All 96 Windows-compatible Node tests passed. The existing Linux-only container preparation tests remain outside this Windows run, as documented in #54. Each temporary probe package and listener was removed, and the dedicated emulator was stopped after testing.

Removal was exercised after the host had revoked the established connection. Deleting a key is not claimed to terminate an already established TLS session; host revocation remains necessary. The re-enrollment test explicitly replaces the host service's trust context, using the same synthetic authoritative record, and reapproves scope. It does not persist or restore old grants.

## Remaining work

Replace debug enrollment with two-device identity approval and durable, revocable enrollment; integrate this transport with the encrypted store and OS unlock; test physical-device key properties and private-network reachability; and complete recovery/backup, lifecycle, accessibility and independent security acceptance. Key rotation/renewal, lost-device recovery and attested hardware claims are not implemented. Session 2 remains open.
