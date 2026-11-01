# Android offline voice probe

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
session. This is not a dedicated always-on keyword detector: microphone input is
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
  30 seconds, and releases capture on Stop or activity pause. Lock, microphone
  mute and permission are checked before capture and during the loop. A UI
  deadline releases capture even while a native decode is pending.
- Final recognition results alone enter the strict parser. Accepted forms are
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

The builder runs 16 parser and 11 handoff authorization checks, compiles Java and both library JARs
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
5. Uninstall the isolated probe when evaluation is finished. Do not publish raw
   device logs, transcripts, screenshots, identifiers, or human-derived measurements.

## Current evidence

The source passes all 16 parser and 11 handoff authorization checks and builds a
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
