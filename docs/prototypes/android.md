# Android offline preview

This is the Android build path for the [native shell probe](native-shell.md). Its default flow uses only the example family and in-memory draft rules, with no assistant connection or phone/computer bridge. Android debug builds also expose a separate [fictional native vault experiment](android-home-vault.md), requiring API30+ device credentials and explicit native approval. Android 16 / API 36 on an x86_64 Pixel 7 emulator was the initial shell target; that evidence is not acceptance of the new vault flow.

## Prerequisites

Use the official [Android command-line tools](https://developer.android.com/studio#command-tools), [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and a Java 21 JDK such as [Eclipse Temurin](https://adoptium.net/installation/archives). Verify downloaded archives against vendor checksums. Read and accept Google's SDK agreement before using the SDK; do not automate someone else's acceptance.

Set these variables for the development shell using your own installation paths. The examples below are placeholders, not paths to household data. Keep SDKs, emulator state and signing material outside the repository.

```powershell
$env:JAVA_HOME = 'C:\DevTools\jdk-21'
$env:ANDROID_HOME = 'C:\DevTools\android-sdk'
$env:NDK_HOME = Join-Path $env:ANDROID_HOME 'ndk/29.0.14206865'
$env:ANDROID_USER_HOME = 'C:\DevTools\luna-home-android'
$env:ANDROID_AVD_HOME = Join-Path $env:ANDROID_USER_HOME 'avd'
$env:GRADLE_USER_HOME = 'C:\DevTools\luna-home-gradle'
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\emulator;$env:PATH"
```

Ensure Cargo and Rustup are also on PATH. Install these SDK packages through the SDK manager, accepting the terms interactively:

On Windows, Tauri's Android packaging step also needs symbolic-link creation. Enable [Windows Developer Mode](https://learn.microsoft.com/en-us/windows/advanced-settings/developer-mode) with the computer owner's approval and administrator access. Device Portal and Device discovery are not needed. A successful Rust compile can still fail at this packaging prerequisite; do not describe that as a completed APK.

```powershell
sdkmanager.bat --sdk_root="$env:ANDROID_HOME" 'platform-tools' 'platforms;android-37.0' 'build-tools;37.0.0' 'ndk;29.0.14206865' 'emulator' 'system-images;android-36;default;x86_64'
rustup target add x86_64-linux-android aarch64-linux-android
```

The current command-line tools warn that `sdkmanager` is deprecated in favor of Android CLI; the commands here record the tooling path used for this probe. The generated Tauri project compiles/targets API 37; its minimum API is 24. Neither value establishes tested support for every OS in that range. The API 36 emulator image contains no Google apps or signed-in account.

## Generate and build

```powershell
npm ci --ignore-scripts
npm run native:android -- init --ci --skip-targets-install
npm run native:android -- build --debug --target x86_64 --apk --ci
```

For an ARM64 build check, use `--target aarch64` instead of `--target x86_64`. Both commands use the same generated `universal/debug/app-universal-debug.apk` output location, so a later build replaces that file. Inspect its `lib/` entries before choosing a device; the directory name does not guarantee multiple architectures. An earlier ARM64 preview was reported to open on a Samsung phone and show the welcome screen in [Session 1's device assessment](https://github.com/F2iLLC/lunaos-home/issues/13#issuecomment-6182783646). That report does not identify a current-main build or establish touch, review or lifecycle acceptance. Record the exact device, Android/WebView versions and package hash on the next check.

For 32-bit ARM userspace, install the Rust target `armv7-linux-androideabi` and build with `--target armv7`. A 64-bit-capable CPU does not establish a 64-bit Android userspace. A combined build with `--target aarch64 armv7` was successfully packaged and its ELF headers verified for both architectures; the 32-bit-only command avoids including an unused ARM64 library.

The pinned Tauri CLI generates `src-tauri/gen/android`; keep this machine-specific tree ignored. The Android configuration invokes `scripts/prepare-android.mjs` before building. That script removes the generated Internet permission, fixes cleartext traffic to false and sets `allowBackup=false`. It refuses unexpected permissions/template changes instead of quietly widening access. Inspect the merged APK manifest as well; a source-manifest test alone is not platform enforcement evidence. Backup/transfer behavior still requires Session 2 experiments before any sensitive use.

### Clean generated files before a branch retest

Ignored Android files survive Git branch changes. Before calling a package a build of the selected revision, inspect the generated manifest, Java/Kotlin sources and resources for additions from another branch. A screen-saver service from a separate preview was found in this tree during a current-main retest. Its first package was excluded from acceptance; no device received it.

Preserve the existing generated directory outside the checkout, then run the pinned `init --ci --skip-targets-install` command again and rebuild. Do not delete another worker's build or replace an installed app as part of this cleanup. The offline manifest preparation now rejects services, broadcast receivers and activity aliases instead of silently retaining them. This check catches declared extra components; it does not establish provenance of every generated source/resource. A fresh generated tree and final package inspection remain necessary.

Before handing off a local test package, verify its signature, SHA-256, native architecture, application ID, main-activity rendering setting and final manifest. The offline package must have no Internet permission, cleartext disabled and backups disabled. Verify no screen-saver service is present. Keep raw build logs, debugging keys and APKs outside Git; the binary-distribution notice gate still applies. Record the app source revision separately from any later documentation commit.

Keep the `tauri` npm script alias: the generated Gradle Rust task invokes `npm run tauri android android-studio-script`, even when the initial command used the `native:android` alias.

The debug application ID has a `.debug` suffix, separate from a future release. Use built, bundled assets; do not expose the Node service or a development web server to the LAN for this offline check. The native binary redistribution/notice gate in [THIRD_PARTY.md](../../THIRD_PARTY.md) still applies. No APK is a production vault release.

## Emulator and acceptance

```powershell
emulator.exe -accel-check
avdmanager.bat create avd --name LunaHome_API36 --package 'system-images;android-36;default;x86_64' --device pixel_7
emulator.exe -avd LunaHome_API36 -no-snapshot -no-audio
adb.exe devices
```

Choose the emulator serial explicitly for every install/launch command; never install onto an unrelated connected phone. Use a fresh emulator without personal accounts. Keep debug keys and emulator logs outside Git. Do not publish the local debugging endpoint.

Record installation, cold launch, UI behavior and restart separately. Exercise the home menu, family-member selection, Needs review, manual correction, separate confirmation, suggestions and discard. The offline UI must state that an assistant is unavailable. Check touch/keyboard, system back behavior, small screens, background/resume and full process restart. A successful build, emulator boot or activity-launch command alone does not pass these UI checks.

## Probe evidence

### October 16 emulator interaction and system-bar correction

The dedicated LunaHome API 36 emulator (Android 16, Pixel 7 hardware profile,
x86_64, WebView 133.0.6943.137) was operated through its native Windows window.
This establishes emulator pointer interaction, not physical-phone touch support.
A fresh build from `3de2e42f37975958256fa65618e77637ed27908f` passed v2 signature
verification and same-signer replacement installation without uninstalling or
clearing app data. Its APK SHA-256 was
`471125c4e8447411329896c707bdf8bb323e55ce311852343507a714d7de4563`.

Observed on that baseline:

| Check | Observed result |
| --- | --- |
| Cold launch, expanding home actions and opening the vault | Passed; actual welcome and draft screens displayed. |
| Example family, scrolling and member selection | Passed; Alex and Sam were selectable, and Sam retained Meadow School. |
| Workplace Needs review | Passed; confirmation became disabled and the offline assistant-unavailable notice appeared. |
| Library suggestion | Yes, later was visibly recorded. Not now was clicked afterward, but its resulting label was not separately verified. |
| Background and resume through Android Home/recent apps | Passed; Sam remained selected with the existing draft. |
| Full force-stop and cold restart | Passed; reopening the vault showed Ready for a fictional draft and the empty-state example action. |
| Manual text correction and separate confirmation | Not passed. The field focused, but supported host keyboard input did not change the text; a usable on-screen keyboard was not visible. Root cause remains unestablished. |

The baseline visibly drew content underneath the Android status/navigation bars.
The build preparation now installs the project-owned
`scripts/android/MainActivity.kt` override. It applies system-bar, display-cutout
and keyboard insets to the native content container, using existing AndroidX
facilities. Padding is assigned from each inset dispatch, rather than added
repeatedly. Insets are consumed at that container to avoid applying them twice.
This follows [Android's system-bar overlap guidance](https://developer.android.com/develop/ui/views/layout/edge-to-edge#system-bars-insets).

Preparation accepts only the known generated activity or the exact current
override (with line-ending normalization). Unknown activity changes cause a
failure before either generated file is written; preserve and review them instead
of overwriting them. The manifest safeguards still apply. No permissions, native
commands, networking, dependency versions or assistant capabilities are added.

The corrected x86_64 APK has SHA-256
`98eef677dae9597e52810b0a5214644cfc289e7f48207d5d20832eaf27c37480`.
Its full build, signature and same-signer installation passed. The actual emulator
showed the welcome header/footer clear of the bars, and the vault could be opened,
scrolled, populated with the example family and focused for editing. The keyboard
gap remains; this is not a claim that inset handling fixed text entry. All 32
JavaScript tests passed, including repeatable activity preparation and refusal to
overwrite an unrelated custom activity. Earlier baseline lifecycle results are
not a substitute for repeating the full checklist on the corrected build.

Still required: usable text input and correction/confirmation, verified decline,
discard cancellation/confirmation, lock/unlock, landscape/cutout and keyboard
insets, physical-device checks, and native assistant integration. One connected
physical device reported unauthorized and was not operated. The ARM64 retest
package below was rechecked. At this stage, the inset correction had only been
built and run for x86_64; the later ARM64 packaging check is recorded next.
No binary-distribution or Session 1 acceptance is implied.

### October 16 ARM64 retest package

A fresh `aarch64` debug build from `81f331e54a9d9fa8e5f6cfdda45bf460ef8730fc`
includes the system-bar inset correction. Its SHA-256 is
`470c86e541576465751fe810c3f30a700d78ad4db096c842f801d4411bf3c36d`
and its size is 137,301,399 bytes. Full packaging and v2 signature verification
passed. The sole native payload is `arm64-v8a`; the debug signer matches the
earlier packages. The final manifest retains no Internet permission, backup
disabled, cleartext disabled and standard activity hardware rendering. No Home
service is present; the merged AndroidX profile-installer receiver is retained.

This package is for local synthetic phone testing, not public release. USB
enumeration initially blocked the phone check. The owner subsequently enabled
wireless debugging and explicitly paired the intended phone; the physical check
below supersedes that connection blocker. Pairing details and device identifiers
are excluded from published evidence.

### October 16 physical ARM64 phone interaction

The authorized Samsung SM-S938U reports Android 17 / API 37, `arm64-v8a` and
`com.google.android.webview` 155.0.8059.43. The package above was hash-checked and
its signer compared with the existing preview before a successful replacement
installation. No uninstall or app-data clear was used. These observations apply
to that exact package and device/runtime combination, not all Samsung or Android
phones. Interaction used ADB-injected touches and keys with actual phone screen
inspection; it is not a human finger-usability assessment.

| Check | Observed result |
| --- | --- |
| Native launch and portrait layout | Passed; rendered welcome, expanding home actions, vault empty state and fictional family appeared. Content stayed clear of status/navigation bars, with no visible horizontal overflow. |
| Needs review | Passed; Alex's workplace became Needs review, Looks right was disabled, and the screen accurately stated that no assistant was connected. |
| Keyboard and editor visibility | Passed; Samsung's on-screen keyboard appeared with the editor and Update draft visible above it. Text replacement worked; tapping the displayed letter and backspace keys changed the field. Android Back dismissed the keyboard without losing the edit. |
| Correction and separate confirmation | Passed; Willow Workshop appeared as Your edit / Please check after Update draft. A separate Looks right action confirmed it and raised the checked count to one. |
| Member isolation | Passed; Alex's Moonrise Library and Sam's Meadow School remained unchanged. |
| Suggestion decisions | Passed; Yes, later and then Not now were each visibly recorded for the library-card suggestion. |
| Discard cancellation and confirmation | Passed separately; Keep reviewing retained the corrected draft and choices. On a fresh example draft, Yes, discard it returned to Ready for a fictional draft and the example action. |
| Background/resume | Passed; Android Home followed by a hot app resume retained Sam's selection, Meadow School and the one-checked count. |
| Force-stop/cold restart | Passed; after the cold start and the owner returning the app to the foreground, reopening the vault visibly showed Ready for a fictional draft and the empty-state example action. |
| Landscape layout | Passed for the inspected empty state and family review; the owner rotated the phone, content remained clear of the system bars and side cutout area, and injected taps switched Alex to Sam in the two-column layout. |
| Return to portrait and brief lock/unlock | The owner performed the combined sequence and reported ready. The next app screen was upright with the draft, zero-checked count and Sam still selected. This is a brief resume result, not prolonged sleep or a phone-hosted service test. |
| General system Back | With the keyboard closed, Android Back returned from the family review to the welcome screen. Reopening Explore my vault retained Sam's selection and the current checked count. |
| Landscape keyboard | With Sam selected, the Samsung keyboard appeared in landscape with the editor and Update draft visible above it. An injected tap on the displayed x key changed Meadow School to Meadow Schoolx; the displayed backspace restored Meadow School. Android Back dismissed the keyboard and retained the text. No update was submitted. The temporary test rotation lock was removed and the original free-rotation setting was verified afterward. |

Human finger usability and longer sleep/suspension remain separate checks.
The rows above distinguish keyboard dismissal from general Back navigation.
No Android assistant connection, protected persistence or phone-hosted service
is implemented by this offline preview. Wireless debugging is a development
connection, not the product's phone/computer vault bridge. No raw phone screens,
logs, pairing material or binaries are published. The [Session 1 handoff](session-one-handoff.md)
maps these results to the issue's exit checks and the remaining client decision.

### Earlier package and startup checks

The following paragraphs retain the earlier scope and blockers. The October 16
table above supersedes their emulator-rendering, pointer, resume and restart gaps;
it does not turn the remaining checks into passes.

October 15 clean-tree retest package: application source `9b85c020171ed54a0168a7370a05791d373af3d0`, rebuilt after regenerating the Android project with the pinned CLI. Full ARM64 debug packaging and v2 signature verification passed. The 137,301,399-byte local APK has SHA-256 `3cb49ef65c53eb3f95b8b04f669a10d757e48b7c224d286248e2b0dde1aa62c6`, only the `arm64-v8a` Home library, the debug application ID, normal hardware rendering, no Internet permission or screen-saver service, and backup/cleartext disabled in its manifest. The 30-test app suite passed before the manifest safeguard was added; all five manifest tests then passed, including rejection of leftover components. The new safeguard also rejected the preserved contaminated manifest and accepted the regenerated one unchanged. This package has not been installed or launched by this build session. Device acceptance and complete redistribution notices remain open.

October 14, 2026, Windows 11 build 26300: Temurin JDK 21.0.12.1+1, Rust 1.99.0, Android command-line tools 22.0, platform tools 37.0.1, SDK platform/build tools 37, NDK 29.0.14206865 and emulator 37.2.12. The emulator uses the API 36 default x86_64 image revision 2 and Pixel 7 hardware profile, with WHPX acceleration. It reports Android 16 and completed boot. This is not a physical Pixel phone result.

The x86_64 native library compiled successfully. Gradle project configuration, Android Kotlin compilation and manifest merging also passed. The merged debug manifest has the `.debug` application ID, no Internet permission, `allowBackup=false` and `usesCleartextTraffic=false`; its only requested permission is the app-scoped AndroidX dynamic-receiver permission. These are build-artifact checks, not device backup or network-isolation acceptance tests. Upstream generated code emits deprecation warnings for Java 8 targets and Android APIs; no warning suppression or dependency bypass was added.

After the owner enabled Windows Developer Mode, the full Tauri x86_64 debug APK build passed without bypassing the symbolic-link or Gradle checks. The generated output is `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`; despite the generated directory name, this invocation built only the x86_64 target. APK signature verification passed using v2 signing. The APK manifest independently confirmed no Internet permission, backups disabled and cleartext traffic disabled. The installed package also reports no Internet permission and no backup flag.

Installation succeeded on the isolated `emulator-5556` instance. Android reported `Status: ok` and `LaunchState: COLD` for both the first launch and a second launch after explicitly force-stopping the app; a new app process was observed. Its WebView provider is `com.android.webview` 133.0.6943.137. No fatal app exception or native panic was observed in the collected startup diagnostics, and process-exit history identified the deliberate force-stop. This is startup evidence, not proof of rendered content or draft state. The software renderer emitted EGL/MESA warnings and skipped frames, and WebView reported variation-seed warnings; smooth rendering is not established.

The separate `aarch64` full debug build also passed. Inspection found only `lib/arm64-v8a/liblunaos_home_preview_lib.so` in the resulting APK; v2 signature verification passed. Its packaged manifest retains the debug application ID, no Internet permission, `allowBackup=false` and `usesCleartextTraffic=false`, with only the app-scoped AndroidX receiver permission requested. This is ARM64 compilation/package evidence only. The installed x86_64 emulator app was left unchanged for the pending manual check; no ARM64 runtime or physical-device compatibility is claimed.

The available browser automation policy blocks the Android inspector, and native screen automation is unavailable. UI rendering, touch/keyboard, system back, draft correction, background/resume and restart clearing therefore still require a manual pass. The native assistant connection is also unimplemented. Neither the emulator result nor the separate desktop-browser Claude Code test establishes physical Android or Android assistant compatibility. All 15 local JavaScript tests pass, including offline manifest checks and the existing stdio/HTTP draft integration. No Android SDK, emulator state, generated project, signing material or binary is committed.

To reproduce installation and the process-level launch check on this named test emulator, first build with `--target x86_64` as above (an ARM64-only APK will not run on this emulator):

```powershell
$apk = 'src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk'
apkanalyzer.bat manifest permissions $apk
apksigner.bat verify --verbose $apk
adb.exe -s emulator-5556 install -r $apk
adb.exe -s emulator-5556 shell am start -W -n io.github.f2illc.lunaos.home.preview.debug/io.github.f2illc.lunaos.home.preview.MainActivity
```

For the remaining on-screen check, open the emulator window and use only the example family:

1. Expand the welcome button, choose **Explore my vault**, then **Try the example family**. Verify both people can be selected and the screen fits without sideways scrolling.
2. Select Alex's workplace, choose **Needs review**, and check that the app says an assistant is not connected. Change the fictional value to `Willow Workshop` and choose **Update draft**. It must remain **Please check** until **Looks right** is selected separately. Sam's school must remain unchanged.
3. Accept or decline a suggestion; cancel a discard first, then confirm a discard. No saved vault record should be claimed.
4. Check typing with the Android keyboard, scrolling with a finger or emulator pointer, system back and background/resume. Finally force-stop/relaunch: the in-memory draft should be gone. Record each result separately; a successful process restart does not prove clearing.

These manual checks are pending, not implied passes. Record the tested revision, OS/WebView version and any failure before updating the compatibility matrix.

## Opt-in activity software rendering

A physical 32-bit ARM Android 11 test using WebView 146.0.7680.153 installed the standard debug preview and initially reported a successful activity start, then exited with a native crash in Android HWUI's `WebViewFunctorManager::destroyFunctor` on RenderThread. The supplied app startup diagnostics showed graphics initialization warnings but no captured JavaScript exception or Rust panic. This narrows the investigation to a platform rendering/lifecycle interaction; it does not prove a driver, ROM, WebView or application root cause. Activity-start success alone must not be counted as a successful launch.

The optional configuration requests software rendering for `.MainActivity` before its window/WebView is created:

```powershell
npm run native:android -- build --debug --target armv7 --apk --ci --config src-tauri/tauri.software-rendering.conf.json
```

It sets `android:hardwareAccelerated="false"` only on Home's main activity. Android documents this as an activity-specific control. It does not change system graphics settings, the installed WebView, app permissions, networking, backup policy or the native assistant boundary. The normal build explicitly sets the activity flag back to `true`, preventing an earlier compatibility build from affecting the next normal build. Unknown rendering values or duplicate main activities fail preparation. [Android hardware acceleration controls](https://developer.android.com/develop/ui/views/graphics/hardware-accel#control).

This is a compatibility experiment, not a confirmed crash fix or a universal guarantee that every WebView/GPU operation is bypassed. Inspect the final APK's main-activity flag, architecture, offline permissions and signature. Keep the same debug package identity/signing key for an authorized replacement install. Then observe process survival and the rendered welcome screen, exercise the synthetic review flow, and test background/resume and restart. Software rendering may affect drawing or responsiveness; those results need actual device testing.

Local validation passed: all 17 JavaScript tests, including mode switching and activity isolation; full ARMv7 APK build; v2 signature verification; and inspection of the final APK showing only `armeabi-v7a`, main-activity hardware acceleration disabled, no Internet permission, backups disabled and cleartext disabled. Its debug signing certificate matches the earlier test package. No physical-device or emulator operation was performed for this compatibility build; the device retest remains pending.

If it still crashes, retain the app-scoped startup diagnostics, native crash trace and process-exit reason for comparison. Do not repeatedly relaunch, replace the ROM/WebView or change global device security/graphics settings as an automatic workaround. Device installation and validation remain with the authorized device operator. Local test artifacts do not clear public binary-distribution or human-review gates.

The independent Android host checks can be repeated after the native build has generated Tauri's bindings:

```powershell
./src-tauri/gen/android/gradlew.bat -p ./src-tauri/gen/android :app:processX86_64DebugMainManifest :app:compileX86_64DebugKotlin --console=plain
```

This does not replace the full Tauri build or skip any of its packaging checks. The merged manifest is under `src-tauri/gen/android/app/build/intermediates/merged_manifest/x86_64Debug/processX86_64DebugMainManifest/AndroidManifest.xml`.
