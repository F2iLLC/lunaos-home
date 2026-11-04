# Luna in the main Android app

## Decision and current evidence

The owner selected a hosted LunaOS service with device authentication for online
answers. The standalone 0.15 voice probe works for attended spoken questions and
selected-voice replies. Home now compiles the local wake listener and timer
owner into its Android debug package. Android keeps each installed package's
private preferences and files separate, so Home exposes only its new ledger;
existing timers in a standalone probe remain there and cannot be claimed or
canceled by Home. The computer relay and USB reverse are excluded from Home.
Online answers remain off until the authenticated hosted service is integrated.
Timer recognition reliability and genuine secure-lock cancellation remain
unverified.

## Existing app boundary

Home's Android shell is a Tauri WebView in `scripts/android/MainActivity.kt`.
`scripts/prepare-android.mjs` packages the local wake service, timer ledger,
alarms, status face and Vosk runtime into the debug variant. The voice model is
provided through `LUNA_HOME_VOICE_MODEL_DIRECTORY` at build time and is not
committed. The native service and timer ledger run in Home's Android application
sandbox and use Home's private files and preferences.

The debug-only Home bridge exposes a read-only snapshot, a separate microphone
permission request, explicit Enable and Disable controls, and numbered timer
cancellation. Each command is restricted to the local main window. Loading Home
or refreshing the snapshot does not start capture. The microphone permission
button never enables listening. The standalone probe's existing native timers
remain outside Home's state boundary.

## Target contract

1. Keep the native listener, timer ledger, alarms, playback and required offline
   assets in the main Android package through the reviewed build path. Keep one
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

The source migration is implemented in this debug build path. Hosted endpoint
work still follows the identity contract; until then Home has no online-answer
path.

## Initial debug entry slice

The debug Android Home build offers a dedicated Meet Luna page. It reads Home's
own service and timer ledger, reports an unavailable local model, and supports
explicit microphone permission, listening Enable/Disable and timer cancellation.
Online answers are hard-disabled in Home until the authenticated hosted service
is integrated. The page is omitted from desktop and non-debug Android builds.
This source migration does not establish installed-device reliability, audible
behavior, lock handling, or hosted service operation; those remain separate
verification gates.
