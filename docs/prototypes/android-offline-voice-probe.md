# Android offline voice probe

Version 0.4 adds a separate [background wake test](android-background-wake-probe.md)
and shares its capture worker with the foreground controls. This document records
the preceding foreground design and evidence; use the new document for current
controls, the API 26 minimum and background limitations.

This isolated development APK evaluates a complete spoken phrase on an ARM32
Android device. It does not add voice control to Home. It can optionally hand a
recognized duration to Android Clock after explicit on-screen opt-in. It follows
the [microphone probe](android-microphone-probe.md) and
[native timer probe](native-timer-probe.md). Related work: #135, #136, #137, #148,
and #149; none is completed by installing this probe.

## Candidate and boundaries

The first candidate is Vosk Android 0.3.75, JNA 5.18.1, and
`vosk-model-small-en-us-0.15`. The actual AARs contain `armeabi-v7a` libraries.
The [official model listing](https://alphacephei.com/vosk/models) identifies this
small English model as Apache-2.0 and suitable for mobile use. Vosk and the
Apache-2.0 option of JNA are used. Pinned download URLs and SHA-256 digests are in
`scripts/android-offline-voice-probe/inputs.json`. The build verifies all three
archives before extraction and packages third-party notices with the model.
Downloaded dependencies, model files, APKs and disposable signing material remain
outside the checkout. The notices preserve known native dependency licenses;
this is not a reproducible native-library build or a completed release audit.

Vosk performs constrained speech recognition during an explicitly started
session, including the optional five-minute foreground waiting test. This is not a dedicated always-on keyword detector: microphone input is
processed locally throughout that session, before any wake phrase is matched.
There is no background service, screen-off listening, speaker identification,
or claim about false activations, latency, battery life, or noise robustness.
The model must contain `luna`; a vocabulary lookup fails closed before capture
otherwise. `[unk]` is included so grammar recognition can reject unknown speech.
Constrained recognition can still misrecognize speech; exact text parsing does
not establish acoustic accuracy.

An alternative engine remains an option if this test fails. This candidate was
selected for its packaged ARM32 ABI and account-free local operation, not from a
completed comparative benchmark. Production selection and license review remain
part of #137.

## Capture and matching

- Launch and permission approval never start capture. Start is a separate action.
- Check offline engine initializes the model, vocabulary and recognizer without
  opening the microphone; it can be run without microphone permission.
- Model loading happens with the microphone off. A fresh Start is required after
  leaving or stopping the screen; a canceled loading operation cannot start capture.
- Listening uses 16 kHz mono PCM16, ends on a complete valid command or after
  30 seconds in the original full-command test, and releases capture on Stop or activity pause. Lock, microphone
  mute and permission are checked before capture and during the loop. A UI
  deadline releases capture even while a native decode is pending.
- Final recognition results alone enter the strict parser. The original test accepts
  `hey luna set a timer for <one..sixty> second(s)/minute(s)`, with the matching
  singular or plural. No partial result, missing wake phrase, extra suffix,
  unsupported duration, or previous session's text can trigger a match.
- The display shows only the structured duration or fixed status messages, never
  arbitrary recognized text. No audio or recognition text
  is written to files or logs. Java PCM buffers are cleared after use; engine
  objects and native working memory are released on worker completion. This is
  not a claim of verified erasure of all native copies.
- The manifest requests microphone and normal `SET_ALARM` permissions, excludes backup and has no
  Internet permission. The APK stores only its bundled recognition model in its
  private files directory. Uninstall removes that development copy.

## Foreground wake waiting test

`Enable local wake listening for 5 minutes` is a separate explicit listening
opt-in. Launch, microphone permission approval and resuming the activity never
enable it. The microphone remains on locally while waiting; the screen displays
that state. This test reuses Vosk speech recognition, not a qualified low-power
keyword engine. There is no background service or screen-off support.

Say only `Hey Luna`, then pause until `Awake` appears before saying
`Set a timer for ten seconds`. The waiting recognizer's grammar contains only
`hey luna` and `[unk]`; a complete exact final wake match opens a separate
command recognizer. No partial result opens the command window. The original
complete-phrase Start button remains available as a fallback.

The command window lasts at most ten seconds and never extends the overall
five-minute waiting deadline. Repeated wake results do not extend that window.
Only within it may a final exact bare timer command (or full wake-prefixed
command) match. There is no audio replay between recognizers: speaking the
command before the Awake indicator may lose it. Invalid results never start a
timer. The first valid command or either deadline ends the entire session;
another attempt needs an explicit button tap. Clock handoff still requires the
separate real-timer option and existing per-session authorization gate.

A UI watchdog checks the current deadline and lock/mute/permission every 100 ms,
independently of native decode progress. Stop, activity pause and completion
remove that session's watchdog. The worker checks the same deadline before
accepting final results; the activity identity guard rejects canceled results.
No timers are dispatched after a deadline or cancellation. Native resource
cleanup may finish after microphone release if a decode is pending.

Only a 100 ms Java PCM chunk is passed at a time and then cleared. No application
rolling pre-wake buffer is added; native decoder working memory and the OS audio
buffer are separate, and their lifetime/size is not qualified by this test.
Wake false-activation rate, command accuracy, latency, native resource retention
and power costs remain unmeasured. Do not treat the pure transition tests as
acoustic or lifecycle qualification.

## Optional real timer handoff

Recognition-only remains the default. `Start real timers in Clock (may sound)`
must be checked before starting a session. Changing the option stops any current
session; enabling it later cannot authorize a previous result. The option is
not persisted or restored across activity recreation. The UI scrolls so all
controls and results remain accessible on small displays.

A complete command releases microphone capture and engine resources before the
UI attempts handoff. The foreground activity, permission, unlock/mute state and
current option are checked again. A per-session gate claims at most one dispatch
before launching; duplicate callbacks, unavailable Clock or uncertain launches
never trigger an automatic retry. Returning to or recreating the screen does
not repeat the request or resume capture. New timers require another Start.

The probe uses [Android's timer intent](https://developer.android.com/reference/android/provider/AlarmClock#ACTION_SET_TIMER),
restricted to `com.android.deskclock`, with the parsed duration in seconds,
a fixed synthetic label and `EXTRA_SKIP_UI=false`. Clock may show intermediate
UI; the operator must check its countdown. Clock owns the timer and its sound.
The probe does not change volume or sound, cancel existing timers, or obtain a
timer ID/persistence receipt. Stop only ends listening; cancel or dismiss timers
in Clock. A dispatched intent is not proof of creation, expiry or an audible
alert. Background wake-word listening, voice cancellation and durable Home
shared-timer state remain outside this probe.

## Build and attended test

Requires PowerShell 7, JDK 21, Android SDK platform `android-37.0` and build-tools
`37.0.0`. The APK targets API 30 with minimum API 24 and packages only ARM32.
This manual builder does not install anything or change the Home app.

Download inputs to a new scratch directory outside the checkout:

```powershell
$inputs = Join-Path $env:TEMP ('home-voice-inputs-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $inputs | Out-Null
Get-Content scripts/android-offline-voice-probe/inputs.json -Raw |
    ConvertFrom-Json | ForEach-Object {
        Invoke-WebRequest $_.url -OutFile (Join-Path $inputs $_.file)
    }
./scripts/build-android-offline-voice-probe.ps1 `
    -InputDirectory $inputs `
    -OutputDirectory (Join-Path $env:TEMP ('home-voice-build-' + [guid]::NewGuid())) `
    -Sdk $env:ANDROID_HOME -Jdk $env:JAVA_HOME
```

The builder runs 16 parser, 11 handoff authorization and 32 wake-session checks, compiles Java and both library JARs
to DEX, packages the model and native libraries, verifies portable ZIP entry
paths and required model/native entries, and verifies the disposable APK
signature. Assets are inserted with `jar` because Windows `aapt2 -A` emitted
backslashes that Android AssetManager could not resolve. Install `probe.apk`
only on the explicitly selected test device, then
launch `io.github.f2illc.lunaos.home.voiceprobe/.VoiceProbe`.

1. Verify launch has not used the microphone. Allow microphone access on-device;
   verify permission approval alone still has not captured audio.
2. Optionally tap Check offline engine and expect engine/vocabulary ready with
   no microphone operation. Tap Start and wait for Listening. Use the synthetic test phrase
   “Hey Luna, set a timer for ten seconds,” then pause.
3. Expect `Recognized duration: 10 seconds` and microphone off; no timer or alarm.
   Then explicitly enable real timers, tap Start, repeat the synthetic phrase,
   and check that Clock opens with the requested countdown. Confirm expiry and
   dismiss the alert in Clock. This uses Clock's existing sound settings.
4. Separately test an incomplete phrase, missing wake phrase, unrelated speech,
   timeout, Stop, leaving the screen, mute and permission revocation. Returning
   must not resume capture. UI/parser checks are not substitutes for these
   attended acoustic and lifecycle checks.
5. For the foreground wake test, leave real timers unchecked for the first trial.
   Tap Enable local wake listening for 5 minutes, wait for the microphone-on
   waiting state, say `Hey Luna` and pause. After Awake appears, say
   `Set a timer for ten seconds` and pause. Expect the structured duration and
   microphone off. Repeat only after explicitly enabling real timers to test
   Clock handoff. Check Stop, leaving, command timeout and waiting timeout
   separately; returning must not start capture. Never infer a negative-audio
   benchmark from a few rejected phrases.
6. Uninstall the isolated probe when evaluation is finished. Do not publish raw
   device logs, transcripts, screenshots, identifiers, or human-derived measurements.

## Current evidence

The source passes all 16 parser, 11 handoff authorization and 32 wake-session checks and builds a
signature-verified APK with verified portable model paths. Installation and
activity launch succeeded on the connected API 30
ARM32 test device. After correcting Windows asset entry separators, the explicit
engine check loaded the model, found the wake word and constructed the grammar
recognizer. Android AppOps reported no microphone operation after this check,
despite the permission being allowed. The recognition-only synthetic command
subsequently produced a match, with the structured duration confirmed by the
operator and a completed microphone operation in AppOps. This establishes one
attended foreground recognition scenario, not a qualified always-on wake word.
With real timers explicitly enabled, a subsequent attended synthetic ten-second
command produced one logged Clock dispatch. The operator confirmed that Clock
showed the countdown and sounded on expiry. This verifies one foreground
recognition-to-alert scenario; it does not qualify screen-off alerts, repeated
operation or always-on listening. A separate run logged the 30-second deadline
stop. The remaining rejection, acoustic and lifecycle scenarios still require
attended verification.

The separate foreground wake waiting increment has synthetic transition coverage
for exact wake matching, rejection before wake, command gating, duplicate wake,
overall/command deadlines and duplicate command rejection. One attended
recognition-only trial logged waiting, wake match and command match; the operator
confirmed Awake followed by the ten-second duration. AppOps showed capture
completed. A subsequent opted-in trial logged wake match, command match and one
Clock dispatch; the operator confirmed the countdown and audible expiry. These
two attended cases establish the tested foreground path only. Its remaining
rejection, timeout, acoustic and lifecycle scenarios are pending. The increment builds a verified APK
and has been installed on the same attended device. Launch showed listening off
and real timers unchecked; AppOps showed no new capture from launch. Controls,
including Stop and the status area, fit the inspected screen. The preceding full-phrase timer
success does not establish this new two-stage path.
