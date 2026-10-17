# Windows native verification experiment

This opt-in Windows debug mode connects the encrypted fixed-example service and selected-field assistant sharing to Home's Tauri window. It is not a production vault or a complete Session 2 exit. Android and ordinary offline launches keep their existing behavior.

## Boundary

The native window calls Microsoft's desktop [`IUserConsentVerifierInterop::RequestVerificationForWindowAsync`](https://learn.microsoft.com/en-us/windows/win32/api/userconsentverifierinterop/nf-userconsentverifierinterop-iuserconsentverifierinterop-requestverificationforwindowasync) with its owner HWND. Windows collects the verification input. Home receives a result, never a password, PIN, fingerprint or face image. Only `Verified` emits a fixed success receipt on the supervisor's private child pipe. Cancellation, unavailable facilities, errors, unknown statuses and process failure cannot open access. Microsoft's documented minimum for this desktop interop API is Windows build 22000; older systems are not claimed supported.

The Node supervisor creates the same DPAPI adapter and session controller as the browser experiment, then gates **both** GUI and assistant routes. It passes the fresh GUI URL through stdin to a fixed local debug executable, not a command-line argument or browser link. Neither HTTP nor MCP exposes verification of that gate. The assistant receives only its separate bridge capability. The native window initially shows bundled instructions with no application commands or capability grants; after verification it navigates only to the selected loopback vault page. Other destinations, new windows and downloads are denied.

Verification must finish within three minutes. The resulting visit lasts at most five minutes; separate local/assistant grants still last at most one minute, and disclosure still requires selected record/field approval. Child exit, pipe loss, extra/unexpected output, timeout or a backwards/invalid clock permanently shuts down that service instance. Elapsed time is checked around requests as well as by the timer. Pending reads are withheld and queued changes denied; an already committed write remains truthfully reported as applied with access ended. Restart requires fresh verification and fresh approvals.

**This is an application access gate, not authentication-bound encryption-key release.** DPAPI CurrentUser is unchanged. A hostile same-account process, modified executable, privileged supervisor or the separate developer browser launcher is outside this gate's security claim. There is no signed client/device identity, authentication-bound key, anti-debugging boundary, workstation-lock notification or demonstrated sleep/resume policy. An OS verification result does not prove that the encryption key can only be released after verification. No real household data belongs in either prototype.

## Run locally

With the repository's Windows Rust/MSVC, WebView2 and Node prerequisites installed:

```powershell
npm run build:native
cargo build --manifest-path src-tauri/Cargo.toml --locked
.\src-tauri\target\debug\lunaos-home-preview.exe --windows-verifier-availability
node scripts/windows-vault-native.mjs
```

The availability command reports a status without requesting verification. `available` is not proof of authentication. The interactive launcher intentionally opens a visible native window and trusted Windows prompt. A person must complete it or cancel; never automate, supply, collect or relay verification input.

Use the launcher-provided example ID with `--resume <example-ID>` to reopen that synthetic store. It cannot select arbitrary paths. The launcher prints only the separate assistant bridge environment, for use with `scripts/windows-vault-assistant.mjs` as described in [the assistant guide](windows-assistant.md). Keep capabilities out of logs, issues and model messages. Example ciphertext remains after normal interactive shutdown. Test harnesses remove only their own uniquely identified fixture through bounded adapter cleanup.

For the reproducible interactive probe, run `node scripts/probe-windows-native-vault.mjs` with a person present to complete verification; run again with `--cancel` and choose Cancel in Windows. The harness checks both HTTP roles before/after verification, native page asset requests, actual encrypted records, selected-field sharing and denial after child closure. It removes its own fixture and server. It never automates authentication or native record buttons. A timeout or other failure is a failed check, never a cancellation pass.

## Evidence, 2026-10-17

- Windows x64 debug executable compiled; five Rust tests passed, including canonical loopback URL restrictions and every defined non-success verification result plus unknown/error rejection. These enum tests do not authenticate a person. The actual installed Windows API reported `available`.
- A human completed the real OS prompt. The native process emitted the success receipt, and its WebView requested the vault document, script and stylesheet. Before verification, GUI approval and assistant connection were denied. Afterwards the synthetic HTTP harness created/read both members through actual DPAPI storage and required separate selected-field disclosure before the assistant route returned Alex's label. Terminating the native process then denied GUI and assistant reads. This is **endpoint-driven record evidence**, not native button-click, visual-layout, live-model/native combined acceptance or authentication-bound key proof.
- A separate real prompt returned **Canceled**. Its private status marker and exit code 2 were observed, with no success receipt or vault document/assets loaded. Both routes remained denied. An earlier unattended cancellation attempt timed out and was not counted as cancellation evidence; the explicit retry passed.
- Gate tests cover fragmented/invalid/extra receipts, child error/exit/pipe loss, waiting/visit timeout, late success, delayed timer delivery, backwards/invalid time, separate permissions/disclosure and closure during a pending read with queued edit. These are controlled-child/clock tests, not OS authentication or sleep tests.
- The existing actual DPAPI + HTTP + stdio probe passed again, including encrypted persistence/restart, old capability/grant rejection, scoped sharing, marker inspection and bounded cleanup. All platform-neutral tests pass. Synthetic fixtures, native test processes and loopback servers were cleaned up; no verification input or raw transcript is published.

Native button interaction, real-time five-minute closure, restart with repeated human verification, workstation lock/sleep, native/live-assistant combined flow, authentication-bound keys, pairing, recovery and independent acceptance remain open. Source-only draft publication does not authorize binary distribution or merge. The Android assertion decision remains unchanged; Actions stays disabled.
