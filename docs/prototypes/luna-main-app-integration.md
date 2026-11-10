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

The debug Android Home build puts Luna on the home page. Her face is a button:
pressing it turns wake listening on or off, and it is the only thing on the
home page that does. Asleep, with a sleep mask and drifting z's, means the
microphone is off; a faint glow means she is listening for the wake phrase; a
bright glow means she is ready for a command. Active timers appear under her
with their countdown and a stop button, and the area stays empty when none are
running. While she is listening the page asks Home for its state once a
second so the face keeps up; otherwise every five seconds.

A gear at the bottom right of the home page opens the settings and
troubleshooting page (formerly Meet Luna, still at `#luna`). It reads Home's
own service and timer ledger, reports an unavailable local model, and supports
explicit microphone permission, listening Enable/Disable and the online-answer
setting. Online answers require private relay configuration and a separate
explicit setting in Home. All of this is omitted from desktop and non-debug
Android builds, which keep the static companion.
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

**Stopping.** `stop`, `cancel`, `stop it`, `turn it off`, `shut it off`, and
`stop`, `cancel`, `end`, `turn off` or `shut off` followed by `the timer` or
`the alarm` (also `turn the alarm off`) all mean one thing: silence every timer
that is ringing and leave timers that are still counting alone. With nothing
ringing they mean the one active timer, as `cancel the timer` always did, and
are refused as ambiguous when several are counting. The same verbs with a
number (`stop timer two`) cancel that timer. A stopped alarm is confirmed by
the silence, not by a spoken reply.

While a timer is ringing, and only then, that plain request is honored without
the wake phrase, so `stop` or `Luna, stop` is enough. Nothing else is accepted
without the wake phrase, and numbered timers still need it. This is not yet
established on the device: whether `stop` is heard over the alarm at full
volume, and whether the alarm's own sound is ever mistaken for it, each need
attended use. Pausing and resuming a timer are not supported.

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
files directory. Then open settings (the gear), explicitly enable Qwen answers, and
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

## Command capture after the wake phrase

Wake detection uses a fixed phrase list and decodes in real time. Free-form
recognition does not on the 32-bit Echo Show 8 development device: fixed
diagnostic timings from attended exchanges showed single decode calls of about
3 s against a 200 ms recorder buffer, and command windows in which 25% to 58%
of the captured audio never reached the recognizer. Spoken questions mostly
survived that; timer commands, which must match exactly, never did.

The capture path now works in two stages:

1. **Live, fixed phrases.** One fixed-phrase recognizer hears the wake phrase
   and, after it, timer commands. From the wake match a capture thread keeps
   every sample of the command window in `CommandAudio`, and the recognizer
   follows it in real time. A supported timer command is acted on directly.
   Before the wake phrase `WakeSession` still accepts nothing but an exact
   "hey luna".
2. **Once, free-form.** If the fixed-phrase recognizer hears speech that is
   not a supported timer command and online answers are enabled, the
   microphone stops and the complete captured command is decoded once with the
   free-form recognizer, within a bounded time. The text is then routed as
   before: the strict timer parser first, then the question policy.

`CommandAudio` holds at most the 15 second command window, refuses and counts
anything beyond it, and is zeroed whenever capture closes. It does not exist
before the wake phrase, so the pre-wake path keeps its small recorder buffer.
Nothing is written to storage or sent anywhere. `CAPTURE_TIMING` reports
`maxQueuedMs` and `droppedMs`, and a `REPLAY` phase for the second stage,
still numbers only.

There is deliberately one fixed-phrase recognizer. A build with a separate
one for timer commands crashed inside the speech library on the device twice
in a handful of wakes (a segmentation fault in its lookahead composition);
the single-recognizer build has not crashed in the attended use so far, which
is an observation, not a qualification.

Attended on the device with the single-recognizer build: timers set from
"two minutes", "one hour" and "one minute and thirty seconds" with the spoken
confirmation, and a spoken question answered correctly. A timer command was
matched with `audioMs` equal to `elapsedMs` and nothing dropped; a question
took about 5 s of capture, 6 s of local decoding and 3 s for the answer.
Recognition across voices, distance, noise and a ringing alarm is not
established.

## Timer durations and the spoken confirmation

A new timer accepts seconds (1-60), minutes (1-60) or hours (1-24), "an hour",
"a minute", and descending combinations such as "one hour and thirty minutes"
or "two minutes thirty seconds", up to twenty four hours in total. Parsing is
strict: wrong order, repeated units, plural mismatches and out-of-range parts
are refused, never repaired. Adding time to a running timer stays within an
hour.

Luna confirms a new timer with "Setting a timer for" followed by its hour,
minute and second parts, and the timer's number when it is not timer one. The
words come from bundled clips, so the confirmation works without the relay.
The clips are generic generated prompts listed in `reply-prompts.json`; the
audio stays outside Git. To include it in a debug build, set
`LUNA_HOME_VOICE_REPLY_DIRECTORY` to a prepared pack (`pack.json` plus one
canonical 24 kHz mono WAV per manifest entry). The build validates every
clip's text, checksum and format and refuses an incomplete pack. Without the
variable, timers work and Luna stays silent. Generate every clip with the same
voice: a pack mixing two voices is audible as soon as a second timer is
announced.
