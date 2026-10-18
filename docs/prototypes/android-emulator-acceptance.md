# Integrated Home emulator acceptance — 2026-10-18

This is synthetic, disposable-emulator evidence for Session 2 (#14), not approval for sensitive use. It supplements the physical-phone results recorded in [issue 14](https://github.com/F2iLLC/lunaos-home/issues/14#issuecomment-6256025806). No personal phone security settings or records were changed by these emulator tests.

## Tested artifact and environment

- Home runtime source: `f968ea2666ea75b92f1bbeaf44a0b9557673e8ed` (the reviewed source-copy fix in #49). No production source changes were needed for these tests.
- Home debug APK SHA-256: `19f412bd4ad6fd9b52f2f2463e7a73765f5d9dccaa740d591a220a2cf83c9f1e`.
- Fresh `HomeVaultAcceptance_API36` AVD: Android 16 / API36, x86_64, `ranchu`, WebView `com.android.webview` 133.0.6943.137. No accounts or household input; only Alex/Sam and a disposable emulator PIN.
- Offline Windows build: installed JDK21, SDK37, Build Tools37.0.0, NDK29.0.14206865; Cargo/Gradle offline, two workers, in-process Kotlin. Initialized a fresh generated Android project at the same source commit. This passed preparation without deleting the other worktree's generated link or changing its source guard.
- Final APK inspection: x86_64 only, valid debug signature, no Internet permission, backups disabled, vault Activity non-exported. The instrumentation APK used the same debug signer. Its manifest is test-only, with no network permission or exported application entry points.
- Final instrumentation APK SHA-256: `e1da9975683484dc06e337be9d6e46f8e208933fb5af05e74f225eb742c98126`. Earlier key-only/queue-only builds exercised those unchanged helpers; the final package exercised all three delayed-store cases and the final missing-key inspection.
- Eight focused Android manifest/launcher checks passed. Both PowerShell scripts parsed, the Java instrumentation compiled against the installed API37 jar, and the runner rejected a physical-style serial before invoking ADB.

The original no-emulator/build-only statements in earlier prototype evidence are historical. These results apply only to this artifact and emulator combination.

## Observed results

| Check | Observation |
| --- | --- |
| No enrolled device credential | Verify reported unavailable. Approval, Read and both Save controls stayed disabled; no vault file had been created. |
| Wrong credential and cancel | Android displayed “Wrong PIN”; cancelling returned to closed access with Approval/Read/Save disabled. Only a disposable test PIN was used. |
| Verification versus approval | Correct Android verification enabled Approval only. Read/Save stayed disabled until a separate selected-scope approval. |
| Both family-member fixtures | Approved Setup created/read Alex Monday and Sam Tuesday through Home. These are record scopes, not separate identities. |
| Integrated missing key | After deleting only Sam's fixed synthetic AndroidKeyStore alias, a freshly approved read failed closed. Ciphertext remained byte-identical. |
| Save with missing existing key | Fresh Setup approval followed by Save reported `UNKNOWN`, ended access and preserved ciphertext. Another verification/approval in that process was refused as uncertain. |
| Missing-key restart | After cold restart and new Android verification/read-only approval, Sam still failed closed. Alex remained readable. A separate inspection confirmed Sam's alias was still absent; no replacement key was silently created. |
| Queued read, then End | Test helper occupied the real Activity executor, queued Read through its button, ended access, then released the queue. No record appeared, access stayed closed, ciphertext unchanged. |
| Queued write, then End | Same sequence with an approved Setup Save. No file change occurred and access/content stayed cleared. |
| Queued read, then Activity recreation | Recreated the real Activity with its read queued. The replacement Activity stayed closed, with no late content and unchanged ciphertext after the queue drained. |
| Real read returns after End | A test wrapper delayed the return from the real authenticated store. End occurred after decryption but before return. No content was displayed; access closed. |
| Real commit returns after End | The real store completed a write before End; the wrapper then returned. Home reported “Save applied; access ended”, suppressed content and closed access. One store call; no replay during the check. |
| Lost acknowledgement after real commit | After the real write completed, a test wrapper threw an acknowledgement error. Home reported `UNKNOWN`, closed access and displayed no record. The committed file stayed unchanged after the error; exactly one write call was observed. |
| Restart after lost acknowledgement | Reopened the ordinary Home launcher, verified with Android, approved read-only and read Alex Tuesday. Save stayed disabled. End cleared access. |

Two UI-driving attempts were inconclusive: an initial accessibility dump failed inside Android's UiAutomation process, and an unscrolled read attempt returned to the launcher. Neither was counted as a pass. The restart/readback check was repeated with a fresh hierarchy, visible controls clear of system navigation, and an explicitly observed Alex Tuesday result. No app crash was inferred from the UiAutomation failure.

The missing-key fixture is deliberately unrecoverable on this disposable emulator. Sam's ciphertext was preserved, not reset. Alex was changed to Tuesday by the committed-write tests. No genuine recovery claim follows from keeping these files.

## Reproduce the test instrumentation

Use a dedicated, disposable `HomeVaultAcceptance_API36` emulator and the reviewed Home **debug** package. The launcher refuses physical serials and any other AVD name; each instrumentation entry also requires `ranchu` and the exact debuggable Home target. Do not rename a personal AVD to pass this check. Do not use a release signing key or real records.

Build the helper into a new directory outside the checkout, using the same disposable Android debug keystore as Home:

```powershell
./scripts/build-android-home-key-probe.ps1 -OutputDirectory $NewTestOutput -DebugKeystore $HomeDebugKeystore
```

Open Home normally. Initialize Alex Monday and Sam Tuesday using Android verification and explicit Setup approval. End access and retain local ciphertext hashes. The default test action below **irreversibly deletes Sam's test key**, leaving its fixed ciphertext untouched:

```powershell
./scripts/test-android-home-key-loss.ps1 -Serial emulator-5556 -ProbeApk $ProbeApk
```

Verify the missing-key read/save/restart behavior through Home, then inspect that the key remains absent:

```powershell
./scripts/test-android-home-key-loss.ps1 -Serial emulator-5556 -ProbeApk $ProbeApk -VerifyOnly
```

Run each of the following separately with `-QueueCheck`. The helper opens the real native screen and waits up to 120 seconds for the emulator operator to complete Android verification and approve the selected Alex scope. It never supplies a grant or successful authentication callback:

```powershell
./scripts/test-android-home-key-loss.ps1 -Serial emulator-5556 -ProbeApk $ProbeApk -QueueCheck held-read-end
./scripts/test-android-home-key-loss.ps1 -Serial emulator-5556 -ProbeApk $ProbeApk -QueueCheck held-write-end
./scripts/test-android-home-key-loss.ps1 -Serial emulator-5556 -ProbeApk $ProbeApk -QueueCheck held-read-recreate
./scripts/test-android-home-key-loss.ps1 -Serial emulator-5556 -ProbeApk $ProbeApk -QueueCheck read-return-after-end
./scripts/test-android-home-key-loss.ps1 -Serial emulator-5556 -ProbeApk $ProbeApk -QueueCheck commit-return-after-end
./scripts/test-android-home-key-loss.ps1 -Serial emulator-5556 -ProbeApk $ProbeApk -QueueCheck commit-lost-ack
```

The first three cases use a latch on the actual Activity executor without replacing storage. The final three use reflection **only in the separately installed test instrumentation** to wrap the existing service's store reference: operations delegate to the real AndroidKeyStore/AtomicFile implementation, then delay or lose the return. The original service, clock, lock predicate, grant checks and before-commit callback remain active. The original store reference is restored afterward. This is controlled fault injection, not an actual power loss, device crash or hardware durability test. The commit cases modify Alex's synthetic record to Tuesday.

Each runner invocation removes its temporary probe package in `finally` and verifies removal; pre-existing probe installations are refused. Instrumentation starts a fresh target process, so it clears previous in-memory authority. It does not clear Home app data. Check the normal app's restart/readback separately after the lost-ack case, then end access and stop the dedicated emulator. Keep APKs, debug keys, raw UI dumps and device logs outside Git.

## Remaining acceptance gates

These cases do not finish Session 2. API29/older-device runtime rejection remains untested (only the API36 emulator image is installed). Duplicate launch and every prompt/lock/Back/rotation permutation while work is held, OS authentication callbacks arriving after cancellation, actual process/power loss during commit, and hardware-specific durability remain separate cases. The controlled delayed-return tests above do not prove all of them.

Computer/phone pairing and reconnect, real backup/device-transfer exclusion, recovery, screen-reader usability, independent security review and sensitive-use acceptance remain open. The standalone outsider-probe criterion/evidence belongs to #52; it is distinct from this integrated Home instrumentation. No merge, deployment, Actions enablement or issue completion is authorized by these results.
