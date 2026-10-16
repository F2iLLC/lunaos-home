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

The October 16 native check below verifies the real-client correction sequence and visible service loss. Navigation, new-window and download restrictions still need runtime checks; the Rust checks alone do not establish their behavior in a running WebView. Session 1 remains open.

The shared HTTP client blocks additional writes after an uncertain response until a successful draft refresh. Its lost-response recovery passed automated checks and a desktop browser walkthrough, as recorded in [draft review](draft-review.md#recovering-from-a-lost-connection). The native check below covers a stopped service and a fresh-session refresh, not an applied write whose response was lost. The default offline adapter does not use this HTTP recovery state.

## October 16 Windows native correction check

The operator manually opened the debug executable on Windows 11 build 26300,
using WebView2 155.0.4283.45 (verified from the app's child runtime process).
The actual **Luna OS Home — Fictional assistant review** window was then observed
and operated through Windows pointer and keyboard input. The executable matched
the SHA-256 recorded below; the HTTP/MCP source was unchanged from `3de2e42`.
Only the supplied Alex/Sam fixtures were used, through Claude Code 2.1.291 with
the three Home tools and no other source access.

| Check | Observed result |
| --- | --- |
| Native draft display and review request | Alex's Workplace showed Willow Studio. Needs review disabled Looks right and displayed a clarification prompt. The real model's review tool returned that same draft/person/field at revision 1. |
| Native keyboard reply and real correction | Typed and submitted the fictional Willow Workshop reply in the native app. The model read it at revision 2 and corrected only that field; revision 3 awaited local confirmation. |
| Separate local confirmation | Check for updates displayed Willow Workshop with Please check. A separate Looks right action changed the status to Looks right and the checked count to one. |
| Member isolation and suggestions | Sam still showed Meadow School. Alex's Moonrise Library was unchanged. The library-card suggestion visibly changed to Yes, later and then Not now. These choices did not save records. |
| Stopped service | Ending the temporary Claude/MCP session removed its listener. A native Needs review attempt showed Update not confirmed and the unavailable-service message while retaining the last displayed value. A subsequent attempt was blocked with a refresh-required message. |
| Explicit recovery | A fresh restricted Claude session staged a new fictional draft at the same loopback address. Check for updates replaced the stale display with Willow Studio, zero checked details and no connection error. This is a new draft, not persistence of the prior one. |

The clarification question is generated by Home and repeated by the real model
when explicitly prompted to check review requests. Refresh is also explicit;
this does not demonstrate automatic conversational resumption or unsolicited
updates. No protected vault record exists in this prototype.

This clears the Windows debug assistant-to-native-GUI correction and stopped-service
interaction checks. Default offline Windows lifecycle/discard checks, runtime
navigation/new-window/download guards, installer lifecycle and full redistribution
notices remain separate work. Android, other assistant clients, phone-only hosting,
pairing and protected storage are not validated by this result.

## Earlier offline evidence and outstanding checks

On October 16, the Windows debug executable was rebuilt from the source tree
matching main `3de2e42f37975958256fa65618e77637ed27908f`. Its SHA-256 was
`f64666e522387ee7c6e7a25500dc1e79a6e4aa4840abf125648fb1af1ddb55ef`.
Three Rust argument/navigation tests passed. A fresh Claude Code 2.1.291 session,
restricted to the three Home tools, staged the fictional Alex/Sam profile and its
local browser GUI displayed it. This repeat establishes staging and browser
presentation only. The attempted native-window launch was blocked by the test
environment's approval policy; no native window was available for interaction.
The later manual launch and native correction check above supersede that initial
launch blocker; the blocked automatic launch itself was not bypassed.

The [October 16 Android checks](android.md#october-16-emulator-interaction-and-system-bar-correction)
now supply partial native emulator interaction evidence. They do not validate
the Windows WebView, a physical Android phone, or Android assistant integration.

On Windows 11 x64 with Node 24.19.0, Rust/Cargo 1.99.0 and Visual Studio 2022 C++ Build Tools:

- All 13 JavaScript tests passed, including existing stdio/HTTP integration and new offline correction, stale-edit, discard and session-reset checks.
- The bundled frontend and Windows debug executable built successfully.
- A browser served only the generated files under the shell's frontend policy. The example loaded, a flagged workplace was manually changed, confirmation remained a separate action, and reload cleared the draft. No console errors appeared during that flow. This is not native WebView or Android acceptance evidence.

Remaining: complete the Windows checks listed above, Android keyboard/correction and physical-device acceptance, notices and installer lifecycle, and phone-only/client feasibility. The [Android probe](android.md) records partial native emulator interaction separately. Windows debug/Claude Code correction is now verified; Android assistant connection and ChatGPT compatibility remain unverified. Session 1 stays open; Session 2 remains blocked by its acceptance criteria. Actions remains disabled; these are local checks only.

## Manual acceptance checklist

Record OS/device, build revision, launch result and failures separately for each target. Open the app, expand the home menu, load the example and switch people. Mark Workplace as Needs review, edit it, verify Please check, then confirm it. Test keyboard/touch navigation, narrow screens, discard cancellation/confirmation and reload/relaunch clearing. Verify unavailable assistant reply controls are absent. Repeat the browser/MCP path after adapter changes. A desktop viewport screenshot is not an Android launch.
