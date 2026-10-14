# ADR: shared draft service before native vault storage

Status: provisional. Applies to the fictional [Session 1 probe](../prototypes/draft-review.md), not production vault custody. Android is the owner-selected first mobile target; Windows is the initial desktop candidate.

## Decision

Keep the existing web interface and isolate a draft-only domain service. The Windows probe uses Node HTTP plus the official MCP SDK over stdio, sharing one service instance. Use a local browser window until embedded presentation and its data path are proven. There is no saved-record adapter and no production authorization claim.

Evaluate **Tauri with platform-native adapters** as the installable Windows/Android candidate. It can reuse a web interface, but the current Node process is not an Android runtime or a finished Tauri core. A native command adapter and shared contract tests must replace/bridge the experimental transport deliberately; do not bundle a desktop sidecar and claim phone support. The [offline shell probe](../prototypes/native-shell.md) now bundles the shared JavaScript domain and compiles a Windows debug executable without a Node runtime. It has no assistant transport or persistent storage. Native UI acceptance, Android tooling/build/launch, complete binary notices and installer validation remain feasibility work. Tauri prerequisites include Windows build facilities and Android-specific tooling; none of that is established by responsive CSS. [Tauri prerequisites](https://tauri.app/start/prerequisites/).

## Assistant path

The observed Claude Code stdio path can launch the local service and exchange fictional drafts. It does not prove Claude Android, Claude Desktop, ChatGPT or embedded GUI support. [Claude Code local MCP documentation](https://code.claude.com/docs/en/mcp).

ChatGPT connection documentation and Secure MCP Tunnel describe additional transport/setup paths, including traffic sent to OpenAI. No tunnel is configured here. A tunnel is not the local phone/computer bridge, and must not be used to work around the epic's no-relay/no-public-vault boundary. Investigate supported local desktop plugin paths and explicit disclosure boundaries before selecting a ChatGPT route; no broad incompatibility claim is made. [Connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

## Candidates to prove in session 2

- Android Keystore for device-held key operations, with explicit authentication/lifetime behavior. Verify hardware support on the chosen device; do not assume a passkey supplies an encryption key. [Android Keystore](https://developer.android.com/privacy-and-security/keystore).
- Android application-private storage with explicit backup and transfer exclusions, measured on supported OS versions. Merely setting a flag is not proof that sensitive files never leave the device. [Android backup guidance](https://developer.android.com/privacy-and-security/risks/backup-best-practices).
- Windows user-scoped DPAPI as a key-wrapping candidate, paired with a separately verified OS unlock interaction and protected storage location. DPAPI protection alone is not per-operation user presence or a portable recovery plan. Never collect a Windows password in Home. [CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata).
- A maintained authenticated direct transport with explicit device identity approval for pairing; no protocol/library selected yet. TLS, key trust, revocation and sleep/retry behavior need an experiment before use. Current loopback HTTP must not be repurposed for LAN access.
- User-held encrypted backup/restore, with recovery usability and key loss tested. No operator escrow. No storage or crypto library is selected by this draft-only slice.

## Consequences

This proves one real model/client can review through Home while keeping production records out of scope. It also exposes remaining work: automatic review-event delivery, native packaging, phone host lifecycle, source discovery limits, scoped disclosure, family admission, key custody and recovery. The preview's local-origin checks do not authenticate local processes. Do not put real records behind these endpoints or upgrade them into a vault without the later shared authorization contract and security review.
