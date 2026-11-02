# Luna in the main Android app

## Decision and current evidence

The owner selected a hosted LunaOS service with device authentication for online
answers. The standalone 0.15 voice probe works for attended spoken questions and
selected-voice replies. The owner confirmed that the updated online-answer
checkbox is clearly visible after installation. The probe remains a separate
package; its computer relay and USB reverse are development dependencies. Timer
recognition reliability and genuine secure-lock cancellation remain unverified.

## Existing app boundary

Home's Android shell is a Tauri WebView in `scripts/android/MainActivity.kt`.
`scripts/prepare-android.mjs` packages selected native components into the debug
variant; the main manifest currently has no microphone permission or voice
service. The voice probe separately owns `BackgroundWakeService`, `NativeTimers`,
`TimerAlarmService`, `TimerReceiver`, `LunaFace`, Vosk assets, reply assets and
private preferences. Its package-scoped state cannot be treated as state in the
main app. Merely adding a WebView page would not integrate capture or timers.

## Target contract

1. Move the native listener, timer ledger, alarms, playback and required offline
   assets into the main Android package through a reviewed build path. Keep one
   native owner for each timer and one capture exclusion gate. Migration must
   explicitly handle old probe timers; the new app must never claim to see or
   control timers held by the separate probe.
2. Expose a narrow native bridge to the Tauri page: read a snapshot of capture
   phase, blocked reason, online-answer setting and numbered timers; request
   Enable, Disable, online-setting change or timer cancellation. The native side
   validates each command. Page load, navigation, process recreation and timer
   updates cannot start capture. Online-setting changes stop listening and
   require a fresh local Enable.
3. Add a dedicated Luna page showing the approved face, explicit microphone
   state and active numbered timers first. Give Enable/Disable and online-answer
   controls large, high-contrast targets. A stale bridge response must never
   depict listening as active; use an explicit unavailable state instead.
4. The device sends only finalized question text over authenticated TLS to a
   tenant-scoped LunaOS endpoint. The endpoint verifies a device-bound identity
   and authorization for this capability before charging either provider. It
   applies input/output limits, one active request per device, cancellation,
   rate limits and bounded provider timeouts. The service calls gpt-6-luna with
   no tools, browsing or history and `store:false`, then ElevenLabs for the
   configured voice. Keep provider credentials and the selected voice outside
   Git and the APK. Do not interpret incomplete timer wording as a question.
5. Provision and rotate the device identity through an explicit enrolled-device
   flow. A dashboard session or a copied bearer string is insufficient evidence
   of device admission. Resolve the hosted tenant and actual deployment before
   accepting a local or synthetic identity check as runtime proof. Define
   revocation, loss recovery and request logging that excludes question text,
   speech, audio and provider secrets.

## Delivery gates

- Native lifecycle and bridge tests cover no capture on launch, Disable/lock/
  mute/permission invalidation, stale callbacks, timers during network failure,
  strict timer parsing and independent timer cancellation.
- Service tests cover wrong tenant, revoked or missing device identity, limits,
  provider failures, disconnect cancellation and concurrent requests. Hosted CI
  and independent review are separate from deployment.
- Before device installation, check capture state and have the owner Disable
  locally if active. Run an attended device trial for face and controls,
  questions, timers, USB-free network, lock behavior and repeated recognition.
  Report automated, hosted, installed, audible and owner-confirmed evidence
  separately. Do not change lock settings or remotely activate capture.

The next implementation unit is the native bridge and read-only state snapshot
with a dedicated page in the debug Android app. It can be tested without
enabling capture. Hosted endpoint work follows the identity contract before
the computer relay is removed.

## Initial debug entry slice

The debug Android Home build now offers a dedicated Meet Luna entry page. Its
native command opens the separately installed probe activity by explicit
component name; it does not start the listener or claim access to probe timers.
The page says that face, timer and microphone controls remain in that separate
app. It is omitted from desktop and non-debug Android builds. This establishes
the Home navigation and narrow native launch path only. The state snapshot,
native ownership migration, hosted service and USB-free behavior above remain
implementation work.
