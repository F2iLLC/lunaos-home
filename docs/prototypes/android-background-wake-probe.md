# Android background wake feasibility probe

Version 0.7 extends the [foreground probe](android-offline-voice-probe.md) with
an explicitly started microphone foreground service. It evaluates leaving the
activity and turning off an unlocked display on the selected converted Android
device. This finite engineering probe is not the Home application or an
always-on assistant. Reuses #135, #136 and #137; durable timers and native alerts
remain #148 and #149.

## Behavior and boundaries

- Launch, microphone permission, returning, unlock and process recreation never
  start listening. Only the visible activity's background button starts the
  non-exported service. `START_NOT_STICKY` prevents automatic restart. No boot
  receiver or battery/security settings changes.
- An ongoing silent notification identifies local microphone use and offers
  Stop / discard. A partial wake lock keeps the CPU available during this finite
  test. It is released at completion or cancellation and has an acquisition
  timeout. This does not establish acceptable battery consumption.
- Five minutes includes model preparation. An exact finalized `hey luna` opens
  a ten-second command window, bounded by the original limit. Wait for the brief
  wake cue (or visible Awake) before speaking the command. Version 0.5 requests a
  90 ms cue at 12% generator volume on the existing media stream; it never changes
  device volume or sound settings. Muted media or output routing may make it
  inaudible. Cue resources are released after playback or cancellation.
- Leaving the activity stops foreground tests; the deliberately selected
  background test continues. Both share a capture worker and process-wide
  exclusion gate. A closing worker must finish before another can start.
- Stop, security lock, microphone mute or permission loss close capture.
  Main-thread watchdogs check every 100 ms; canceled native decoding cannot
  authorize later effects. Display off differs from security lock: if screen-off
  locks this device, listening stops. Unlock never restarts it. OS termination
  may end the test early.
- Recognition closes the microphone and releases the wake lock before offering
  a structured duration. **No background Clock activity is launched and no timer
  starts from recognition alone.** Tap the result notification, then Start
  recognized timer in Clock. Android restricts
  [background activity launches](https://developer.android.com/guide/components/activities/background-starts);
  a microphone foreground service alone does not enable a hands-free Clock handoff.
- A duration of 1 through 3600 seconds is held in process memory for at most 60
  seconds. Claim consumes it before Clock dispatch. Stop, a new test, blocked
  access, service/process destruction or expiry discard it. No replay or
  automatic retry. Dispatch is an unacknowledged request: check countdown and
  alert, and cancel existing timers in Clock.
- The foreground real-timer checkbox is unchecked at launch and applies only
  to foreground tests. Background timer review has its own explicit button.
  Toggling the checkbox stops tests and discards pending requests.
- No network permission, saved audio or transcript. Do not publish raw device
  logs, identifiers, screenshots, household audio or human-derived measurements.

## Build and attended test

Use the offline builder and pinned inputs documented with the foreground probe.
This version requires API 26+, targets API 30 and packages ARM32 only. Its 338
policy checks cover parser and fixed diagnostics (280), handoff (11), wake transitions (32), and timer
review expiry, revocation, range and one-use claim (15).

1. Verify installation, launch and permission leave the microphone off and no
   wake service running. The explicit engine check must also leave capture off.
2. Tap Enable background wake test for 5 minutes. Wait for Waiting and verify
   the ongoing notification has Stop. Press Home, say `Hey Luna`, wait
   for the wake cue (or visible Awake), then `Set a timer for five seconds` and pause.
3. Expect a notification with five seconds and microphone off, with no Clock
   launch or alarm. Tap it, then explicitly start the recognized timer. Check
   countdown and audible expiry; dismiss in Clock. Repeated/stale taps must not
   dispatch another timer.
4. Separately repeat with the display off. If it security-locks, expect capture
   to stop and remain off after unlock. Do not weaken the lock to pass a test.
5. Separately test notification/in-app Stop, mute, permission revocation,
   waiting/command deadlines, review expiry and process death. Returning must
   never restart capture. Acoustic, power and lifecycle results require attended
   evidence; policy tests and successful compilation do not establish them.

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
