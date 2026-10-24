# Session 1: tested paths and client decision

This is the reproducible feasibility handoff for [issue 13](https://github.com/F2iLLC/lunaos-home/issues/13), assessed October 16, 2026. It distinguishes the listed exit checks from product support and later acceptance. Only fictional Alex/Sam fixtures were used. PR #30 was reviewed and merged. The [owner disposition](https://github.com/F2iLLC/lunaos-home/issues/13#issuecomment-6228967004) accepts the proposed Windows assistant/direct Android scope for Session 2, with deferred integrations tracked in [issue 31](https://github.com/F2iLLC/lunaos-home/issues/31). Together with the exit evidence below, this clears the bounded Session 2 handoff; it does not certify the product or change issue metadata.

## Exit-check mapping

| Issue 13 requirement | Evidence and result |
| --- | --- |
| Chosen desktop and mobile builds launch | Observed Windows 11 native launch and Samsung SM-S938U Android 17/API 37 native launch. [Windows build and interaction instructions](native-shell.md); [Android build, installation, artifact hashes and device checks](android.md). These are developer builds, not installers or a distribution release. |
| At least one real assistant path reaches the local GUI | Claude Code 2.1.291 launched the local stdio/HTTP service. Its staged fictional profile appeared in the native Windows debug WebView. [Repeat the real-client check](draft-review.md#repeat-the-real-client-check). Only this client is runtime verified. |
| Flagged field routes to the correct draft and correction | In that native window: Alex's Workplace → Needs review → model reads the field/question → typed reply → model correction → explicit refresh → Willow Workshop / Please check → separate local Looks right. Sam's school stayed unchanged. |
| No saved vault record changes | The probe has only in-memory drafts and no saved-record adapter. Offline discard and close/relaunch visibly clear the draft on Windows and Android. Suggestions only record review choices. This is not proof of production storage security. |
| Unsupported memory, connectors and embedding labeled | Only supplied fixtures were available to the tested client. Hidden memories, Gmail/calendar discovery and an embedded assistant panel were not exercised. Android clearly says no assistant is connected. Provider-specific limits are recorded below. |

The listed technical exit checks have evidence. The broader candidate-client investigation found a product constraint that must be resolved at handoff, rather than treating the Android offline GUI as an Android assistant success.

## Tested path and provider limits

The verified path is **Claude Code on Windows → local stdio MCP process → loopback draft service → Windows native debug review window**. Selected fictional tool input/results reach Claude's model; the GUI is a separate local window. The Android package currently runs the same draft rules offline. It has no network permission, native vault service or assistant transport.

The following are documentation findings checked October 16, not live account or mobile-client tests:

| Candidate | Finding and consequence |
| --- | --- |
| ChatGPT custom MCP | OpenAI documents custom MCP connections as web-only and says local servers are not directly reachable; the configured route uses public HTTPS or Secure MCP Tunnel. We did not configure either or inspect account eligibility. [OpenAI connection guidance](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt). |
| Claude mobile remote connector | Anthropic documents requests as originating from its cloud and requiring a publicly reachable server. That is not a direct private-device connection. [Claude remote connector network requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp). |
| Claude local desktop extension | Anthropic documents local extensions for Desktop/Code, not mobile. Claude Desktop remains a candidate requiring a separate clean synthetic test; Code's success does not establish Desktop compatibility. [Desktop versus remote connectors](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors). |

### ChatGPT route refresh, October 24, 2026

The October 16 custom-MCP row describes the then-reviewed web connector, not every current ChatGPT desktop path. Current official documentation distinguishes these candidates:

| Candidate | Documented route | Home status and decision boundary |
| --- | --- | --- |
| ChatGPT web custom MCP | ChatGPT web accepts an HTTPS server URL or a Secure MCP Tunnel, with workspace permissions and security restrictions. [Custom MCP guide](https://developers.openai.com/api/docs/guides/custom-mcp-server) | No Home endpoint or tunnel was configured or tested. A public endpoint, cloud relay, or tunnel is outside the accepted Session 2 scope. |
| ChatGPT desktop-only plugin | OpenAI documents a local stdio MCP server packaged as a desktop-only plugin, usable only in local desktop threads. Local MCP submission is limited to approved, allowlisted partners. [Desktop-only plugin guide](https://developers.openai.com/plugins/deploy/desktop-only) | A possible computer-only candidate, not verified account eligibility or a working Home connection. It would need a reviewed interaction/disclosure scope, a synthetic-only package, a clean local installation, and an observed tool call before any support claim. The guide gives no exact supported ChatGPT desktop build for this Home experiment. |
| Secure MCP Tunnel | OpenAI documents outbound forwarding through an OpenAI-hosted tunnel endpoint to a private MCP server. [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) | Technically different from a public listener, but still a tunnel and hosted transport path. The accepted Home scope does not authorize configuring or using it. |

These pages do not establish a local stdio plugin path on ChatGPT mobile or verify this account's permissions. No plugin was installed, tunnel created, client connected, or record disclosed for this refresh. ChatGPT and mobile assistant automation remain open under [issue 31](https://github.com/F2iLLC/lunaos-home/issues/31); the verified Windows Claude Code path is unchanged.

Inference: the documented consumer mobile connector routes do not supply the direct private-device transport required here. This is not a claim that every future client or every possible integration is impossible. No public endpoint, tunnel or cloud relay was introduced to manufacture a pass. A locally running client also does not make its hosted model local: production disclosure must still be separately scoped and minimized.

### Local desktop package follow-up, October 24

The [local plugin experiment](chatgpt-local-plugin.md) separates local-marketplace testing from public plugin submission. A self-contained fictional draft package now installs through the local CLI and passes protocol checks against its installed cache copy, plus an automated browser/SDK correction check. The full Windows suite passed 236/236. ChatGPT Desktop 1.2026.190.0 is installed, but a fresh local Work conversation has not yet demonstrated plugin discovery or a live tool call. The earlier paragraph saying no plugin was installed describes the documentation-only refresh, not this later experiment. ChatGPT/mobile acceptance remains open; no tunnel or real records are involved.

## Accepted next-session scope

Proceed with the tested Windows local assistant route and native Android GUI as the first experiment, while keeping phone-only manual vault operation in Session 2. Prove the protected local store, OS unlock, session grants and authenticated direct Windows/Android connection. Keep Android assistant automation and ChatGPT integration explicitly unresolved under issue 31 until a compatible client route is available or a separately reviewed interaction design is approved.

The owner accepted assistant automation on the computer while the phone uses Home directly for this increment, conditional on tracking the deferred capabilities. This changes delivery order; it does not remove Android, phone-only storage, or either provider from the roadmap. No hosted-vault access, cloud relay or tunnel is authorized.

The [architecture decision](../architecture/vault-prototype.md#candidates-to-prove-in-session-2) supplies Android Keystore/application-private no-backup storage, Windows DPAPI key wrapping, maintained authenticated direct transport and user-held backup candidates. These are experiment inputs, not implemented guarantees. Session 2 must select and review concrete libraries, test phone-only foreground operation, and measure suspension, revocation and unknown-write outcomes before claiming support.

## Remaining checks by milestone

- **Handoff:** reviewed prototype plus owner client-scope disposition now establish readiness for the bounded Session 2 experiment. Issue metadata remains unchanged; issue 14's prerequisite is satisfied by evidence and disposition, not by deleting its dependency. The first [Windows storage experiment](windows-storage.md) records its limited result and remaining Session 2 work.
- **Additional prototype coverage:** Windows debug WebView navigation/new-window/download runtime guards and emulator keyboard input. Existing unit checks do not establish these runtime results.
- **Session 2:** encrypted persistence, actual OS key behavior, direct pairing, phone-host lifecycle, expired/revoked grants, and backup/restore experiments. Brief lock/unlock of an offline draft is not a host-suspension test.
- **Later acceptance/distribution:** human finger and plain-language usability, installer lifecycle, complete native license notices, production security/recovery review and supported-version coverage. The converted ARMv7 device remains a separately recorded failed launch; its software-rendering mitigation is unverified.

Physical phone checks now include portrait and landscape keyboards, general Android Back, member selection, manual correction and separate confirmation, suggestion choices, discard cancellation/confirmation, background/resume, brief lock/unlock and visible cold-restart clearing. The Windows offline equivalent and real Claude Code native correction/service-loss flow are recorded in the linked guides. No raw screenshots, logs, device addresses, pairing material, binaries or household data belong in this repository.
