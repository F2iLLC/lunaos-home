# Fictional Android Home vault integration

This debug-only, phone-only experiment is separate from the default offline draft. Open Home's “What would you like to do today?” menu, then “Open fictional Android vault experiment (debug, API30+)”. The button opens an Android-native screen through the pinned Tauri command/plugin API. JavaScript receives only launch success/failure, never records, grants, storage operations or credentials. There is no assistant, listener, pairing, recovery, import/export, delete or free-form input. Member labels are record selection, not separate identities or security compartments.

## Implemented boundary

- Android API30+ and enrolled device credentials are required. The platform `BiometricPrompt` requests **device credentials only**; Home does not collect a PIN/password. Verification grants no record access. The native user must separately approve the selected Alex/Sam record and read-only or setup mode. Older devices retain the offline draft but cannot open this experiment.
- Approval lasts 60 seconds, measured with `SystemClock.elapsedRealtime()`. Verification may be used for approval for only 30 seconds. Setup permits create/edit of one fixed record, never delete. Read-only rejects mutations in `VaultService`, not just the UI. Only the built-in fictional Monday/Tuesday library-visit variants are writable.
- `VaultService` is the one native policy used by the Activity and storage operation path. It serializes storage, checks the captured grant before work, before atomic commit and before returning reads. Replacement invalidates old work. End/expiry/background clears displayed content and invalidates pending callbacks. A final UI check suppresses late reads. Duplicate Activity instances close rather than creating independent writers. Every resume/restart requires fresh verification and approval; no grant is persisted.
- The fixed per-member files live in `noBackupFilesDir`. AndroidKeyStore AES-256/GCM keys require device-credential authentication (120-second platform validity) and unlocked-device state. The envelope is bounded to 30 bytes with a fixed version and purpose/member authenticated as AAD. Existing corrupt/unsupported files or missing existing keys fail closed; nothing resets them. Missing files initialize only through an explicitly approved Setup Save. `AtomicFile`, explicit sync and exact ciphertext readback are used; no custom cryptographic primitive is implemented.
- End cannot undo a commit that already passed its final authorization check. Confirmed writes report `APPLIED` or `APPLIED_ENDED`; ambiguous outcomes report `UNKNOWN`, close access and prohibit another grant until process restart. Operations are never auto-replayed; duplicate operation identifiers within a grant are rejected. After an unknown result, restart, verify, approve read-only and inspect the selected record before deciding on another explicit save. There is no durable operation log or rollback protection.
- Native code and its non-exported Activity are copied only into the generated **debug** source set. Rust registration is Android/debug gated. The Android capability permits only `allow-open-fictional-vault` from the local `main` window; no remote contexts or broad native/filesystem grants exist. The button is compiled into Android debug frontend builds only. The normal Android permission `USE_BIOMETRIC` supports the maintained credential prompt; no network permission is requested. `FLAG_SECURE`, `allowBackup=false` and no-backup storage are controls, not proof of every leakage/transfer exclusion.

## Local reproduction

Use the existing pinned tooling and dependencies; do not change versions to resolve offline failures. With JDK21 on `PATH`:

```sh
bash scripts/test-android-service.sh
node --test test/android-manifest.test.js test/android-vault-wiring.test.js
cargo metadata --manifest-path src-tauri/Cargo.toml --locked --offline --filter-platform x86_64-linux-android
npm run native:android -- init --ci --skip-targets-install
npm run native:android -- build --debug --target x86_64 --apk --ci
```

Initialize only if the generated project is absent. Preparation is repeatable, rejects extra activities/services/receivers and unexpected generated source/variant manifests, and copies the reviewed native sources. The debug manifest explicitly removes the pinned AndroidX dependency's exported `ProfileInstallReceiver`; it adds no receiver or service. Generated paths and dependency/build caches stay ignored. A prepared offline Cargo directory source must be writable because Gradle builds the Tauri Android library there; copy verified vendor sources without changing their contents/checksums. Set Cargo offline mode/jobs=2 and Gradle offline/max workers=2. Keep disposable debug signing material outside the checkout, and inspect the **final APK**, not just source XML, for permissions, backups, exported activities, ABI and signature. No installation or distribution is part of these commands.

Preparation scans every directory under the generated `app/src`, including
universal, ABI-specific and combined flavor/build source sets. Only the known
main sources and reviewed debug vault destinations may contain Java/Kotlin;
only the main manifest and exact reviewed debug manifest are accepted.
Existing destination files and ancestors are checked without following links,
and hardlinked/nonregular files are refused before any writes. Regression
checks also reject manifest-name case variants and directories at every planned
output file; missing generated projects retain the Android initialization command.
They also cover flavor contamination, linked destinations/ancestors, unchanged
outside sentinel files and byte-for-byte clean repeatability. This protects
against stale generated inputs, not concurrent filesystem replacement or
custom Gradle source mappings outside `app/src`. Keep the project exclusively
owned during preparation and retain final APK inspection as separate evidence.

