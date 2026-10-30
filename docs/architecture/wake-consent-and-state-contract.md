# Wake and voice architecture options and contract

**Status: proposed feasibility contract for #135.** This document and its pure reducer/tests do not enable a microphone, select a speech engine or provider, or establish attended device support. The product/voice-host decision remains unresolved.

## Architecture options

| Option | Wake and voice owner | Home boundary | Evidence and open question |
| --- | --- | --- | --- |
| Home-owned local activation | Home owns the wake interface and local pre-wake detector; a separately chosen conversation host may receive explicitly approved post-wake content. | Home owns consent UI, visible state, local session, and the shared GUI/MCP application service. | Historical direction in merged #22. Requires rights-reviewed detector choices, target-device/OS microphone and background feasibility, and attended evaluation. No engine is selected. |
| Existing assistant voice host | The user's assistant owns wake recognition, microphone capture, and conversation. | Home receives only supported, user-authorized MCP/tool calls through its shared local service; it must not claim to observe host microphone or wake state when it cannot. | Current README direction. #31 records that supported client/device routes and exact versions remain unverified. No client or provider is selected here. |
| No always-on wake | User starts a conversation through an explicit tap/hold action in an approved surface. | Home still owns the visible consent, tool/session, and data boundaries. | Fallback if background microphone, device support, rights, or resource gates fail. It avoids pre-wake capture but does not settle which assistant owns speech. |

The owner must decide whether V1 includes always-on local activation, relies on the user's assistant voice host, or starts with a manual interaction. The exact device/OS/ABI and post-wake conversation boundary also need a decision. Until then, Home must not promise a wake phrase, a microphone indicator it cannot observe, or a supported assistant route.

## Consent and data path

1. **Local waiting opt-in:** off by default. A separate explicit choice enables local wake detection. An OS microphone permission result is a distinct prerequisite, not consent by itself. Wake phrases never authenticate a person or unlock vault records.
2. **Pre-wake:** microphone use, if eventually approved, is local detector input only. The proposal caps any rolling RAM buffer at 2 seconds and discards it on overwrite, mute, cancel, lock, unavailable state, and session end. No pre-wake audio persistence, upload, telemetry, or network access.
3. **Post-wake command capture:** local command capture is visible and cancellable. Silence timeout or cancel ends capture and clears transient input. Detector signals carry stable event IDs; a bounded 64-ID recent window suppresses duplicate delivery, including after later sessions.
4. **Post-wake disclosure:** a separate, explicit approval names the destination, purpose, and selected content for this command. The prompt and destination selection are bound to the current session generation; stale approval callbacks cannot authorize a later command. The mock contract forwards only approved field names; raw audio is not part of this contract and would require its own explicit content/destination decision. Without approval, processing stays local and no network effect is emitted.
5. **Response and revocation:** a response is accepted only for the current session generation. Revocation cancels future work and returns to a safe state. If content was already sent, Home must say it may not be retractable.
6. **Security lock:** forces muted state, stops capture, clears transient audio, and invalidates callbacks. Unlock alone never restarts listening; a new explicit user action is required.

The 2-second cap is a proposed testable bound, not a measured or owner-approved device setting. It must be ratified or replaced before any detector implementation. The reducer encodes policy effects only; it does not read audio, invoke OS permissions, contact an assistant, or write storage.

## States and transitions

| State | Microphone policy | Network policy | Persistent audio | Entry/exit rules |
| --- | --- | --- | --- | --- |
| Disabled | Off | None | Never | Initial/default; local listening consent revoked. |
| Waiting for wake phrase | Local detector only | None | Never | Requires separate local opt-in plus observed OS permission. |
| Listening to command | Local command capture | None until separate disclosure | Never | One active generation; duplicate wake ignored; silence/cancel clears input. |
| Processing | Off | None unless a one-command disclosure was explicitly approved | Never | Missing approval shows a disclosure prompt and does not forward. |
| Speaking | Off | No additional content submission | Never | Only current-generation response; assistant/voice-host implementation remains undecided. |
| Muted | Off | None | Never | User mute or security lock; unlock does not resume automatically. |
| Unavailable | Off | None | Never | Missing/revoked microphone permission or unavailable host; restoring a prerequisite does not restart listening. |

The synthetic transition API emits named effects such as `START_LOCAL_DETECTOR`, `PROMPT_FOR_POST_WAKE_DISCLOSURE`, and `FORWARD_SELECTED_CONTENT`. The forwarding effect carries only destination, purpose, selected field names, and session generation—never audio or transcript values. Host availability is an independent prerequisite and cannot be restored by changing local consent or microphone permission. The reducer is not connected to production adapters.

## Validation boundary

`test/wake-contract.test.js` exercises the pure reducer with synthetic events for consent/permission separation, duplicate wake, silence timeout, cancellation, stale callbacks, lock/unlock, disclosure filtering/revocation, bounded pre-wake data path, unavailable state, and no pre-disclosure network or persistence. This is not a microphone, Android lifecycle, background execution, resource, rights, provider, or attended-device test. Those checks belong to separately authorized #136/#137 work and later integration acceptance.
