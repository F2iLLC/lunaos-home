# Notebook through the Mac relay

Continuation of issue #320 and the Mac vault host decision. The relay opens the
existing household vault once. Voice, the notebook page and the checklist use
that store through the existing notebook service. There is no client-side list
store or automatic retry of mutations.

## Explicit preview configuration

Keep configuration, certificates and keys outside the checkout. In the existing
private spoken-question relay configuration, `notebookEnabled: true` enables
the authenticated `/notebook` route and local notebook handling on `/question`.
The process also needs `LUNA_HOME_VAULT=1` and must run in the signed-in macOS
session with access to the existing login Keychain. The relay refuses startup
if the requested vault cannot open. Stop other processes owning that same vault
before starting the relay; clients connect to the relay rather than opening it.

`notebookSpeech: true` separately permits notebook replies, including item text
when reading a list, to be sent to ElevenLabs for speech. It defaults to false;
then only a fixed instruction to check the screen is synthesized. Notebook
commands and records are never supplied to Qwen. Enabling notebook access
expands the provisioned relay token's authority from questions to the household
notebook. Provision that configuration only to admitted household devices.
The existing private interface restriction, TLS certificate verification and
bearer-token check still apply. This is a development preview, not a replacement
for the vault enrollment, recovery and lifecycle gates.

For the desktop HTTP preview, set `LUNA_HOME_NOTEBOOK_RELAY_CONFIG` to the
absolute path of the device's private JSON configuration containing `endpoint`
(the HTTPS `/question` URL), `certificate` (the relay PEM), and `token`. The local
server holds those credentials; browser code never receives them. This takes
precedence over local preview stores. The native Windows vault client remains
outside this change; this path is the Windows browser/HTTP preview.

The Android debug app uses its existing privately provisioned
`question-relay.json`. Its notebook page calls a main-window-only native command,
which posts to `/notebook` using the same certificate and token. Opening the page
does not enable the microphone or send text to a speech provider. Voice uses
the existing explicit online-answer setting and wake-word gate. Rebuild the app
to include the new native command. The release/offline build gains no network
permission or native command capability.

## Outcomes and conversation boundaries

Each browser page and voice listener uses a random conversation identifier.
The relay maintains at most 64 conversations, expiring inactive ones after two
minutes. Dialog context, destructive confirmations and member attribution are
separate per conversation. Legacy clients without an identifier get a fresh
dialog each request. Unrelated speech clears the active list. Turning off or
restarting Android wake listening rotates its identifier. Every command still
requires a new wake; follow-ups must also be preceded by “Hey Luna”. “Cancel”
and “stop” retain their local timer meaning; answer “no” to a notebook prompt.

Successful speech responses carry an allowlisted animation name derived from
the notebook outcome. Android consumes it only after receiving valid audio;
sleep and ringing timers take priority over the notebook overlay. No success
animation is sent if storage or speech generation fails. A speech or network
failure after a committed write is not proof of rollback: the page tells users
to reopen the list before retrying. The visible notebook refreshes periodically
while the user is not interacting with one of its controls.

## Verification and remaining acceptance

`notebook-relay.test.js` exercises the real HTTP path and encrypted file adapter:
three isolated lists, modifications, restart, denied requests, conversation
isolation, confirmation, storage failure/recovery and speech failure after a
commit. `remote-notebook.test.js` exercises desktop HTTP → pinned HTTPS → shared
notebook, including rejected tokens and hostname mismatches. Java fixtures
execute wake routing, HTTPS reply handling and the animation handoff, and compile
the Home reply variant. Native frontend bundling includes the notebook page.

These are synthetic checks, not an Echo Show microphone, speaker, screen or APK
acceptance run. No household vault or production relay is created or changed by
the tests. Physical-device acceptance, native Android Rust/Kotlin build validation,
native Windows integration, and migration of the legacy grocery record into the
notebook still remain. The legacy grocery contract is not silently migrated or
dual-written by this change. Issue #320 must remain open until these are resolved.

On the development Mac, 39 focused tests passed, including the JVM transport and
wake fixtures. Full suite: 425 passed, 13 failed, 87 skipped. An unchanged
`4785b81` checkout with the same JDK and environment produced the identical 13
failure names (419 passed, 87 skipped): PowerShell is absent and the system
OpenSSL does not support the TLS fixtures' arguments. The native frontend build
passed. Browser inspection was attempted but the browser-control host was
unavailable; no visual acceptance is claimed.
