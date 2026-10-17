# Android Keystore storage experiment

This developer-only [Session 2](https://github.com/F2iLLC/lunaos-home/issues/14) experiment protects a fixed fictional Alex/Sam record using Android's own cryptographic provider. It is a separate instrumentation package, `io.github.f2illc.lunaos.vaultprobe`, with no activity, network permission, arbitrary-record input or connection to the Home preview. It does not implement the phone vault GUI, session service, assistant tools or pairing.

## Design and boundaries

The probe creates a unique AES-256 key in [Android Keystore](https://developer.android.com/privacy-and-security/keystore). Encryption uses the platform `AES/GCM/NoPadding` provider with its generated IV and a 128-bit authentication tag. The bounded envelope contains a version byte, the 12-byte IV and ciphertext/tag; an application purpose plus run UUID is authenticated as additional data. Read operations retrieve the existing alias and fail if it is missing. They never regenerate a key or reset the store. This is an experiment with an established primitive, not a reviewed production file format.

The key is explicitly **not authentication-bound** in this experiment. A null encoded-key result is checked, but no hardware security level, biometric/device-unlock requirement, attestation, device-exclusive custody or protection from a compromised app process is established. A real unlock/cancel flow needs its own design and device tests.

The single file lives under the test application's [no-backup directory](https://developer.android.com/reference/android/content/Context#getNoBackupFilesDir()), in a UUID subdirectory. Only ciphertext is passed to [AtomicFile](https://developer.android.com/reference/android/util/AtomicFile). The class supports safe replacement but does not provide writer locking; this probe runs one instrumentation operation at a time and is not a concurrent vault service. App backup and cleartext traffic are also disabled in the manifest. These settings are not a tested cloud-backup/device-transfer exclusion guarantee. Power-loss recovery, concurrent writes, migration and user-held backup/restore remain unverified.

Only fixed fictional data is accepted. The test runner prints pass/fail summaries, never records, key material or local data paths. The fixture is intentionally part of the test code; ciphertext marker checks cannot establish absence of plaintext in source, process memory, OS logs, paging, crash reports or every device file. Restoring the original ciphertext after a tamper test is not rollback protection.

## Build and run

Use Windows PowerShell 7, JDK 21, Android platform `android-37.0` and build-tools `37.0.0`, installed under the previously accepted SDK terms. Set `JAVA_HOME` and `ANDROID_HOME` as described in the [Android preview guide](android.md). The build uses only JDK/SDK tools; it does not run Gradle, compile Tauri, modify its generated files or fetch dependencies.

```powershell
./scripts/build-android-vault-probe.ps1 -OutputDirectory 'C:\DevTools\probe-output-new'
./scripts/test-android-vault-probe.ps1 -Serial emulator-5554 -Apk 'C:\DevTools\probe-output-new\probe.apk'
```

Choose an authorized test device explicitly; the example serial is not device discovery. The output directory must be new, outside the checkout and have no linked ancestors. It contains the local APK and a disposable development signing key, never production signing material. No files are automatically deleted from the host. Do not commit or publish those outputs. A new build gets a new test signing key.

The runner inspects the packaged manifest before installing. It refuses an already-installed probe rather than replacing it, and never targets the Home preview package. It creates a random run ID, performs the checks below, and uninstalls only the probe it installed in its own invocation, including after test failure. Abrupt interruption of the host runner can leave the isolated package behind; investigate that known test package before a later run rather than removing unrelated apps or data. The script does not change phone security settings, wireless debugging, device accounts or global backup configuration.

The runner force-stops only its probe between selected operations and checks that create/read occurred in different Android process IDs. This is process-restart evidence, not phone reboot, screen lock, suspension or unlock evidence. Each run removes its own key and ciphertext before package removal. Deleting the key is deliberate and confined to the freshly created test alias; never use this runner with actual household data.

## Observed evidence

Tested on the existing Android 16 / API 36 x86_64 emulator using JDK 21.0.12.1 and SDK build-tools 37.0.0. API 24 minimum and API 37 target are build configuration, not proof of support across those versions. No physical phone was connected for this increment.

| Check | Observed result |
| --- | --- |
| Build/package inspection | Signed local test APK; final manifest has no permissions, activities, services, receivers or providers. Backups and cleartext traffic disabled. |
| Create/read | Both fictional member details recovered exactly from the encrypted envelope. Repeated encryption produced different bytes. Only `records.bin` remained in the run directory; specified UTF-8/UTF-16LE markers were absent from ciphertext. |
| Duplicate create | Failed without resetting the existing records/key; the next read recovered the original fixture. |
| Process restart | Force-stop followed by a new instrumentation process read both records with the existing key. Distinct process IDs were verified. |
| Tamper | A changed authentication-tag byte on disk caused authenticated decryption to fail; no fallback overwrite occurred. Restoring the original ciphertext restored exact readability. Truncated ciphertext and incorrect purpose also failed. |
| Missing key | After deletion of only the run's key, decryption failed and ciphertext remained unchanged. Another fresh process still failed without creating a replacement key. |
| Cleanup | The unique key/file/directory were removed, the runner uninstalled its isolated package, and a subsequent scoped package lookup found it absent. |

This is storage-facility evidence only. Phone-only **user workflow** acceptance still needs Home integration, real permission/approval enforcement, trusted unlocking, physical-phone testing, lifecycle/backup recovery and independent security review. Session 2 remains in progress; Actions stays disabled and no binary distribution is authorized by these checks.
