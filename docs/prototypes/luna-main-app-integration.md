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

### Keeping the relay available

A relay started by hand stops at the next Mac restart or logout, and Luna
then answers no questions until someone starts it again; local timers keep
working. For a development Mac that should keep answering, run the relay as a
per-user launch agent instead. Save this as
`~/Library/LaunchAgents/io.lunaos.home.question-relay.plist`, with the three
absolute paths adjusted, and load it with
`launchctl bootstrap gui/$(id -u) <that file>`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>io.lunaos.home.question-relay</string>
  <key>ProgramArguments</key>
  <array>
    <string>/absolute/path/to/node</string>
    <string>/absolute/path/to/scripts/spoken-question-relay.mjs</string>
    <string>/private/path/host.json</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>20</integer>
  <key>StandardErrorPath</key><string>/private/path/relay.log</string>
</dict>
</plist>
```

`KeepAlive` also covers the relay starting before Tailscale has assigned its
address: the bind fails, the relay exits, and launchd retries. The relay logs
one readiness line and never question text, speech or secrets. Remove the
agent with `launchctl bootout gui/$(id -u)/io.lunaos.home.question-relay`.

The relay asks Ollama to keep the Qwen model loaded for 30 minutes after each
question. Without that, Ollama unloads the model after five idle minutes and
the next spoken question waits several seconds for a cold start (observed on
the Mac Studio: about 7 s cold against 1 to 2 s warm, synthetic questions).
The first question after a longer pause, or after an Ollama restart, is still
a cold start.

A device that cannot join the tailnet reaches the relay only through a
forward that someone maintains explicitly, such as an ADB reverse port to a
computer that tunnels to the Mac. That path is development convenience: when
the forward, the tunnel or the relay is down, questions fail. Check the three
links separately before concluding that recognition is at fault.
