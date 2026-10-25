# Vehicle conversation latency

The owner reported that the parked cellular conversation worked, with noticeable latency. That is owner-reported audible success for the cellular slice, not an independent measurement of every recognition, route, outage or greeting acceptance case. This change measures the stages and reduces avoidable audio-transfer round trips while preserving the configured model, voice, speech model, TLS identity, parked consent and playback route checks.

## Transfer change

Previously, every 4,096-byte audio chunk waited for its own phone-to-Home response before requesting the next chunk. A 323,266-byte reply requires 79 such round trips. The new phone client sends at most eight read-only audio requests together, then consumes their ordered responses before sending another window. The same reply needs ten windows. It also buffers TLS input instead of repeatedly entering the TLS stream for individual bytes.

No wire-size or admission limit was raised: requests and individual responses remain bounded to 8 KiB, the host queue remains capped at eight, a conversation connection allows at most 1,024 messages and total audio remains at most 2 MiB. Every sequence, offset, next offset, chunk length and final-chunk flag is checked. Failed partial windows close their socket and retry from the last fully received window, using the existing three-reconnect budget and turn deadline. Unknown jobs and trust failures fail closed. Only audio reads pipeline; no model/speech ask, clear, cancel or record mutation is batched or automatically replayed.

Playback still waits for the complete validated WAV. This is not streamed speech generation or partial-answer playback. Replies have no added lead-in, startup greetings retain four seconds, and the selected Bluetooth route is verified after seek before unmuting. The change does not alter voice identity or provider models to trade quality for speed.

## Content-free measurements

Home returns two numeric durations with ready replies: model generation and speech generation. These live only with the existing expiring in-memory job. Old hosts without timing fields remain compatible and report unavailable timing as `-1`.

After a foreground reply reaches the unmute gate, the debug app writes only the latest numeric timings to app-private, backup-excluded `vehicle-latency.json`. File I/O runs on the worker, outside audio-route preparation. A new submitted question or explicit Clear removes the previous sample. No transcript, audio, request/conversation identifier, vehicle name, voice ID, network address, timestamp or credential is stored in this diagnostic; it is not an analytics history or upload.

| Field | Interval |
| --- | --- |
| `recognitionFinalizeMs` | Recognizer end-of-speech callback to final words; `-1` for typed input or absent callback |
| `connectionMs` | TCP/TLS connection plus enrolled resume |
| `modelMs` | Home's answer-provider call |
| `speechMs` | Home's speech-provider call through complete PCM receipt |
| `readyMs` | Ask to ready status observed on phone, including providers, polling and network overhead |
| `transferMs` | Ready to complete validated audio download, including any read recovery |
| `routeReadyMs` | Local playback preparation to successful route-gated unmute |
| `afterSpeechToUnmuteMs` | Recognizer end-of-speech callback to unmute; `-1` for typed input |

These intervals overlap: do not add `modelMs` and `speechMs` to `readyMs` again. Silence detection before the recognizer's end-of-speech callback and acoustic/Bluetooth delay after unmute are not measured. Unmute is not proof of actual first sound or complete playback.

Read the last attended sample without starting a microphone:

```text
adb -s <phone> shell am instrument -w -e mode last-conversation-timing io.github.f2illc.lunaos.home.vehicleprobe/io.github.f2illc.lunaos.directtlsprobe.VehicleProbe
```

## Controlled phone comparison

With provider usage authorized, run:

```text
adb -s <phone> shell am instrument -w -e mode conversation-latency -e allowProviderTest true io.github.f2illc.lunaos.home.vehicleprobe/io.github.f2illc.lunaos.directtlsprobe.VehicleProbe
```

The diagnostic makes **one** fixed fictional paid turn, measures its stages, then downloads that same completed audio in window order `1, 8, 8, 1`. It compares all bytes and reports only durations/counts. The repeated downloads do not call either provider again. Counterbalancing reduces ordering bias but is not a statistically representative cellular benchmark. Cleanup clears the test conversation, so run before attended use. There is no microphone or playback. The original turn deadline and reconnect budget also bound these additional reads.

Use `remote-readiness` immediately before the comparison: Wi-Fi must be disabled, cellular and VPN active, enrolled TLS reachable, and adb reverse absent. USB may carry diagnostics/installations but never the network route. Preserve the original APK signing identity and restore the phone's prior Wi-Fi setting afterward. An attended spoken turn is needed to measure recognition finalization and route preparation.

## Evidence so far

- A live host-only fictional request using the existing privately configured providers measured **1,226 ms model generation**, **1,817 ms speech generation**, 91 answer characters and 323,266 audio bytes. This is one provider sample, not a phone or end-to-end result.
- All **309 local Windows tests passed**. The JVM recovery tests execute the production conversation client with interrupted windows, outage, cancellation, trust failure and corrupted chunks. A real enrolled TLS test transfers the entire 2 MiB limit with eight outstanding reads, verifies every frame/offset and reconstructs identical audio with exactly one answer and speech generation.
- Full Home ARM64 and isolated harness Android builds succeeded. The timing/faster-download build must be installed with the existing signing key before physical comparisons.
- Cellular serial/windowed measurements and attended recognition/route timing remain pending phone reconnection. No numerical phone speedup or improved audible latency is claimed from provider timings or local tests alone.
