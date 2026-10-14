# Offline native shell probe

This developer build advances [Session 1](../epics/vault-first-two-sessions.md) using fictional data only. It is not an installable vault release or proof of Android support. Android remains the first mobile target; Windows is the initial desktop candidate.

## Scope

The Tauri shell bundles the existing interface and the same `lib/drafts.js` rules used by the Node HTTP/MCP preview. An offline adapter owns one draft in WebView memory. Users can load the example family, flag a detail, edit it, confirm it, skip it, consider suggestions and discard the draft. Closing or reloading clears it. There is no encrypted persistence, filesystem command, pairing, assistant connection or production grant system.

The native entry point selects the offline adapter before loading the interface. It does not start or package Node, the HTTP server or the MCP SDK. The shell has no custom Rust commands or plugins, no configured capability grants and a frontend policy that blocks network connections. These are limits of this probe, not a security certification or a guarantee about operating-system/WebView background behavior.

**Needs review** explains that no assistant is connected and offers manual editing. The browser/Node preview retains its separate Claude Code connection; the two previews do not share live state. A native assistant transport is still necessary before accepting the session.

## Build locally

Install Node.js 24+, Rust stable MSVC, Windows C++ build tools and WebView2 following [Tauri prerequisites](https://tauri.app/start/prerequisites/). Use an isolated development environment and fictional data.

```sh
npm ci --ignore-scripts
npm test
npm run build:native
npm run native:build
```

The last command produces a debug executable without an installer. Generated frontend files are in `native-dist/`; the Windows executable is `src-tauri/target/debug/lunaos-home-preview.exe`. Build artifacts, generated mobile projects and toolchains are excluded from source control. The moon icon is original artwork; regenerate sizes with `npm run native -- icon src-tauri/icons/source.svg`.

Installer bundling is disabled. Do not distribute native binaries yet: complete the native dependency notice bundle, including applicable source-availability obligations, before changing that setting. The frontend notice page includes Home and Zod licenses and identifies the incomplete native notices. See [dependency provenance](../../THIRD_PARTY.md).

## Verified and outstanding

On Windows 11 x64 with Node 24.19.0, Rust/Cargo 1.99.0 and Visual Studio 2022 C++ Build Tools:

- All 13 JavaScript tests passed, including existing stdio/HTTP integration and new offline correction, stale-edit, discard and session-reset checks.
- The bundled frontend and Windows debug executable built successfully.
- A browser served only the generated files under the shell's frontend policy. The example loaded, a flagged workplace was manually changed, confirmation remained a separate action, and reload cleared the draft. No console errors appeared during that flow. This is not native WebView or Android acceptance evidence.

Remaining: exercise the Windows and Android WebViews; complete notices and installation/uninstallation checks; verify phone-only lifecycle; and prove the assistant-to-native-GUI path. The Windows process and WebView debugger also started, but the inspector frontend was unavailable, so rendering/interactions remain unverified. The [Android probe](android.md) records a successful full debug APK build, installation and two cold process launches on an Android 16 x86_64 emulator, with native on-screen checks still pending. Native assistant connection and ChatGPT compatibility remain unverified. Session 1 stays open; Session 2 remains blocked by its acceptance criteria. Actions remains disabled; these are local checks only.

## Manual acceptance checklist

Record OS/device, build revision, launch result and failures separately for each target. Open the app, expand the home menu, load the example and switch people. Mark Workplace as Needs review, edit it, verify Please check, then confirm it. Test keyboard/touch navigation, narrow screens, discard cancellation/confirmation and reload/relaunch clearing. Verify unavailable assistant reply controls are absent. Repeat the browser/MCP path after adapter changes. A desktop viewport screenshot is not an Android launch.
