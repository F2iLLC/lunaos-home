# Native shell probes

This developer build advances [Session 1](../epics/vault-first-two-sessions.md) using fictional data only. It is not an installable vault release or proof of Android support. Android remains the first mobile target; Windows is the initial desktop candidate.

## Default offline scope

The Tauri shell bundles the existing interface and the same `lib/drafts.js` rules used by the Node HTTP/MCP preview. An offline adapter owns one draft in WebView memory. Users can load the example family, flag a detail, edit it, confirm it, skip it, consider suggestions and discard the draft. Closing or reloading clears it. There is no encrypted persistence, filesystem command, pairing, assistant connection or production grant system.

The native entry point selects the offline adapter before loading the interface. It does not start or package Node, the HTTP server or the MCP SDK. The shell has no custom Rust commands or plugins, no configured capability grants and a frontend policy that blocks network connections. These are limits of this probe, not a security certification or a guarantee about operating-system/WebView background behavior.

**Needs review** explains that no assistant is connected and offers manual editing. The browser/Node preview retains its separate Claude Code connection; default offline launches do not share its live state. The optional Windows debug probe below tests a route to that service; the full native assistant review flow remains an acceptance requirement.

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

## Optional Windows assistant review probe

Windows **debug builds only** accept an explicit local review URL. Start a synthetic MCP session as described in [draft review](draft-review.md#connect-a-local-mcp-client), ask the client to stage fictional data, and keep that session open. Use the exact URL returned by `home_stage_draft`:

```powershell
.\src-tauri\target\debug\lunaos-home-preview.exe --fictional-review-url http://127.0.0.1:4183/#vault
```

Replace 4183 with the returned port. This opens the existing HTTP interface inside the Windows WebView, with the same draft and review API that the MCP session owns. It does not start Node, select a client, approve tools or stage data automatically. Closing the window does not clear the server's draft; ending the MCP session stops its server and clears its in-memory state. If the service stops, this probe has no offline fallback or automatic reconnection. Restart the synthetic session and open its newly returned URL.

Only a canonical `http://127.0.0.1:PORT/#vault` address is accepted, with a nonzero, non-default port and no credentials or query. Navigation is limited to that origin's root and the welcome, vault and checklist fragments. New windows and downloads are denied. No commands, plugins or native capability grants are added. The HTTP page uses the server's same-origin content policy, rather than the bundled offline page's `connect-src 'none'` policy. This is an unauthenticated development service: another local process can access it. Never use real records, a LAN address or a tunnel.

The mode is excluded at compile time from Android and release builds. Launching without arguments still uses the offline adapter. It does not establish Android networking, pairing, encryption, production permissions or support in ChatGPT or other Claude clients.

After building the debug executable, run the opt-in startup smoke check:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline
node scripts/smoke-windows-review.mjs
```

The smoke script stages the supplied fixture through an in-memory SDK client, starts a fresh loopback service, launches the executable, records HTTP paths/statuses and closes its process and service. It is not a real model call or a GUI interaction test. On October 14, 2026, the Windows process remained alive for 12 seconds and its WebView loaded the page, five JavaScript/CSS resources and `/api/draft`, all with HTTP 200. Three Rust tests passed for launch arguments and navigation boundaries; all 26 JavaScript tests passed. The debug executable built with locked, offline dependencies.

Still required: observe the native screen and repeat the real-client flag → question → reply → correction → local confirmation sequence, test service loss visibly, and verify the navigation/download restrictions in the running WebView. Request traces do not prove displayed content or user interaction. Session 1 remains open.

The shared HTTP client now blocks additional writes after an uncertain response until a successful draft refresh. Its lost-response recovery passed automated checks and a desktop browser walkthrough, as recorded in [draft review](draft-review.md#recovering-from-a-lost-connection). This does not clear the native service-loss check above. The default offline adapter does not use this HTTP recovery state.

## Earlier offline evidence and outstanding checks

On October 16, the Windows debug executable was rebuilt from the source tree
matching main `3de2e42f37975958256fa65618e77637ed27908f`. Its SHA-256 was
`f64666e522387ee7c6e7a25500dc1e79a6e4aa4840abf125648fb1af1ddb55ef`.
Three Rust argument/navigation tests passed. A fresh Claude Code 2.1.291 session,
restricted to the three Home tools, staged the fictional Alex/Sam profile and its
local browser GUI displayed it. This repeat establishes staging and browser
presentation only. The attempted native-window launch was blocked by the test
environment's approval policy; no native window was available for interaction.
The pending manual launch must be verified before counting a Windows native
correction flow. The synthetic session can be kept open for that handoff.

The [October 16 Android checks](android.md#october-16-emulator-interaction-and-system-bar-correction)
now supply partial native emulator interaction evidence. They do not validate
the Windows WebView, a physical Android phone, or Android assistant integration.

On Windows 11 x64 with Node 24.19.0, Rust/Cargo 1.99.0 and Visual Studio 2022 C++ Build Tools:

- All 13 JavaScript tests passed, including existing stdio/HTTP integration and new offline correction, stale-edit, discard and session-reset checks.
- The bundled frontend and Windows debug executable built successfully.
- A browser served only the generated files under the shell's frontend policy. The example loaded, a flagged workplace was manually changed, confirmation remained a separate action, and reload cleared the draft. No console errors appeared during that flow. This is not native WebView or Android acceptance evidence.

Remaining: exercise the Windows and Android WebViews; complete notices and installation/uninstallation checks; verify phone-only lifecycle; and prove the assistant-to-native-GUI path. The Windows process and WebView debugger also started, but the inspector frontend was unavailable, so rendering/interactions remain unverified. The [Android probe](android.md) records a successful full debug APK build, installation and two cold process launches on an Android 16 x86_64 emulator, with native on-screen checks still pending. Native assistant connection and ChatGPT compatibility remain unverified. Session 1 stays open; Session 2 remains blocked by its acceptance criteria. Actions remains disabled; these are local checks only.

## Manual acceptance checklist

Record OS/device, build revision, launch result and failures separately for each target. Open the app, expand the home menu, load the example and switch people. Mark Workplace as Needs review, edit it, verify Please check, then confirm it. Test keyboard/touch navigation, narrow screens, discard cancellation/confirmation and reload/relaunch clearing. Verify unavailable assistant reply controls are absent. Repeat the browser/MCP path after adapter changes. A desktop viewport screenshot is not an Android launch.
