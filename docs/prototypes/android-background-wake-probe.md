# Android background wake feasibility probe

Version 0.4 extends the [foreground probe](android-offline-voice-probe.md) with
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
  a ten-second command window, bounded by the original limit. Pause about three
  seconds after the wake phrase before speaking the command. There is no audible
  wake acknowledgement in this increment.
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
This version requires API 26+, targets API 30 and packages ARM32 only. Its 74
policy checks cover parser (16), handoff (11), wake transitions (32), and timer
review expiry, revocation, range and one-use claim (15).

1. Verify installation, launch and permission leave the microphone off and no
   wake service running. The explicit engine check must also leave capture off.
2. Tap Enable background wake test for 5 minutes. Wait for Waiting and verify
   the ongoing notification has Stop. Press Home, say `Hey Luna`, pause about
   three seconds, then `Set a timer for ten seconds` and pause.
3. Expect a notification with ten seconds and microphone off, with no Clock
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

Version 0.4 passes all 74 policy checks and builds a signature-verified APK with portable model paths. Installation and launch succeeded on the selected API 30 ARM32 device. The inspected UI showed microphone off, real timers unchecked and timer review disabled; AppOps showed no new capture, and no service was running. Background speech, display-off
operation, lock cancellation and explicit timer review await attended testing.
