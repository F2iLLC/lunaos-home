# Android Keystore storage experiment

The separate [Home-native integration](android-home-vault.md) now implements an authentication-bound, debug-only phone flow. This page describes the standalone probe; its evidence does not establish integration acceptance.

This developer-only [Session 2](https://github.com/F2iLLC/lunaos-home/issues/14) experiment protects a fixed fictional Alex/Sam record using Android's own cryptographic provider. It is a separate instrumentation package, `io.github.f2illc.lunaos.vaultprobe`, with no activity, network permission, arbitrary-record input or connection to the Home preview. It does not implement the phone vault GUI, session service, assistant tools or pairing.

A second package, `io.github.f2illc.lunaos.vaultprobe.outsider`, uses the same original test class and disposable signing certificate but a different Android UID. It accepts only an isolation-check operation, with no record/key creation. Its manifest allows metadata lookup of only the primary probe. The check requires distinct UIDs, attempts lookup of the known run's key in the outsider's Keystore namespace, and attempts read/write opens of the primary probe's fixed synthetic file. Both opens must fail with `EACCES` or `ENOENT`, with the path and owner-read controls below satisfied. Unrelated errors or missing controls cannot count as a pass. It neither requests shared-UID access nor uses privileged shell identity for those attempts. The primary probe reads its fixture successfully before and after the outsider check.

The owning probe supplies SHA-256 fingerprints of its actual absolute file path and encrypted bytes after successful create/read. These per-run synthetic control values stay in the local runner, not published evidence. The outsider must match the path fingerprint before attempting either open; the runner also exercises a deliberately wrong fingerprint and requires failure at that exact boundary. The owner must decrypt the fixture and report identical path/ciphertext fingerprints before and after the outsider attempts. Neither package accepts an arbitrary file path. Both open outcomes are collected before acceptance is evaluated. The runner independently validates the reported controls and prints the actual error for each open only after all checks and cleanup succeed.

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

Choose an authorized test device explicitly; the example serial is not device discovery. The output directory must be new, outside the checkout and have no linked ancestors. It contains `probe.apk`, `outsider.apk` and a disposable development signing key, never production signing material. The runner finds `outsider.apk` beside the supplied primary APK. No files are automatically deleted from the host. Do not commit or publish those outputs. A new build gets a new test signing key.

The runner inspects both packaged manifests and checks for existing installations before installing either. It refuses already-installed probes rather than replacing them, and never targets the Home preview package. It creates a random run ID, performs the checks below, and attempts to uninstall every probe it installed in its own invocation, including after test failure. Abrupt interruption of the host runner can leave isolated packages behind; investigate those known test packages before a later run rather than removing unrelated apps or data. The script does not change phone security settings, wireless debugging, device accounts or global backup configuration.

The runner force-stops only its probe between selected operations and checks that create/read occurred in different Android process IDs. This is process-restart evidence, not phone reboot, screen lock, suspension or unlock evidence. Each run removes its own key and ciphertext before package removal. Deleting the key is deliberate and confined to the freshly created test alias; never use this runner with actual household data.

## Earlier emulator evidence under the original criterion

Tested on the existing Android 16 / API 36 x86_64 emulator using JDK 21.0.12.1 and SDK build-tools 37.0.0. API 24 minimum and API 37 target are build configuration, not proof of support across those versions. No physical phone was connected for this increment.

**This earlier run failed the original errno-specific file-isolation check.** The outsider had a distinct UID and could not find the owner's run key, but both read-open and write-open reported `ENOENT` rather than the then-required `EACCES`. The actual absolute path fingerprints matched, and the owner's successfully decrypted ciphertext was byte-for-byte unchanged before and after. A deliberately wrong fingerprint failed at `same-path-control`. The runner retained that failure while completing independent storage checks and removing both installed packages. That historical run is not retroactively relabeled a pass.

Android's [app-directory isolation implementation](https://android.googlesource.com/platform/frameworks/base/+/4482ab53d171) describes private mount namespaces that hide other apps' directories. That remains a possible explanation, not verified causation. The positive control rules out a different absolute path string and shows the owner's actual file remains present and unchanged. It does not expose or compare inaccessible inodes across namespaces. The owner subsequently approved the behavior criterion below.

| Check | Observed result |
| --- | --- |
| Build/package inspection | Two signed local test APKs; manifests have no permissions, activities, services, receivers, providers or shared UID. Backups and cleartext traffic disabled. The outsider declares visibility of only the primary probe. |
| Create/read | Both fictional member details recovered exactly from the encrypted envelope. Repeated encryption produced different bytes. Only `records.bin` remained in the run directory; specified UTF-8/UTF-16LE markers were absent from ciphertext. |
| Duplicate create | Failed without resetting the existing records/key; the next read recovered the original fixture. |
| Process restart | Force-stop followed by a new instrumentation process read both records with the existing key. Distinct process IDs were verified. |
| Separate-app key lookup | The outsider's UID differs from the owner and matches its own process. The known run alias is absent from its Keystore namespace and key lookup returns null. |
| File-path positive control | Matching fingerprints of the owner's actual path and outsider target; a wrong fingerprint is rejected before file opens. Owner ciphertext fingerprints match before/after, and the fixture still decrypts. |
| Separate-app file opens | **Not passed under the original errno-specific assertion.** Both opens returned `ENOENT`, not `EACCES`, with the positive control satisfied. |
| Tamper | A changed authentication-tag byte on disk caused authenticated decryption to fail; no fallback overwrite occurred. Restoring the original ciphertext restored exact readability. Truncated ciphertext and incorrect purpose also failed. |
| Missing key | After deletion of only the run's key, decryption failed and ciphertext remained unchanged. Another fresh process still failed without creating a replacement key. |
| Cleanup | The unique key/file/directory were removed, the runner uninstalled both isolated packages, and subsequent exact package lookups found both absent. Cleanup still runs when the isolation check fails. |

This is storage-facility evidence only. Phone-only **user workflow** acceptance still needs Home integration, real permission/approval enforcement, trusted unlocking, physical-phone testing, lifecycle/backup recovery and independent security review. Session 2 remains in progress; these checks authorize no binary distribution. Public PR tests now run on hosted GitHub Actions; see the [CI handoff](../ci-actions-setup.md).

Separate-app isolation does not establish denial of an unpaired remote device, a rooted/compromised OS, or malicious code already running under the owner app's UID. The two test packages share a development signing certificate but do not share a UID; this is not a test of hostile instrumentation signed by another publisher. Pairing identity and admission remain separate Session 2 checks.

## Approved acceptance criterion

Owner approval on 2026-10-18 replaces only the errno-specific file-open requirement: with the verified owner path, successful owner reads and unchanged ciphertext before/after, a distinct-UID companion must have no key access and neither read nor write open may succeed. Accept `EACCES` or `ENOENT`, reporting which occurred; all other errors, missing controls, changed bytes or successful opens fail. Keep the deliberately incorrect path-fingerprint rejection. Describe the result as observed cross-app inaccessibility, not proof of a specific ACL mechanism, rooted-device resistance or remote-client admission.

The probe and runner implement this criterion. Run `./scripts/test-android-isolation-evidence.ps1` without a device to verify all four allowed errno combinations preserve their reported values and that successful opens, other errors, missing path/open evidence, false controls and duplicate reports are rejected. The live runner still requires different UIDs, an absent outsider key, wrong-path rejection, successful owner decryption and unchanged ciphertext; parsing tests alone do not satisfy those controls.

New runs of both rebuilt probe packages on Samsung SM-S938U, Android 17/API 37, and the existing Android 16/API 36 x86_64 emulator passed the approved criterion: matching path verified, both outsider opens reported `ENOENT`, owner read controls passed, and both packages were removed. Both runs passed duplicate-create refusal, process restart, tamper/truncation/purpose rejection, missing-key refusal after restart and fixture cleanup. Home's separate integrated Alex/Sam phone records were unchanged. This evidence covers the standalone probe only; its keys remain non-authentication-bound, and the emulator run did not rebuild or test the integrated Home package.