The isolated build uses the installed API37 platform revision 2, Build Tools 37.0.0 and NDK 29.0.14206865 with their matching SDK package metadata. Local ignored Gradle configuration selects `compileSdk=37` and `buildToolsVersion=37.0.0` for both application and library modules; the Tauri library otherwise asks for absent API36. The exact cached Linux AAPT2 9.3.1-15703166 executable is selected with `android.aapt2FromMavenOverride` after byte-for-byte verification against the prepared artifact, because its offline Gradle artifact metadata is incomplete. Kotlin compilation runs in-process. These are local build-environment settings, not vendor-source edits or permission/authentication exceptions.

Automated checks in the isolated JDK21/Node24 environment pass: all 76 JavaScript tests, the dependency-free Java service harness, direct Java compilation against the actual API37 `android.jar`, offline locked Android Cargo metadata, repeated source preparation, and the integrated x86_64 Rust debug build. The JavaScript launcher test executes the bundled code against a fake DOM/invocation adapter: only the open command is sent, pending actions disable the button, diagnostics stay sanitized, and non-Android-debug bundles do not install the button. The Java harness exercises selected-record scope, read-only/delete denial, monotonic expiry without a timer callback, held reads/writes, queued writes, grant replacement/end, a live lock-state predicate, restart without authority resurrection, duplicate operations, confirmed-after-end writes and uncertain acknowledgements. Direct Java compilation uses a test-only debug `BuildConfig` constant; the actual Gradle build uses its generated variant configuration. Compiler checks do not execute AndroidKeyStore, credential UI or lifecycle behavior.

The actual offline Tauri x86_64 debug APK build also passes. Final inspection with `apksigner`, `apkanalyzer` and AAPT2 verifies:

- Application ID `io.github.f2illc.lunaos.home.preview.debug`, x86_64 as the only native ABI, and a valid APK Signature Scheme v2 signature with one disposable debug signer.
- `allowBackup=false`, `usesCleartextTraffic=false`, no `INTERNET` permission, and exactly `USE_BIOMETRIC` plus AndroidX Core's application-scoped `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (declared with signature protection). The merged APK is not permission-free.
- Only the exported Home launcher and non-exported `VaultActivity` are present as activities; no service, receiver or activity alias is packaged. In particular, `ProfileInstallReceiver` is absent.
- Two non-exported providers remain: the existing Tauri-generated AndroidX `FileProvider` (URI grants enabled, external/cache roots, no no-backup root) and AndroidX `InitializationProvider`. Startup metadata retains EmojiCompat, ProcessLifecycle and ProfileInstaller initializers. These retained components are not evidence of runtime acceptance or a claim that every dependency component was removed.

The packaged native library matches the final Rust output byte-for-byte. The final bundled JavaScript matches an independent in-memory build of the current source, including the launcher under `#home-actions`; copied debug native sources match their maintained originals. Eight focused manifest/launcher tests pass. Scratch preparation repeated without changing file hashes and refused an unexpected Java source without overwriting reviewed files. No device was installed or exercised.

## Development hook

Android's dev and build hooks both build the offline frontend and run `prepare-android.mjs` before native compilation. A clean initialized project therefore receives the debug plugin, Activity, service, store and manifest without needing an earlier APK build. Both hooks propagate preparation failures. The hook regression executes both configured commands against disposable synthetic generated trees and checks copied source bytes and refusal of an unexpected Java source; it does not launch Tauri, compile an APK or establish device acceptance. The desktop dev hook remains unchanged.

## Remaining device gates

No emulator/device/authentication test is available in this implementation environment. Human checks must record exact source/package hash, device/API/WebView and observed results: credential success/cancel/failure/no-credential cases; prompt lifecycle and stale callback cancellation; explicit read-only/setup approval; initialization of each member; restart and fresh verification with ciphertext retained; tamper/missing-key refusal; expiry, End, screen lock, Home/app switch, rotation, Back and duplicate launch during held work; uncertain saves without automatic retry; touch targets, system insets, accessibility and no late content. A device whose credential UI backgrounds this Activity will fail closed and needs a separately reviewed lifecycle fix, not relaxed callback guards.

Power-loss durability, authenticated-key behavior on particular devices, backup/device-transfer exclusions, compromised-process resistance, recovery, direct computer/phone pairing, assistant disclosure and independent sensitive-use acceptance remain unverified. The separate [outsider probe](android-storage.md#approved-acceptance-criterion) uses the owner-approved inaccessibility criterion; its result does not establish acceptance of this integrated vault. This increment does not complete Session 2 or issue 14. Actions stays disabled.
