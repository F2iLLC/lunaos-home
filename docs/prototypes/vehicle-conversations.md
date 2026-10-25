# Parked vehicle conversation v0.2

This extends the vehicle endpoint with an attended question-and-answer flow. It reuses Home's paired TLS transport, Android Keystore identity, host pin, MCP assistant server, voice configuration, silent lead-in and tested route gate. Greetings continue to work offline independently. This is a debug-only development slice; it does not add driving controls, location, calendars, a wake word, a background microphone, an Android Auto dashboard app, or vehicle telemetry.

## Phone flow

Open vehicle setup, then **Talk while parked**. The conversation screen uses the vehicle nickname saved on the phone. Explicitly confirm you are parked and want to share this conversation. Tap **Speak to [nickname]**, grant microphone access, and tap again if needed after the permission dialog. The phone uses Android's on-device recognizer only. If its local English recognition model is unavailable, type a question instead; there is no silent switch to a network recognizer. The phone microphone is used, not an assumed vehicle microphone.

On Android 17 with target API 37, use **Allow Home connection** in setup to request the system local-network permission. Entering the conversation screen also checks this permission, and starting a question checks it again. Denial leaves offline greetings available. The isolated harness now targets API 37, matching Home's generated debug app; Android can otherwise report an app-specific connection timeout even when an adb shell can reach the same host. See [Android local-network permissions](https://developer.android.com/privacy-and-security/local-network-permission).

The recognized question (at most 1,000 characters) goes to the enrolled Home host. Home asks its configured model connection for a brief answer using only the last four completed exchanges and the new question. The answer (at most 360 characters) goes to ElevenLabs in the explicitly selected voice. The provider receives answer text and the voice ID; the phone receives PCM speech through paired TLS. Chat replies have no added silent lead-in; startup greetings retain four seconds. Model generation, speech synthesis, transfer and route readiness add their own latency. The actual selected A2DP output is checked again after seeking before unmuting. There is no phone-speaker fallback.

The screen shows the recognized question, answer and conversation ID. It uses Android's secure-window flag to exclude it from ordinary screenshots/recents captures. Leaving the screen, removing the parked confirmation, tapping Stop, losing the selected media connection, or losing audio focus stops the applicable recording/playback. Cancellation attempts to stop in-flight Home work; content already sent to providers cannot be recalled. The greeting trip marker is not consumed by a conversation reply.

## Host setup and disclosure

`scripts/vehicle-assistant.mjs` remains the host entry point. Its existing external private configuration and enrolled public phone certificate must be configured first. Add these explicit fields to enable conversation independently of greetings:

- `vehicleConversations: true`
- `assistantDisclosure: true`
- `speechDisclosure: true`
- `voiceId`: the owner's selected voice ID (must match phone setup)
- optional `speechModel`: a supported ElevenLabs model; default `eleven_multilingual_v2`
- optional `vehicleNickname`: the conversational name for this endpoint, 1–40 characters; configure it to match the phone's nickname

The nickname is an owner-configured presentation profile for the same Home assistant, not a separate assistant, household or permission scope. When supplied, Home includes it in the model instructions and asks the model to use it when introducing itself. That shares the configured name with the selected model provider; the greeting event still omits the phone's names and Bluetooth address. No private nickname is included in source. This does not automatically connect household preferences, records, calendars or another chat's memory; the preview still has only the bounded conversation it is explicitly given.

Supply the speech credential through the host-only `LUNA_HOME_ELEVENLABS_API_KEY` environment variable using an authorized private credential facility. Do not put it in the phone config, checkout, command arguments, logs, model context or PR. Provider processing and retention policies apply; this preview makes no zero-retention claim. Speech is billed by the provider. There are no automatic chargeable retries.

For direct OpenAI hosting, set `assistantProvider: "openai"` and provide the host-only `LUNA_HOME_OPENAI_API_KEY`. Set `mcpStdio: false` to run without a connected MCP client. An optional `port` (1–65535) keeps the phone's configured destination stable across host restarts; omitting it selects an ephemeral development port. An optional `assistantModel` overrides `gpt-6-luna`. The adapter explicitly uses `reasoning.effort: "none"` and low text verbosity for brief spoken replies; [GPT-6 Luna supports this reasoning setting](https://developers.openai.com/api/docs/models/gpt-6-luna), and any override must support both settings. Existing hosts with an explicit `assistantModel` must update that value to use the new default. The host reads only its explicitly supplied namespaced environment variables; it does not discover keys or load another application's environment file.

