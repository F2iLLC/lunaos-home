# Android offline preview

This is the Android build path for the [native shell probe](native-shell.md). It uses only the example family and in-memory draft rules. It has no assistant connection, vault storage or phone/computer bridge. Android 16 / API 36 on an x86_64 Pixel 7 emulator is the initial test target; a physical phone is a separate acceptance check.

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

For an ARM64 build check, use `--target aarch64` instead of `--target x86_64`. Both commands use the same generated `universal/debug/app-universal-debug.apk` output location, so a later build replaces that file. Inspect its `lib/` entries before choosing a device; the directory name does not guarantee multiple architectures. The ARM64 package has been built and inspected, but has not been installed or launched on a physical phone.

The pinned Tauri CLI generates `src-tauri/gen/android`; keep this machine-specific tree ignored. The Android configuration invokes `scripts/prepare-android.mjs` before building. That script removes the generated Internet permission, fixes cleartext traffic to false and sets `allowBackup=false`. It refuses unexpected permissions/template changes instead of quietly widening access. Inspect the merged APK manifest as well; a source-manifest test alone is not platform enforcement evidence. Backup/transfer behavior still requires Session 2 experiments before any sensitive use.

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

The independent Android host checks can be repeated after the native build has generated Tauri's bindings:

```powershell
./src-tauri/gen/android/gradlew.bat -p ./src-tauri/gen/android :app:processX86_64DebugMainManifest :app:compileX86_64DebugKotlin --console=plain
```

This does not replace the full Tauri build or skip any of its packaging checks. The merged manifest is under `src-tauri/gen/android/app/build/intermediates/merged_manifest/x86_64Debug/processX86_64DebugMainManifest/AndroidManifest.xml`.
