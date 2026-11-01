# First wake-word use case: set a timer

## Selected outcome

The owner selected a timer as the first useful wake-word action and the converted
Android home device as the first target. The acceptance journey is:

> Hey Luna, set a timer for ten minutes.

Home confirms the timer only after it has been saved and native delivery has been
accepted. The device then sounds an alert when it expires, including with its
screen off. "Hey Luna" remains a candidate phrase pending detector evaluation.
This document records the product scope and proposes the implementation boundary;
it does not establish working speech recognition, a timer, or device support.

The historical device candidate is Android 11/API 30, ARM32, without Play services.
Those attributes, microphone/speaker availability and actual ROM/build must be
verified on the selected device before choosing an engine or promising support.
No physical device identifiers or household audio belong in public evidence.

## Proposed bounded route

Use a device-local route for this small command vocabulary:

1. After listening opt-in and microphone permission, detect the selected phrase
   locally using the existing wake consent/state boundary.
2. Capture a bounded command and recognize its duration locally. Wake detection
   alone does not recognize "ten minutes"; command recognition needs its own
   ARM32/offline feasibility evidence and dependency/license review.
3. Submit a structured start command to the same timer service used by GUI/MCP.
   Persist and reconcile it through TIME-01 (#148), then schedule native delivery
   through TIME-02 (#149). Do not create a separate voice-only timer store.
4. Say "Ten-minute timer started" only after confirmed persistence and scheduling.
   If the result is uncertain, reconcile the command ID before retrying. Do not
   report success or silently create a second timer.
5. Sound a local alert at expiry, show its state, and provide visible Stop and
   Cancel controls. Local speech output or an acknowledgment tone must have its
   own verified offline route; an audible alarm does not require cloud TTS.

The proposal needs no hosted assistant or general conversation provider for timer
commands. It leaves the general voice-host decision open. If local command
recognition is infeasible, report that gap for an owner decision rather than
silently sending audio to a provider. Network loss must not prevent an accepted
timer from expiring and alerting.

Start with positive whole-number seconds and minutes with explicit units.
"Set a timer" asks "For how long?" without starting anything. Ambiguous, zero,
negative, unsupported or excessive durations need a clear correction instead of
guessing. The implementation must declare a safe maximum before qualification.
Support one active timer initially: a second start must explain that a timer is
already running and offer an explicit replacement decision; never overwrite it.
Voice cancellation may follow once its ambiguity and recognition are qualified;
visible controls are required for the first increment.

## State, consent and timer lifetime

Keep waiting consent separate from OS permission. Pre-wake audio remains transient
and local under the existing contract; command recognition adds no audio logging,
telemetry or implicit upload. A wake phrase grants no vault access. The local timer
permission and its revoke behavior must be visible in both GUI and MCP.

The current reducer routes captured commands to a disclosure prompt and accepts a
response only after forwarding. It cannot yet execute this proposed local route.
A reviewed local-command transition must carry the active generation and a stable
operation ID, ignore stale/duplicate callbacks, and return a truthful timer
receipt. Add synthetic coverage before integrating microphone or timer adapters.
Do not fake remote approval or report a saved timer from a recognition callback.

Screen off/screensaver is distinct from OS security lock. The existing contract
mutes capture on security lock and requires explicit resumption after unlock.
Preserve that rule. A previously accepted timer must still attempt native alert
delivery while locked; mute/off controls for the microphone do not cancel it.
Cancellation is a separate timer action. If the converted device cannot listen
with its screen off under this policy, mark hands-free availability unsupported
and show a clearly labeled tap-to-talk fallback.

Normal elapsed time uses a monotonic clock. Persistence, restart, reboot, clock
changes, cancellation races, delivery acknowledgment and unknown outcomes use the
reviewed TIME-01 recovery policy. A process-local JavaScript timeout is insufficient.
If native delivery is unavailable or notification/alarm permission is denied,
explain that the timer cannot reliably alert and do not claim it started normally.
Reboot behavior must distinguish restored, missed and unavailable delivery; no
silent full-duration restart or duplicate expiry alert.

## Delivery order and evidence

Reuse the existing issues rather than creating another timer project:

| Work | Required result |
| --- | --- |
| [WAKE-01 #135](https://github.com/F2iLLC/lunaos-home/issues/135) | Review this local timer boundary and extend the synthetic state contract for local execution. |
| [WAKE-02 #136](https://github.com/F2iLLC/lunaos-home/issues/136) | Verify exact converted device/OS/ABI, microphone and speaker routes, screen-off behavior, security-lock distinction and native alert feasibility. |
| [WAKE-03 #137](https://github.com/F2iLLC/lunaos-home/issues/137) | Compare licensed offline detector and command-recognition candidates on that target; agree accuracy, latency and resource limits before tuning. |
| [TIME-01 #148](https://github.com/F2iLLC/lunaos-home/issues/148) | Implement one durable timer service with versioned/idempotent start, list, cancel and acknowledge receipts and recovery. Reuse its existing contract/store dependencies. |
| [TIME-02 #149](https://github.com/F2iLLC/lunaos-home/issues/149) | Implement native alert delivery and visible controls; prove the actual device sounds. |

The timer is the first wake action; this scope decision does not mark grocery,
vault or timer prerequisites complete or rewrite their existing issue hierarchy.
Any smaller dependency boundary must be demonstrated and reviewed explicitly.

Before calling this usable, record the exact commit/build and observed outcome for
each case below. Pure state tests and native scheduling receipts cannot prove sound.

- A ten-minute timer is recognized correctly, confirmed after save/schedule, and
  audibly expires. Use short synthetic timers for repeated lifecycle checks.
- Foreground and screen-off starts/expiry work without network access; security
  lock mutes new capture while an accepted timer still alerts.
- Missing/ambiguous duration prompts without starting; duplicate wake/callback or
  retry creates at most one timer; an active timer is never silently replaced.
- Cancel prevents later alert where supported; expiry/cancel races reconcile;
  acknowledge stops the sound and stale callbacks cannot restart it.
- Process kill/restart, reboot, clock changes and notification/alarm denial each
  produce the documented recovery or unavailable/missed result.
- Mute, permission revocation and late recognition callbacks cannot create a new
  timer. Speech acknowledgment/playback cannot wake the detector into another one.
- False activations, positive detection trials, command-duration accuracy, battery,
  CPU/RAM and audible output meet the device-specific reviewed gates.

Device checks require attended access and OS consent. No detector engine, account,
dependency, microphone session, permission change, installation, merge or deployment
is performed or implied by this document. Support remains unverified until the
checks above pass on the actual selected device.
