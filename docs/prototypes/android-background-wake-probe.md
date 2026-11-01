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
The new APK has not been installed or acoustically tested. Version 0.6 remains
the last verified installed revision. All APKs, models and signing material
remain outside Git.

For the next attended trial, first install and verify the diagnostic revision
without starting capture. The operator must then start a fresh background
session on-device. After a timeout, inspect only the fixed `COMMAND_FINAL_*`
codes before considering any recognition change. Leave Clock review untouched
for recognition-only trials. Stop remains an explicit operator action; no ADB
capture start or lock-setting change is authorized by this procedure.
