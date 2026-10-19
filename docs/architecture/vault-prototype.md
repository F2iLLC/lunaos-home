# ADR: shared draft service before native vault storage

Status: provisional. Applies to the fictional [Session 1 probe](../prototypes/draft-review.md), not production vault custody. Android is the owner-selected first mobile target; Windows is the initial desktop candidate.

## Decision

Keep the existing web interface and isolate a draft-only domain service. The Windows probe uses Node HTTP plus the official MCP SDK over stdio, sharing one service instance. Both the browser and the explicit Windows debug WebView completed the fictional Claude Code correction round trip; [the native check](../prototypes/native-shell.md#october-16-windows-native-correction-check) records the exact scope. An embedded assistant panel remains untested. There is no saved-record adapter and no production authorization claim.

Evaluate **Tauri with platform-native adapters** as the installable Windows/Android candidate. It can reuse a web interface, but the current Node process is not an Android runtime or a finished Tauri core. A native command adapter and shared contract tests must replace/bridge the experimental transport deliberately; do not bundle a desktop sidecar and claim phone support. The [offline shell probe](../prototypes/native-shell.md) now bundles the shared JavaScript domain and compiles a Windows debug executable without a Node runtime. The [Android probe](../prototypes/android.md) also builds, installs and starts on an Android 16 x86_64 emulator. Neither default offline shell has an assistant transport or persistent storage. The optional Windows debug connection is documented in the native shell probe; Android remains offline. Native interaction is verified for the documented Windows and physical Android combinations. Complete binary notices and installer validation remain distribution work. Tauri prerequisites include Windows build facilities and Android-specific tooling; none of that is established by responsive CSS. [Tauri prerequisites](https://tauri.app/start/prerequisites/).

## Assistant path

The [physical Android check](../prototypes/android.md#october-16-physical-arm64-phone-interaction)
also verifies offline draft editing on the tested ARM64 phone, including portrait
and landscape keyboard input, separate confirmation, system Back and limited lifecycle checks. This does not
establish an Android assistant transport or an always-available phone host.

The observed Claude Code stdio path can launch the local service and exchange fictional drafts. It does not prove Claude Android, Claude Desktop, ChatGPT or embedded GUI support. [Claude Code local MCP documentation](https://code.claude.com/docs/en/mcp).

ChatGPT connection documentation and Secure MCP Tunnel describe additional transport/setup paths, including traffic sent to OpenAI. No tunnel is configured here. A tunnel is not the local phone/computer bridge, and must not be used to work around the epic's no-relay/no-public-vault boundary. Investigate supported local desktop plugin paths and explicit disclosure boundaries before selecting a ChatGPT route; no broad incompatibility claim is made. [Connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

## October 16 client handoff

The [Session 1 assessment](../prototypes/session-one-handoff.md) maps all listed
technical exit checks to evidence and records the dated provider investigation.
The documented mobile connector routes do not offer the required direct local
transport. This is a documentation finding, not a live mobile-client test.
The owner accepted the verified Windows local assistant route plus the native
Android GUI for Session 2, retaining phone-only manual storage. Deferred mobile
assistant automation and ChatGPT integration remain tracked in issue 31; neither
Android nor a provider is removed from scope. The linked handoff records the
explicit disposition. The first [Windows storage probe](../prototypes/windows-storage.md)
checks DPAPI persistence across fresh processes and corruption rejection, without
claiming OS unlock, device-exclusive key custody or a production storage adapter.
No tunnel/public endpoint or hosted-vault exception is approved by this ADR.

## Candidates to prove in session 2

- Android Keystore for device-held key operations, with explicit authentication/lifetime behavior. Verify hardware support on the chosen device; do not assume a passkey supplies an encryption key. [Android Keystore](https://developer.android.com/privacy-and-security/keystore).
- Android application-private storage with explicit backup and transfer exclusions, measured on supported OS versions. Merely setting a flag is not proof that sensitive files never leave the device. [Android backup guidance](https://developer.android.com/privacy-and-security/risks/backup-best-practices).
- Windows user-scoped DPAPI as a key-wrapping candidate, paired with a separately verified OS unlock interaction and protected storage location. DPAPI protection alone is not per-operation user presence or a portable recovery plan. Never collect a Windows password in Home. [CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata).
- The [synthetic direct TLS experiment](../prototypes/direct-vault-tls.md) evaluates mutual certificate authentication, explicit identity approvals and connection-bound grants. Node tests and a separate native Android API36 emulator client prove reads, fresh approval after reconnect and revocation. A separate fictional approval screen also passes End, background, cold-restart and interrupted-connection checks. The [Android identity follow-up](../prototypes/android-native-identity.md) replaces the bundled client key with Android Keystore generation, provider non-exportability, missing-key refusal and explicit replacement enrollment; the emulator reports software security. This does not establish Home GUI/store integration, production two-device enrollment, hardware-backed custody or physical private-network compatibility. Current loopback HTTP must not be repurposed for LAN access, and offline Home keeps its no-network boundary.
- User-held encrypted backup/restore, with recovery usability and key loss tested. No operator escrow. No storage or crypto library is selected by this draft-only slice.

### Android host and custody experiments

The installed offline shell is not a phone-hosted service. Before recommending a phone as the authoritative host, distinguish these proposed experiments from the startup result:

| Experiment | Required observation before accepting the candidate |
| --- | --- |
| Home visible and unlocked | A synthetic local operation completes through the native service, with the approved workflow session and draft identity intact. |
| Switch to an assistant app, lock the screen, or let the phone sleep | Measure whether the service remains reachable; report unavailable or locked truthfully. An unacknowledged operation must not appear saved. |
| Process termination, reboot and reconnect | Stale sessions and queued operations cannot regain write permission; unlock and a new authorization must be required according to the chosen policy. |
| Key custody | Query the actual key's security level and authentication enforcement on a physical device, then test cancellation and invalidation. Emulator success is insufficient evidence of hardware protection. |
| Backup and migration | Test synthetic files against backup, restore and device-transfer paths, including any supported cross-platform transfer. Verify exclusions and recovery separately. |

Android restricts starting foreground services from the background for apps targeting API 31 or later, subject to specific exceptions. A foreground service is therefore an unproven candidate, not an always-available phone-host guarantee. Do not silently change battery settings, add cloud wakeups or route through a public relay to pass the experiment. The supported background behavior and any required visible notification still need design and measurement. [Android foreground-service restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).

For a storage experiment, evaluate the application-private `getNoBackupFilesDir()` location together with explicit version-appropriate extraction rules. Android documents that `allowBackup=false` can still allow device-to-device transfer on some devices; the current manifest check alone cannot meet local-custody acceptance. Include temporary files, journals, attachments and preferences in the eventual exclusion review. No persistent records are introduced by this decision record. [Android backup and transfer rules](https://developer.android.com/identity/data/autobackup).

The key experiment should inspect `KeyInfo.getSecurityLevel()` and the actual key's authentication behavior. Keystore availability does not establish hardware backing, a passkey-based unlock path or recovery after losing the device. These checks refine Session 2 inputs; they do not start that session or clear its prerequisite. [Android Keystore security features](https://developer.android.com/privacy-and-security/keystore).

## Consequences

This proves one real model/client can review through Home while keeping production records out of scope. It also exposes remaining work: automatic review-event delivery, native packaging, phone host lifecycle, source discovery limits, scoped disclosure, family admission, key custody and recovery. The preview's local-origin checks do not authenticate local processes. Do not put real records behind these endpoints or upgrade them into a vault without the later shared authorization contract and security review.

## Enrollment and protected-record follow-up

The [developer enrollment slice](../prototypes/enrolled-protected-record.md) connects
explicit local host controls and Android identity/read confirmations to the existing
Windows DPAPI adapter through the scoped TLS service. The Android screen renders
the actual committed value. Debug certificate/offer provisioning, emulator-loopback
transport and synthetic control driving are explicit limitations; this does not
establish production enrollment, physical LAN or OS user-presence unlocking.

The [Windows verified transport follow-up](../prototypes/windows-verified-transport.md)
connects the existing owned-child verification/session gate to grant issuance,
queued execution and post-read checks. Controlled child/event tests exercise real
TLS and DPAPI. The attended native-to-Android emulator chain passed with real
user-completed Windows verification, a freshly built native binary,
agent-operated fictional approvals and four
protected readbacks, including reconnect/background/restart and damaged-data
refusal. A [separate attended physical-phone run](../prototypes/physical-vault-lifecycle.md)
also demonstrated a direct Wi-Fi read, real Windows lock and brief S3 sleep/wake,
ended host access and denied reconnect. It does not prove extended sleep, other
networks or phone-hosted operation. This application gate does not change DPAPI's
key-release properties. See the linked evidence for exact tested artifacts and
the current acceptance boundary.