The direct adapter calls the fixed [OpenAI Responses endpoint](https://developers.openai.com/api/reference/resources/responses/methods/create), with `store: false`, no tools, no prior response ID and only the bounded supplied conversation. Provider policies still apply; `store: false` is not a zero-retention guarantee. It caps output at 256 tokens, requires a completed text answer within the existing 360-character limit, bounds the response body to 64 KiB and cancels after 30 seconds or session cancellation. Incomplete, oversized, refused or failed output reports unavailable rather than being spoken. It never retries chargeable requests automatically or returns raw provider errors. The model and speech credentials never reach the phone or model context. Using the OpenAI API is billed separately from a ChatGPT subscription.

The default `assistantProvider: "mcp"` preserves Home's older sampling compatibility path. It requires a connected MCP client advertising and handling `sampling/createMessage`; signing into an unrelated chat does not supply it. [Sampling is deprecated in MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling). Use direct hosting for a standalone runtime. Optional MCP greeting-style selection still requires a sampling client; leave `assistantStyleSelection` disabled when `mcpStdio` is false. MCP transcript handoff remains available when the direct provider is used with MCP stdio enabled, without replacing the direct answer adapter.

The enrolled phone's existing external `config.json` also needs `vehicleConversations: true`. This does not create any vault read/write grant. The host approves conversation for only its configured enrolled peer and voice. Greetings have their own permission. Existing network restrictions remain: TLS binds to loopback or a literal private IPv4 address. A reachable LAN or owner-configured private VPN is needed; this work does not publish a public endpoint or configure an away-from-home relay. No firewall or network-classification change is made automatically.

## State, continuity and limits

Each request has a random ID. Repeating the same ID and text returns the same job instead of generating/charging again. Reusing it with different text, concurrent new questions, or a previous completed request ID is rejected. One session permits up to 32 questions; clear the conversation to start over. At most eight explicitly granted peers can hold conversation state.

Home keeps the last four completed question/answer pairs in memory. It expires the conversation after 15 minutes without a new question, clears it on explicit Clear or peer revocation, and loses it on restart. Failed turns are not appended. The most recent reply audio is bounded to 2 MiB and discarded on cancellation, replacement or session expiry. No audio/transcript is written to the host repository or disk by this service. The phone uses temporary app-private audio and deletes it after playback/cancellation; it does not archive recordings or transcripts.

Home's `home_vehicle_conversation` MCP tool accepts the conversation ID shown on the phone and returns that bounded shared transcript. The owner can supply the ID to the connected Home assistant to continue discussing the same exchange at home. This is explicit context handoff, not automatic syncing with every existing chat or durable cross-device memory.

The model has no tools or private records supplied by this service. Its instructions forbid invented access, vehicle condition and completed actions. This is a prompt constraint, not proof of factual accuracy; the answer remains model-generated. The MCP client's own behavior and external provider policies are outside the host's enforcement boundary.

## Validation

Run `node --test test/vehicle-model.test.js test/vehicle-conversations.test.js test/vehicle.test.js test/vehicle-voice.test.js test/android-vault-wiring.test.js`, then the full `npm test`. Build Home's Android debug APK and the isolated vehicle harness using the existing procedures. Install harness updates with its original signing key to preserve the selected vehicle, voice and trip state.

Automated tests use only fictional content. They cover separate consent/grants, actual TLS admission, MCP sampling without inherited context, retry idempotency, bounded conversation handoff, audio chunk reconstruction, provider failures, malformed/oversized audio, expiry, revocation and late-answer suppression. Existing trip and route-gate tests remain applicable to greeting suppression and safe output selection.

For attended acceptance, keep the vehicle parked:

1. Confirm the host is reachable without USB and the phone says Home has acknowledged its vehicle session.
2. Open the conversation screen and opt in. Ask a harmless question. Verify the recognized words, a real assistant answer, the chosen voice and complete playback through the selected vehicle audio.
3. Ask a follow-up referring to the prior answer. Verify context continuity. Use the displayed ID with Home's MCP tool and verify the same exchange is available there.
4. Stop mid-listening, leave during a pending answer, disconnect media audio, and interrupt playback with an audio-focus owner. No later answer may restart audio after cancellation or reach another output.
5. Clear the conversation and confirm the Home tool can no longer read it. Check local expiry separately. Verify an offline trip still produces one cached greeting and a brief reconnect stays quiet.

Keep live evidence private. A compiled APK or synthetic provider response does not establish speech recognition, provider access, LAN reachability, vehicle audibility, locked-phone greeting wake, or away-from-home connectivity.

The isolated harness supports an additional read-only diagnostic: `adb -s <selected-phone> shell am instrument -w -e mode conversation-capability io.github.f2illc.lunaos.home.vehicleprobe/io.github.f2illc.lunaos.directtlsprobe.VehicleProbe`. It reports on-device recognition availability, microphone permission and whether Home conversation is configured. It does not start the microphone, capture speech, or contact a provider. Availability alone does not establish that the local English model recognizes a spoken question.

With provider usage authorized and the paired host configured, `-e mode conversation-check -e allowProviderTest true` sends one fixed synthetic question through the phone's real TLS client, downloads the generated reply audio, reports only character/byte counts and clears the conversation. It calls the configured model and speech providers and can incur charges. It never records or plays audio and does not test the parked UI or vehicle route. Run it only before an attended session: its cleanup clears the current shared conversation.
