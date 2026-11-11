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

These are synthetic checks, not an Echo Show microphone, speaker or screen
acceptance run. No household records are used. Physical-device acceptance and
native Windows integration still remain. Grocery unification landed separately
in #345 and is included through the merge from main. Issue #320 remains open
while deployment and acceptance are outstanding.

At `56d6db3`, the complete Windows suite passed: 482 passed, 0 failed, 51 skipped.
The ARMv7 Android debug APK also built successfully, including Java, Kotlin and
Rust, with the existing speech model/reply pack and software rendering. The
corresponding Mac run had 384 passed, 13 failed and 85 skipped. Those 13 failure
names also failed on the earlier unchanged-main baseline: PowerShell is absent
and the system OpenSSL does not support the TLS fixtures' arguments.

A temporary signed-in Mac relay with a separate Keychain-backed synthetic vault
accepted a list creation, returned a real ElevenLabs WAV and `scribble` feedback
after adding an item, and retained that item after the relay process restarted.
This exposed the speech cooldown blocking an immediate page read; the cooldown
now applies only to speech routes, with a regression check. Browser inspection
was attempted but the browser-control host was unavailable; no visual acceptance
is claimed.

The ARMv7 debug APK built from `56d6db3` with `CARGO_PROFILE_DEV_DEBUG=0`
installed successfully on the selected Echo Show 8 (Android 11). Its SHA-256 is
`7535c26cc1beaf10de4f72035a69965f485bc8a986f7ab78084e07a5133b5438`.
The prior APK was preserved for rollback. Installation is not microphone,
speaker or visual acceptance; an attended check was requested separately.

Attended feedback confirmed the explicit movie-list addition; an authenticated
readback verified both synthetic titles in the vault. The first spoken follow-up
instead produced a general answer. The exact reported phrase parses correctly
and isolated-context regression tests pass, so recognition/routing remains under
investigation; this is not a full voice acceptance pass. Readback now explicitly
says “Your … list contains …” to separate the title from the items in speech.

Successful voice results now carry the saved list identifier to the Android
snapshot. A dismissible dotted-grid notebook page loads that list from the same
vault and renders its title, quantities, notes and completion marks as text.
A new voice result refreshes the page; dismissal persists until a new result,
and sleep or a ringing timer closes it. Late reads cannot reopen a closed page.
The focused relay, popup, status polling, Java HTTPS and command-routing checks
passed (11 tests); the updated Android ARMv7 APK built successfully at `8ea8abd`.
Physical popup appearance and the first-follow-up recognition issue still need
attended verification.
The `8ea8abd` APK subsequently installed successfully on the selected Echo Show
with an in-place update; the test relay remains temporary for attended checks.

The next attended readback confirmed the clearer spoken wording and avatar
notebook animation, but no readable popup appeared. The native Rust
`LunaSnapshot` omitted `notebookListId` and `notebookEvent`, silently dropping
Java's fields during deserialization. Commit `8294540` preserves both fields.
Seven focused bridge-wiring, status-polling and popup checks pass; the ARMv7 APK
rebuild also passes. This fixes a concrete missing handoff; on-screen acceptance
must still be repeated on the updated device build.
The corrected `8294540` APK installed successfully in place on the Echo Show.

Further attended attempts misrecognized the requested list name and sent the
reported exact inventory question to the general-answer model. Content-free
routing diagnostics confirmed two local `show` failures and one unhandled turn;
no transcript or audio was logged. Recognition remains unverified.

The command decoder now replays the entire post-wake buffer. An empty result
from its restricted timer grammar is not evidence of silence and no longer
advances the replay start. This removes a possible source of clipped commands;
it is not proof of the cause of the attended errors. Unknown names prompt with
up to five saved list names and require clarification before any write. Common
inventory phrasing stays local. General-answer instructions explicitly deny
visual access and ask for clarification of unclear recognized text.

The Android debug home page now displays the most recent recognized question
as text beneath Luna. It is memory-only, replaced by the next question and
cleared when listening is reset; it is not added to logs or the vault. Focused
notebook/relay/routing/wake checks passed (31), bridge/UI checks passed (7), and
the HTTPS reply fixture verified that the text survives playback and clears on
listener reset (1).
The ARMv7 APK at `58162a3` built and installed successfully in place on the
Echo Show for the next attended recognition check.
