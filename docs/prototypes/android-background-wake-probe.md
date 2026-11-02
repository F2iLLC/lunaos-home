# Android background wake feasibility probe

Version 0.12 uses the owner-selected ElevenLabs voice for replies for hands-free Luna-owned timers in the
explicitly enabled local wake listener. The owner authorized creation without Clock review, spoken
cancellation, adding time and additional timers during a countdown. This is
an engineering probe, not a qualified unattended appliance. Reuses #135, #136
and #137; broader durable timer/native alert work remains #148 and #149.

## Behavior and boundaries

- Only the visible Enable wake-word listening button starts capture. Launch,
  permission, unlock, timer expiry and process recreation never enable it.
  Disable, secure lock, mic mute or permission loss disable capture and queued
  restarts. Restoration requires Enable again. No boot receiver, permission
  auto-grant, lock bypass or battery/security settings changes.
- Say `Hey Luna`, wait for cue or bright awake eyes, then a complete command
  within ten seconds. Waiting persists while enabled. Timeout rearms listening;
  decoder errors disable it. Intermittent rejection remains unresolved.
- `Set a timer for five seconds` or `set another timer for two minutes` starts
  a Luna timer hands-free. Durations are exact whole numbers one through sixty
  seconds or minutes. Incomplete, unclear and extra-word commands are rejected.
  Only finalized post-wake commands can act. No fuzzy duration repair.
- Up to eight independently numbered timers run. Numbers are reused after
  cancellation. With one timer, say `cancel the timer` or `add one minute to
  the timer`. With several, say `cancel timer two` or `add one minute to timer
  two`. Ambiguity changes nothing and requests a numbered command after
  another wake word. Add supports one through sixty seconds/minutes, with a
  24-hour cap on resulting remaining time. Adding to an expired timer starts
  the added duration from now. There is no arbitrary newest-timer selection.
