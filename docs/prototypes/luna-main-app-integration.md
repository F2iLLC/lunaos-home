# Luna in the main Android app

## Decision and current evidence

Home compiles the local wake listener, Luna face and timer owner into its
Android debug package. Q&A is opt-in and routes finalized question text from
the Home app over pinned TLS to a private relay on the owner's Mac Studio. The
relay calls Qwen through Ollama on Mac loopback and uses the existing
ElevenLabs speech adapter for audio replies. The Mac relay is reachable only
over the configured Tailscale interface. Online answers remain off unless the
owner provisions the relay configuration and explicitly enables them. This
source integration does not establish a running Mac service or attended device
trial. Timer recognition reliability and genuine secure-lock cancellation
remain unverified.

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
4. The device sends only finalized question text over TLS with a pinned relay
   certificate and random bearer token. The relay binds to the Mac's Tailscale
   IPv4 address, never a public or all-interface address. Its Qwen adapter
   accepts only Ollama's Mac-loopback `/api/chat` endpoint, one user turn, no
   tools or history, and bounded input/output and timeouts. It then calls
   ElevenLabs for the configured voice. Provider credentials, token, TLS key,
   certificate and voice selection stay outside Git and the APK. Do not
   interpret incomplete timer wording as a question.
5. Keep the Mac on the private tailnet and rotate/revoke the bearer token and
   pinned certificate through explicit device re-provisioning. Do not expose
   Ollama itself to the phone or network. Request logging excludes question
   text, speech, audio and provider secrets.

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

The source integration is in the debug Android build path. Local setup and an
attended device trial are still required before online answers are available
on a device.

## Initial debug entry slice

The debug Android Home build offers a dedicated Meet Luna page. It reads Home's
own service and timer ledger, reports an unavailable local model, and supports
explicit microphone permission, listening Enable/Disable and timer cancellation.
Online answers require private relay configuration and a separate explicit
setting in Home. The page is omitted from desktop and non-debug Android builds.
This source migration does not establish installed-device reliability, audible
behavior, lock handling, or hosted service operation; those remain separate
verification gates.

## Qwen relay setup (Mac Studio)

### Timer and question routing

After the finalized wake phrase, the local parser accepts `set a timer for five
seconds`, `set another timer for 5 seconds`, `start a five minute timer`,
`add 5 minutes to timer 2`, and `cancel timer 2`. Numbers may be words or digits;
case, terminal punctuation, a repeated wake prefix and a trailing `please` are
normalized consistently. Durations remain bounded to 1–60 seconds or minutes,
and numbered targets to 1–8. `The timer` remains valid only when the native
ledger has one unambiguous target. Negatives, fractions, compound commands and
extra trailing words are rejected.

A repeated wake phrase, unknown speech or timer fragment is not a Qwen question.
Once a timer attempt is recognized in a wake window, later fragments cannot
fall through to Qwen in that window. A complete timer retry can still succeed;
a separate question requires a new wake exchange. This is deterministic routing
of finalized text, not a guarantee that the speech recognizer heard it correctly.
The JVM routing suite covers these boundaries without microphone capture.

### Private host configuration

Install and start Ollama on the Mac Studio, then pull the selected Qwen model
(default `qwen3:32b`). Leave Ollama bound to `127.0.0.1:11434`; the relay's
adapter rejects non-loopback Ollama URLs. Choose a Tailscale IPv4 address for
the Mac and a DNS name covered by the relay certificate. Generate a TLS
certificate whose SAN includes that DNS name. Keep its private key and the
relay configuration outside the repository. The Mac configuration has this
shape:

```json
{
  "enabled": true,
  "provider": "ollama-qwen",
  "bindAddress": "100.x.y.z",
  "ollamaEndpoint": "http://127.0.0.1:11434/api/chat",
  "model": "qwen3:32b",
  "token": "64 lowercase hex characters",
  "voiceId": "configured ElevenLabs voice id",
  "envFile": "/private/path/with/ElevenLabs/key",
  "cert": "/private/path/relay-cert.pem",
  "key": "/private/path/relay-key.pem"
}
```

Start `node scripts/spoken-question-relay.mjs <private-host.json>` on the Mac.
It listens only on the configured Tailscale IPv4 address, port 18743. Provision
the Home app's private `question-relay.json` with the same token, the PEM
certificate text, and `endpoint` set to
`https://<certificate-dns-name>:18743/question`. The endpoint hostname must
match the certificate. Install that file under the Home Android app's private
files directory. Then open Meet Luna, explicitly enable Qwen answers, and
separately enable wake listening. Keep the phone connected to the same tailnet.
Disabling or changing the online-answer setting stops wake listening.

The existing PowerShell setup script provisions the standalone local probe and
is not the Mac Studio setup path. The private Mac relay is development setup;
it is not tenant enrollment or a production service. Never open port 18743 or
Ollama to the public internet.
