# Possible wake-word activation on Android

**Status: design note only; no voice feature implemented or approved for implementation.** The candidate device is a converted Echo Show 8 running LineageOS Android 11 with ARM32 (`armeabi-v7a`) userspace and no Google Play services or Play Store. Home currently has no microphone capture, wake-word engine or native assistant transport. Its [resting screen](../prototypes/resting-screen.md) displays a clock and greeting only.

The proposed direction is a **Luna-owned assistant experience**: Luna's wake-word/voice interface, permissions and tools. Alexa is only an analogy for the activation experience, not an integration or restoration target. The underlying speech and language-model engines, providers and local-versus-hosted processing remain undecided. Owning the experience does not imply training a foundation model or entirely offline inference. Existing ChatGPT/Claude plugin feasibility work is separate; this note neither selects those providers for Luna voice nor changes that work's acceptance status.

## Proposed experience and privacy boundary

The user explicitly enables the feature and grants microphone permission after a plain-language explanation. A phrase such as **Hey Luna** is an example, not a final selected phrase. Local detection would trigger a visible listening indicator and optional chime, leave the resting screen through normal Android behavior, and begin a separately configured voice conversation. Preserve Android's security lock; a wake phrase is not authentication and must not expose Home or private records over the lock.

While waiting for the wake phrase, audio processing stays on the device using only transient buffers, with no recording or upload by default. Clearly distinguish **Waiting for wake phrase**, **Listening**, **Muted** and **Unavailable**; provide an accessible stop/mute control that releases capture. Define how these states are communicated while the screen is off. Permission revocation or failure must stop capture, not silently restart it. Post-wake audio handling needs its own disclosure and user authorization: local detection does not authorize streaming audio or sharing vault information with a provider.

## Candidates, not compatibility claims

- **Android VoiceInteractionService:** Android documents that the user-selected voice interaction service is kept running for uses such as background hotword detection. Investigate whether this ROM exposes the assistant selection and supports the needed API-30 lifecycle. Keep detection lightweight and conversation work separate. This does not establish access to a low-power hotword DSP or Alexa-equivalent far-field behavior. [Android reference](https://developer.android.com/reference/android/service/voice/VoiceInteractionService).
- **Explicit foreground microphone service:** investigate as another integration route, with understandable notification and stop controls. Android 11 requires the microphone foreground-service type for applicable apps; starting a foreground service from the background does not itself grant microphone access. Do not assume this route solves screen-off capture or restart behavior. [Android 11 restrictions](https://developer.android.com/about/versions/11/privacy/foreground-services).
- **Porcupine:** a candidate because its Android documentation supports custom wake-word models. The quick start requires an account/AccessKey and includes Internet and recording permissions; verify their purpose and actual runtime/network requirements before considering adoption. Maintained ARM32 binaries, Android 11/custom-ROM operation, model availability, licensing, cost and redistribution rights are unresolved. No engine is selected. [Vendor quick start](https://picovoice.ai/docs/quick-start/porcupine-android/).

Google Play services are not an inherent architectural requirement for a local detector. That does not establish that any particular engine, SDK, assistant or speech service works without them on this device.

## Feasibility work before an implementation decision

1. Verify the actual microphones, audio routing and capture on this ROM using an explicitly authorized test; do not infer access from the original hardware's Alexa capability.
2. Compare maintained engines against ARM32/API 30, account/license requirements, model packaging, offline behavior and measured network activity. Resolve dependency rights and notice obligations before importing one.
3. Test the selected Android integration during screensaver use, screen off, lock, app switching, process death, restart and permission revocation. Define user-controlled re-enablement and rollback; do not bypass background restrictions or change security settings.
4. Measure false activations and missed wakes across distance/noise conditions, including the app's own speech playback. Measure CPU, memory, heat and power use. Agree acceptance thresholds before claiming reliable hands-free operation.
5. Separately specify speech-to-text, assistant connection and text-to-speech after wake: provider/client compatibility, local versus hosted processing, authorization, retention/logging, network failure, cancellation and visible session end. A working detector alone is not a voice conversation.

This note authorizes no capture, engine installation, account creation, license purchase, permission change or voice-provider connection. Any future prototype needs an explicit scope decision and review; current vault/session acceptance gates remain unchanged. References checked October 14, 2026.
