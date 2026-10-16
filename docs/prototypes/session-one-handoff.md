# Session 1: tested paths and client decision

This is the reproducible feasibility handoff for [issue 13](https://github.com/F2iLLC/lunaos-home/issues/13), assessed October 16, 2026. It distinguishes the listed exit checks from product support and later acceptance. Only fictional Alex/Sam fixtures were used. Source review and the client-scope decision are still open; this document does not close the issue or authorize Session 2 automatically.

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

Inference: the documented consumer mobile connector routes do not supply the direct private-device transport required here. This is not a claim that every future client or every possible integration is impossible. No public endpoint, tunnel or cloud relay was introduced to manufacture a pass. A locally running client also does not make its hosted model local: production disclosure must still be separately scoped and minimized.

## Proposed next-session scope requiring an owner decision

Recommend proceeding with the tested Windows local assistant route and native Android GUI as the first experiment, while keeping phone-only manual vault operation in Session 2. Prove the protected local store, OS unlock, session grants and authenticated direct Windows/Android connection. Keep Android assistant automation and ChatGPT integration explicitly unresolved until a compatible client route is available or a separately reviewed interaction design is approved.

This changes the order of assistant availability; it does not silently remove Android, phone-only storage, or either provider from the product roadmap. The owner must decide whether the first increment can have assistant automation on the computer while the phone uses Home directly. If phone-only ChatGPT/Claude automation is required in that same increment, the current transport decision remains blocked. Do not reinterpret that requirement as permission for hosted vault access.

The [architecture decision](../architecture/vault-prototype.md#candidates-to-prove-in-session-2) supplies Android Keystore/application-private no-backup storage, Windows DPAPI key wrapping, maintained authenticated direct transport and user-held backup candidates. These are experiment inputs, not implemented guarantees. Session 2 must select and review concrete libraries, test phone-only foreground operation, and measure suspension, revocation and unknown-write outcomes before claiming support.

## Remaining checks by milestone

- **Handoff:** owner disposition of the client scope above and review of the published prototype. Issue 14 retains its dependency on issue 13.
- **Additional prototype coverage:** Windows debug WebView navigation/new-window/download runtime guards and emulator keyboard input. Existing unit checks do not establish these runtime results.
- **Session 2:** encrypted persistence, actual OS key behavior, direct pairing, phone-host lifecycle, expired/revoked grants, and backup/restore experiments. Brief lock/unlock of an offline draft is not a host-suspension test.
- **Later acceptance/distribution:** human finger and plain-language usability, installer lifecycle, complete native license notices, production security/recovery review and supported-version coverage. The converted ARMv7 device remains a separately recorded failed launch; its software-rendering mitigation is unverified.

Physical phone checks now include portrait and landscape keyboards, general Android Back, member selection, manual correction and separate confirmation, suggestion choices, discard cancellation/confirmation, background/resume, brief lock/unlock and visible cold-restart clearing. The Windows offline equivalent and real Claude Code native correction/service-loss flow are recorded in the linked guides. No raw screenshots, logs, device addresses, pairing material, binaries or household data belong in this repository.