- Private structured state and Android
  [AlarmManager alarm-clock scheduling](https://developer.android.com/develop/background-work/services/alarms)
  own these timers. IDs, revisions and monotonic deadlines are saved before
  acknowledgment. Queued alarms and cancellation actions check revision.
  Wall-clock changes reschedule from elapsed remaining time. State is scoped
  to the current boot; reboot invalidates it without restoring timers or mic.
  Process-death/force-stop, reboot and prolonged idle are not device-qualified.
  OS intervention or force-stop can prevent delivery.
- A separate non-exported playback foreground service loops the default alarm
  sound on expiry. Existing volume/routing applies and is never changed.
  Screen and per-timer notification Cancel controls stop countdowns or ringing.
  Canceling one leaves others intact. Sound failure logs a fixed code and
  retains the visible expired timer, without a playback retry loop. An API
  return is not proof of audible delivery.
- Countdown display never switches to Clock or disables the listener. Capture
  pauses for a fixed structured spoken reply, then resumes if still enabled.
  Generic voice prompts are prepared with ElevenLabs and bundled as 262
  uncompressed WAV assets. Timer numbers and duration phrases play in two
  clips; cancellation and fixed errors use complete replies. No device speech engine or
  network is required. Playback errors or a fifteen-second reply timeout
  release playback and rearm listening; the displayed result remains available. Disable
  invalidates reply callbacks. Ringing audio is locally reduced during the
  command window/reply, then restored; device alarm volume is unchanged.
  Recognition over a ringing alarm needs attended evidence; Cancel remains
  available on screen and in the notification.
- Disable stops listening/speech, not timers. Luna does not change Clock timers.
  Separate legacy foreground diagnostics retain finite limits and an unchecked
  real-Clock-timer option; manage those timers in Clock. Background commands
  use native timers only. Closing workers share a capture exclusion gate.
- An ongoing silent mic notification offers Disable. Capture's partial wake
  lock has a 60-second lease renewed every 30 seconds, released between workers
  and retained during bounded replies. Battery/thermal/unattended reliability remain unqualified.
- The chibi face shows preparation, waiting, awake, reply and retry. Numbered
  countdowns and Cancel controls appear alongside it. Reply says mic paused.
  Visible activity display-on behavior never wakes a dark display or bypasses
  locks. No network permission, saved audio or transcripts. Timer state contains
  only numbers, deadlines, revisions and boot count. Keep raw logs, identifiers,
  screenshots, audio and household data out of Git/PRs.

## Build and attended test

Use `scripts/build-android-offline-voice-probe.ps1`, pinned offline inputs and
existing installed signer. Keep APKs/models/libraries/signers/audio outside Git.
Pass the external prepared voice pack through `-ReplyDirectory` (defaults to
`<InputDirectory>/replies`). The builder requires the exact generic prompt
manifest, matching clip checksums and bounded PCM16 mono 24 kHz WAV files;
there is no Windows voice fallback and no provider call during a build.

For a new pack, generate the fixed text in `reply-prompts.json` with one
ElevenLabs voice, in batches with pauses. Obtain Scribe word timings for only
that synthetic generated audio. Keep batch audio, timing JSON, provider URLs
and pack metadata outside Git. Run `prepare-reply-pack.mjs` with an external
batches JSON and a new external output directory. Each batch supplies its
manifest `start` index, `count`, `audioFile` and `wordsFile`. The preparer
requires exact normalized wording, trims any articulated separator tag, and
uses FFmpeg to emit canonical WAVs and a local checksum manifest. Word timings
are a preparation check; they do not establish perceived voice quality.
API 26+, target API 30, ARM32. Existing 350 parser, diagnostic, wake and historical
review policy cases remain. Java harnesses execute the actual native timer
manager, ledger, alarm service, reply helper and wake service with deterministic
Android/audio boundaries. Coverage includes strict commands, targeting,
add/cancel, ambiguity, stale alarms, slot reuse, storage/scheduling failures,
boot invalidation, multi-alarm cancellation, offline reply success/error/timeout
and Disable during reply. Fakes do not qualify Android enforcement or sound.

1. Opening/installation must leave mic off and no wake service running.
2. Enable locally; wake, wait for cue/awake, then set one minute. Verify numbered
   countdown, spoken acknowledgment and automatic return to Waiting.
3. Wake and add one minute. Verify the same countdown increases.
4. Wake and set another two-minute timer. Verify independent countdowns.
   Unnumbered add/cancel must request a number and change neither.
5. Wake and cancel timer two. Verify timer one remains, then cancel it too.
6. Separately set five seconds, hear expiry, then wake and cancel the timer.
   Test screen/notification Cancel too; repeat in background and display-off.
7. Disable during countdown; capture must stay off while timer expiry/cancel
   remains available. Keep secure-lock, permission, process-death, idle and
   reboot evidence distinct. Do not weaken a lock to pass a test.

## Evidence

The preceding foreground two-stage recognition and opted-in Clock countdown /
audible expiry were operator-confirmed on version 0.3. They do not verify this
new service or the refactored version 0.4 foreground adapter.

Version 0.4 passes all 74 policy checks and builds a signature-verified APK with
portable model paths. Installation and launch succeeded on the selected API 30
ARM32 device. The inspected UI showed microphone off, real timers unchecked and
timer review disabled; AppOps showed no new capture, and no service was running.

In the first attended background recognition trial, the operator varied the
synthetic command to five seconds and confirmed that the recognized duration
was correct. Fixed-code runtime evidence showed waiting, wake match, command
match and background review ready with no timer started. AppOps showed that
capture had completed. In the subsequent requested display-off trial, the
operator reported the five-second review result with microphone off and no
timer started. Fixed-code evidence again showed waiting, wake match, command
match and background review ready, and AppOps showed completed capture. Display
state in this trial is operator-reported, not independently instrumented.

These cases establish attended background and reported display-off recognition.
Security-lock cancellation, explicit timer review/alert delivery, repeated
reliability and acoustic qualification remain pending. Display-off success
does not prove listening while security-locked or lock cancellation behavior.

Subsequent retries repeatedly reached wake match followed by the ten-second
command-window deadline without a command match. The available fixed-code logs
do not establish whether the command began before the decoder switched, was
not recognized, or failed to finalize in time. Version 0.5 adds the wake cue,
explicit command-timeout guidance and a fixed code for finalized nonmatching
commands. No recognition text is logged. Both watchdog and worker deadline paths
report timeout consistently. The five-minute and ten-second limits remain in
force. Cue audibility and recognition recovery require a fresh attended trial;
the earlier successful cases do not qualify this revision.

Version 0.5 also passes all 74 policy checks and the complete Java/DEX/APK build
and signature verification. The update was installed and launched; fresh UI
inspection showed microphone off, timer opt-in unchecked and timer review
disabled. Launch caused no new capture and no wake service was running.

Version 0.5 attended retries still timed out. Fixed-code evidence showed wake
match, cue requested and a finalized nonmatching command before expiry. The
operator used the supported five-second phrase and did not hear the cue.
The device reported media unmuted; cue audibility remains unverified. This
is not evidence that command recognition recovered.

Version 0.6 distinguishes no finalized result, no speech, unclear speech, wake
only, an incomplete timer phrase and other speech. These fixed categories appear
on screen and in diagnostic logs; recognized text is never displayed or logged.
Nonempty rejection categories survive later silence results until timeout.
The parser and timer authorization remain unchanged. This is diagnostic
instrumentation, not a claimed recognition fix.

Version 0.6 passes all 81 policy and diagnostic checks and the full Java/DEX/APK
build and signature verification. Installation and launch succeeded. Fresh UI
inspection showed microphone off, timer opt-in unchecked and review disabled;
no wake service was running and launch caused no new capture.

In the subsequent version 0.6 attended trials, the operator confirmed five-second
recognition, then reported successful recognition with the screen off. After
pressing Start recognized timer in Clock, the operator confirmed both countdown
and audible expiry. Fixed-code runtime evidence showed waiting, wake match,
command match, background review ready with no timer started, then timer intent
dispatch after the explicit tap. No wake service remained running at readback.
Display state and countdown/sound are operator-confirmed, not independently
instrumented. This verifies an attended screen-off recognition and explicit
Clock handoff case; it does not establish repeated reliability, cue audibility,
security-lock cancellation or a hands-free background timer. The earlier
command-rejection cause remains unresolved.

Subsequent attended version 0.6 retries again produced both a successful
recognition/review path and command timeouts. The failed paths reached wake
match and a finalized `INCOMPLETE_TIMER_PHRASE` before the command deadline;
neither failure dispatched a timer. That category means only that rejected text
contained `timer`, not that a particular word was omitted. It cannot identify
the decoding error. The operator's successful-result report does not separately
confirm cue audibility or a new countdown/alert result.

The operator subsequently reported Stop and the stopped UI. Readback confirmed
no active microphone operation and no wake service. In a separate lock-screen
trial, capture was verified active before the operator reported locking. The
device showed its keyguard but reported no secure lock, and capture continued.
This does not test `isDeviceLocked()` cancellation on a securely locked device.
After unlocking and the operator's Stop action, readback again showed capture
off and no wake service. Lock settings were not changed. Post-unlock
non-restart following a genuine security-lock cancellation remains unverified.

Version 0.7 narrows rejected-command diagnostics without changing recognition,
grammar, strict parsing, deadlines or timer authorization. The fixed details are
`MISSING_DURATION_AND_UNIT`, `MISSING_DURATION`, `MISSING_UNIT`,
`MISSING_ARTICLE`, `UNIT_NUMBER_MISMATCH`, `EXTRA_WORDS_AFTER_TIMER` and
`TIMER_WORDING_MISMATCH`. The first six identify exact structural patterns;
the last is the fallback for other rejected timer wording. Existing silence,
unclear-speech, wake-only and other-speech categories remain. The UI and log
show only these codes, never recognized text. A rejected phrase is never
completed, joined to a later utterance or accepted based on its diagnostic.
This is investigation instrumentation, not a demonstrated acoustic repair.

Version 0.7 passes 338 policy/diagnostic cases and the complete offline
Java/DEX/APK build, portable-entry checks and signature verification. These
checks use synthetic inputs; they do not establish device recognition recovery.
The new APK was subsequently re-signed with the existing disposable test
identity, signature-verified and installed as an update without uninstalling
the probe. Package readback confirmed version 0.7. Launch inspection showed
microphone off, foreground timer opt-in unchecked and Clock review disabled.
No wake service or active microphone operation was present; AppOps still
reported only the preceding capture operation, before this update/launch.
No capture was started through ADB. All APKs, models and signing material remain
outside Git.

In the first subsequent attended version 0.7 trial, fixed-code readback showed
waiting, wake match, command match and background review ready without a timer
dispatch. Microphone capture was off at readback; the service remained present
for pending review. The operator reported choosing a ten-second command rather
than the suggested five-second command. The fixed codes do not encode duration,
and a structured-duration UI readback was unavailable, so exact-duration
correctness is not independently established for this trial. No countdown or
audible expiry is claimed. This successful recognition case does not resolve
the preceding intermittent rejections; a failed version 0.7 trial is still
needed to inspect the narrower diagnostic categories.

In a later version 0.7 attempt, the operator confirmed speaking five seconds
and seeing five seconds recognized. The device was no longer connected over
ADB when follow-up inspection was attempted. This is operator-confirmed
duration correctness only; fresh fixed codes, capture shutdown, review state
and timer dispatch were not verified for this attempt. No countdown, sound or
recognition-reliability qualification is inferred.

After the operator reported Stop and reconnected the device, fresh package
readback again confirmed version 0.7, with no active microphone operation and
no wake service. Retained fixed codes from the intervening period showed an
additional waiting/wake-match/command-match/review-ready sequence followed by
background stopped, with no timer dispatch. This supplies delayed runtime
corroboration for recognition and the current stopped state; the exact duration
remains operator-confirmed because these codes do not include it.

In another attended version 0.7 trial, the operator reported five seconds
recognized. Fresh fixed codes showed waiting, wake match, cue requested,
command match and background review ready without a timer dispatch. Microphone
capture was off; the service remained present for pending review. Duration is
operator-confirmed, and cue requested does not establish cue audibility. This
completes the small attended repeatability check with successful version 0.7
recognition cases, but no failed version 0.7 trial was captured for the narrower
diagnostics. The earlier intermittent timeout cause remains unresolved.

In the next attended version 0.7 recognition attempt, fresh fixed codes again
showed waiting, wake match, cue requested, command match and review ready with
no timer dispatch. Capture was off with review pending. For a subsequent
dedicated Stop test, readback verified active microphone capture and the wake
service after the operator started listening locally. After the requested
Stop/Discard action and operator acknowledgement, fresh readback showed no
active microphone capture and no wake service. This establishes the attended
active-to-stopped transition; it does not establish security-lock cancellation.

The operator subsequently confirmed hearing the soft wake cue during the
successful attended attempt. Cue audibility is therefore operator-confirmed
for that trial, without establishing repeatability or measured loudness. The
operator also confirmed this device has no secure lock. Security-lock
cancellation and post-unlock non-restart remain untested; lock settings were
left unchanged.

For a future attended trial, the operator must start a fresh background
session on-device. After a timeout, inspect only the fixed `COMMAND_FINAL_*`
codes before considering any recognition change. Leave Clock review untouched
for recognition-only trials. Stop remains an explicit operator action; no ADB
capture start or lock-setting change is authorized by this procedure.

A subsequent [offline synthetic decoder experiment](android-synthetic-decoder.md)
reproduced a separate timing failure in both a Windows decoder and the pinned
Android native library. Fast commands with no added gap could begin before the
wake decoder finalized; adding silence or feeding the same command directly
avoided those failures in the tested fixtures. Each native matrix completed 72
cases, with four zero-added-gap `UNCLEAR_SPEECH` rejections and 68 expected
matches. This is not a reliability rate or a demonstrated cause of the earlier
human `INCOMPLETE_TIMER_PHRASE` results. The operator could not recall the
earlier command/cue timing. No human audio was recorded, capture was not started
through ADB, and the APK behavior was left unchanged.

In the subsequent attended timing comparison, the operator spoke the wake
phrase and five-second command continuously without waiting for the cue and
reported five seconds recognized. Fresh fixed codes showed waiting, wake match,
cue requested, command match and review ready, with capture off and no timer
dispatch. This successful human case shows that the synthetic timing failure
does not occur on every continuous-phrase attempt; it does not resolve the
earlier human rejection cause or establish recognition reliability.

The operator then left that review result untouched and confirmed that the
screen displayed `Timer review expired` with the Clock button disabled after
the review deadline. Readback after the deadline showed `BACKGROUND_STOPPED`,
no active microphone operation, no wake service and no timer dispatch. The
operator's confirmation distinguishes this attended automatic-expiry case
from a Stop action; the stopped code alone does not identify the stop reason.

For the next attended trial, the operator waited for the wake cue, requested
one minute and confirmed recognition of one minute / 60 seconds. Fresh fixed
codes again showed waiting, wake match, cue requested, command match and review
ready without timer dispatch. Capture was off while the service retained the
pending review. This adds an operator-confirmed minute-unit case; the fixed
runtime codes do not encode or independently verify the recognized duration.
The operator then confirmed Stop/Discard cleared that result and disabled the
Clock button. Follow-up readback showed capture off and no wake service, with
no timer dispatch in the retained sequence. No stop-reason code was observed
for this action; the cleared result is operator-confirmed.

In an intentional incomplete-command trial, the operator was asked to wait
for the cue and say only `Set a timer`, omitting duration, then Stop/Discard
after the result or deadline. The operator reported `TIMER_WORDING_MISMATCH`.
Fresh fixed codes corroborated `COMMAND_FINAL_TIMER_WORDING_MISMATCH`, then
`COMMAND_FINAL_NO_SPEECH`, `BACKGROUND_STOPPED` and `COMMAND_WINDOW_EXPIRED`.
No command match, review-ready event or timer dispatch occurred; readback
showed capture off and no service. The fallback category does not reveal the
decoder's exact interpretation. This verifies rejection in this deliberately
incomplete trial, not the cause of earlier complete-command failures.

A subsequent fresh session reached command match and review ready without
timer dispatch. The operator confirmed five seconds recognized and Stop
afterward; follow-up readback showed capture off and no wake service. Between
the deliberate incomplete trial and this success, the retained codes contain
one additional wake/cue/`TIMER_WORDING_MISMATCH`/timeout sequence. The operator
subsequently confirmed attempting the complete five-second command and
reported disrupted delivery during the duration. This is an attended rejected
complete-command attempt followed by a successful fresh retry. The fixed
category does not identify the decoder output or establish an acoustic cause;
no speech or audio was retained.

In the next cue-separated trial, the operator requested two minutes, confirmed
120 seconds recognized and reported Stop afterward. Fresh fixed codes showed
waiting, wake match, cue requested, command match and review ready without
timer dispatch; follow-up state showed capture off and no wake service. This
adds an operator-confirmed plural-minute case, with duration still not encoded
in the runtime codes.

In the subsequent version 0.7 trial, the operator reported five seconds
recognized with the display off, then Stop afterward. Fresh fixed codes
corroborated waiting, wake match, cue requested, command match and review ready
without timer dispatch. Follow-up readback showed no active microphone
operation and no wake service. Display state and exact duration are
operator-confirmed; this display-off success does not test secure-lock
cancellation or establish recognition reliability.

For an attended microphone-permission revocation check, the operator was
instructed to start listening locally, revoke microphone permission in Android
settings and return to the probe. The operator reported the microphone-off,
nothing-starts-automatically screen. Package readback confirmed runtime
microphone permission denied; AppOps and service readback showed no active
capture and no wake service. The latest session had logged
`WAITING_FOR_WAKE`, with no subsequent match, review or timer dispatch.
Capture was not independently sampled before revocation, and no stop-reason
code was retained. This corroborates the denied-permission stopped state,
without distinguishing Android process termination from the probe's own
permission-cancellation path. Permission was not changed through ADB.

Version 0.8 adds the chibi visual indicator and responsive face/control layout.
All 338 policy/diagnostic cases, offline Java/DEX/APK build, portable-entry
checks and signature verification passed. The update was re-signed using the
existing disposable identity and installed without uninstalling. Package
readback confirmed 0.8, with microphone permission still denied, no active
capture and no wake service. Launch did not activate capture. Local UI
inspection and the operator confirmed the large face and microphone-off state.
The full repository suite also passed: 344 tests, zero failures or skips.

In the attended visual trial, the operator granted microphone permission and
started listening locally, then confirmed the awake face was obvious from the
kitchen viewing distance. The operator clarified that Stop was pressed after
seeing the awake face, before a recognized-duration result. Fresh codes showed
waiting, wake match, cue requested and a no-speech command final, without
command match, review ready or timer dispatch. Follow-up readback showed
capture off, no wake service, the face's accessible microphone-off description
and Clock review disabled. This confirms operator-assessed awake visibility
and the stopped visual state, not timer recognition or visual qualification
of review/timeout/expiry transitions. No recognition repair is claimed.

In a fresh attended version 0.8 recognition-only trial, the operator was asked
to wait for the cue or awake face, request five seconds, leave Clock review
untouched and then Stop/Discard. The operator confirmed hearing the cue and
reported that the trial behaved as expected. Fresh fixed codes showed waiting,
wake match, cue requested, command match and review ready without a timer
dispatch. Follow-up readback showed capture off and no wake service. These
codes do not encode duration, and the latest retained sequence did not include
a stop-reason event; exact duration and the shutdown path are not independently
verified. No new Clock countdown or audible timer expiry is claimed. The full
repository suite passed at the hairstyle head: 344 tests, zero failures or
skips. This adds an attended recognition and audible-cue case for the visual
revision; intermittent command rejection remains unresolved.

Version 0.8 still required local activation for each bounded session and an
explicit Clock review tap; persistent listening was not part of the face work.
The operator subsequently authorized general-purpose persistent wake-word
listening with an Enable control, explicitly avoiding the name kitchen mode.
Version 0.9 implements that enable-once lifecycle, retaining explicit Clock
review and fail-closed access controls. It does not change the timer parser or
claim to resolve intermittent recognition rejection. Fresh attended version
0.9 lifecycle tests, power qualification and genuine secure-lock cancellation
remain pending; prior version 0.8 behavior does not qualify this new lifecycle.

Version 0.9 passes 350 policy/diagnostic cases, the complete offline
Java/DEX/APK build, portable-entry checks and signature verification. The APK
was re-signed with the existing installed-build test identity and the
certificate match verified. The full local Windows repository suite passes
345 tests, with zero failures or skips, including the deterministic service
lifecycle harness. Compilation and simulated transitions do not establish
attended version 0.9 behavior, recognition reliability or battery suitability.

For version 0.9, the operator subsequently confirmed that the ten-second command
window returns to waiting without another Enable tap, and discarding a
recognized request also returns to waiting. This is attended lifecycle evidence,
not prolonged listening, secure-lock qualification or an explanation of earlier
recognition failures.

Version 0.10 implementation and device evidence are separate. Prior Clock expiry
behavior does not qualify the new Luna-owned alarm path.

### Version 0.10 implementation checks (2026-11-01)

The complete local npm suite passed: 346 tests, zero failures or skips. The
native timer/wake and bundled reply harnesses passed again after the bounded
reply wake-lock adjustment. The complete offline Java/DEX/APK build passed its
350 existing policy/diagnostic checks and signature verification. All 81 bundled
voice clips were present, nonempty and uncompressed in the APK. Generic prompts
were generated outside Git; no captured speech was used.

The update was re-signed with the existing installed test signer; certificate
matching and signature verification passed. Installation and UI launch succeeded
with installed version 0.10. The user had explicitly disabled listening first.
Fresh read-only checks before and after installation showed no probe service
and no running microphone operation. No capture or timer was started remotely.

Spoken reply audibility, native timer expiry, spoken cancel/add, simultaneous
timers and continued listening during countdown/ringing remain pending an
attended trial. Earlier Clock expiry evidence does not qualify this new timer
implementation. Existing intermittent command rejection is not claimed solved.
Secure-lock cancellation remains unverified; no lock settings were changed.

### Version 0.11 ElevenLabs reply preparation (2026-11-01)

The user heard the version 0.10 voice and rejected its quality, then requested
ElevenLabs. This confirms audible output in that trial; it does not confirm
native expiry, cancel/add, multiple timers or automatic return to Waiting.

Version 0.11 replaces the Windows-generated word fragments with 262 generic
ElevenLabs phrase clips. Scribe timing checks matched every scripted word;
any articulated batch separator was excluded from the clips. Generated audio
and timing data remain outside Git. The full local npm suite passed 347 tests
with zero failures/skips. The complete offline Java/DEX/APK build passed 350
policy/diagnostic checks and signature verification. All 262 voice assets were
checked as nonempty and uncompressed, and the device APK matches the existing
test signer. Pack tests reject incorrect wording, missing clips, checksum
tampering and malformed WAV headers.

The user confirmed Disable again. Read-only checks found no wake service or
active microphone app-op before installation. Version 0.11 was installed with
the existing test signer and the UI opened; version and post-launch mic/service
checks passed with capture off. New voice quality and native timer behavior
still require attended user confirmation.


### Version 0.12 selected voice (2026-11-01)

The owner selected a specific ElevenLabs voice after hearing version 0.11.
Version 0.12 regenerates the same 262 fixed generic phrases with that choice;
provider identifiers, audio, timing data and pack metadata remain outside Git.
No timer, capture or playback lifecycle behavior changes. The selected voice
still needs an attended device check; selecting it is not timer qualification.

The visible OFF and WAITING faces now gently bob with a breathing O-shaped
mouth, drifting z and occasional sleepy peek/blink. Awake command listening
keeps its bright eyes. The text continues to distinguish MIC OFF from waiting
with MIC ON. Animation never activates capture, wakes the display or changes
lock behavior; it redraws at ten frames per second only while active/visible.

Version 0.12 passed all 350 repository tests before the drawing-only change.
The final offline Java/DEX/APK build passed all 350 policy checks and signature
verification, including all 262 nonempty uncompressed voice assets. The final
APK was signed with the matching installed test signer. After the owner
disabled listening, read-only checks verified capture off. Installation and
UI launch succeeded with version 0.12 and capture remained off afterward.
Perceived animation and selected-voice quality remain for the owner's trial.

### Version 0.13 pigtails (2026-11-01)

At the owner's request, Luna now has soft lavender pigtails with mint ties in
place of the round buns. The tails follow the existing sleepy head bob; the
fringe, breathing mouth, peek-blinks and selected voice are retained. This is
a drawing-only change apart from the version bump, with no capture or timer
behavior changes.

The complete offline Java/DEX/APK build passed all 350 policy checks and
signature verification, including validation of the 262 bundled reply assets.
Version 0.13 was installed with the existing test signer after fresh read-only
checks found no service or running microphone operation. UI launch and installed
version checks passed, and capture remained off afterward. Visual acceptance
of the pigtails remains for the owner's device check.

### Version 0.14 bow (2026-11-01)

The owner confirmed acceptance of the pigtails and requested a big bow on top
of Luna's head. A mint bow now sits above the fringe, following the same sleepy
head bob. This drawing-only update retains the selected voice and existing
capture, timer and playback behavior. General spoken questions are still
pending implementation; this update does not add online answers.

The complete offline Java/DEX/APK build passed all 350 policy checks and
signature verification, including validation of the 262 bundled reply assets.
The device APK was signed with the matching installed test signer. Fresh
read-only checks found no service or running microphone operation before
installation. Version 0.14 installed and its UI opened successfully; post-launch
checks confirmed the version and capture remained off. Perceived bow appearance
still requires the owner's device check.
