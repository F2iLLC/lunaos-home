# Luna music: play, pause and skip by voice

After `Hey Luna`, a person can say play, pause, next or previous and Luna asks
the Spotify app on the same Android device to do it. Luna presses the buttons.
The person chooses what to listen to in Spotify.

Nothing here has run on a device. See "What is verified" before relying on it.

## Phrases

Say `Hey Luna`, wait for the cue, then one of these. Case, end punctuation, a
repeated `Hey Luna` and a trailing `please` are ignored, as they are for timers.

| Action | Phrases |
| --- | --- |
| Play | play music, play some music, play my music, play spotify, resume the music, unpause the music |
| Pause | pause the music, stop the music, pause music, stop music, turn off the music, turn the music off, pause spotify, stop spotify |
| Next | next song, next track, skip, skip this song, skip song, play the next song |
| Previous | previous song, previous track, last song, go back a song, play the previous song |

The list is exact. Nothing is guessed or repaired into a music command:
`play music tomorrow`, `don't play music`, `stop the music in five minutes`,
`next song twice` and `play song` press no button and start no timer. A polite
opening is not understood in this rung either: `please play music` is not a
music command, though `play music please` is.

Wording that is not on the list is treated like any other speech. If online
answers are on, it may be sent on as a question and answered. Only the exact
phrases above and the fragments `play`, `play the`, `music`, `skip the` and
`pause the` are always kept from the hosted model.

`pause`, `stop`, `resume`, `continue`, `hold it`, `stop it`, `turn it off` and
`cancel` on their own still belong to timers and mean what they meant before.
To pause the music, say `pause the music`.

A music phrase does nothing before `Hey Luna`. While a timer is ringing, only
the words that stop the alarm work without the wake phrase. There is one case
where the wake phrase is not needed: when Luna has just asked something and is
waiting for the reply, she is already awake, and a music phrase said then is
acted on, as a timer command would be.

## One-time setup

1. Install the Spotify app on the device.
2. Open Spotify and sign in.
3. Play something once, so Spotify has something to resume.

Luna holds no Spotify account, password or token and does not contact Spotify's
servers. She cannot sign in for you or choose music.

## What happens

1. The words are recognized. How depends on the build; see "Where it works".
   In both builds the recognized words are then checked on the device, the same
   way timer commands are.
2. `MusicCommand` turns a complete phrase into one of four actions. The words
   are not kept. A music action is never a timer command, and `QuestionPolicy`
   never passes a phrase from the table on as a question.
3. `MusicControl` decides what to send: Android's media play, pause, next or
   previous key, addressed to the package `com.spotify.music` and to nothing
   else.
4. `MusicPlayer` sends that key as a media button broadcast limited to the
   Spotify package. No other app can receive it and no screen is opened.
5. The wake service records the result and goes back to listening. It speaks
   nothing and launches nothing.

## What a person sees

Luna does not speak a confirmation.

**When Spotify was asked.** The status reads `Asked Spotify to play.` (or
`to pause.`, `for the next song.`, `for the previous song.`). Spotify does not
report back, so this is not a claim that anything is playing. Listening starts
again a quarter of a second later, so the status is replaced almost at once. On
the Home screen nothing is shown for a sent command; the music is the
confirmation.

**When nothing was sent.** The reason is left up long enough to read:

- On the Home screen it appears as a caption, `Luna: Spotify is not installed
  on this device. Nothing was sent.`, for about six seconds or until Luna next
  hears something. It uses the caption Home already shows for Luna's replies,
  so it is not shown if Luna captions are turned off. Home has no separate
  face for this; it shows the waiting face.
- In the listening notification, and on the offline test app's status line, the
  same words stay for two and a half seconds before listening starts again.

| Status | Meaning |
| --- | --- |
| `Spotify is not installed on this device. Nothing was sent.` | Spotify is missing or disabled. Nothing was sent to any app. |
| `Could not reach Spotify. Nothing was sent.` | Android refused the broadcast. |
| `Listening stopped first. Nothing was sent to Spotify.` | Listening was disabled, or the device was locked or muted, before the key could be sent. |

Log codes are fixed words only: `MUSIC_COMMAND`, `MUSIC_NOT_SENT`,
`MUSIC_COMMAND_SENT`, `MUSIC_COMMAND_NOT_SENT`, `MUSIC_COMMAND_UNDELIVERED`,
`MUSIC_COMMAND_HANDLED` and `AUDIO_FOCUS_UNAVAILABLE`.

### Hearing the next command

While Luna is awake and the microphone is listening for a command, she holds
short-term audio focus, which asks other media to go quiet. She gives it back
when the microphone stops, however that happens: a command, a timeout,
listening being disabled, or a failure.

- **Offline test app.** Focus is taken when the command window opens during
  wake listening, and given back when the microphone stops. If the speech has
  to be decoded a second time, that happens after the microphone has stopped,
  so focus is not held through it. The foreground test screen takes no focus.
- **Home.** Focus is taken only when Luna is already awake as she starts to
  listen: after `Hey Luna` said on its own, or when she is waiting for a reply.
  It is given back when that recording ends, before the Mac is asked what was
  said. If the wake phrase and the command are said in one breath, Luna does
  not know she is awake until the Mac answers, so nothing is quieted first.

Focus is not held while Luna speaks a timer confirmation or an answer. For a
music command the key is sent after focus has been given back.

## Where it works

**Home debug build.** Home has no speech recognizer on the device. Its capture
class (`scripts/android/voice/HomeProbeCapture.java`) sends what the microphone
heard to the enrolled Mac, which returns the words. That is how Home already
hears every command, timers included, so music adds no new place your speech
goes. The returned words are checked on the device by `MusicCommand`; a music
phrase stops there and is never sent to the hosted model. The key is then sent
to Spotify on the device. `scripts/prepare-android.mjs` packages the three
music classes into the debug build only and adds one `<queries>` entry so Home
can see whether the Spotify app is installed. It adds no permission.

**Offline voice test app** (`scripts/build-android-offline-voice-probe.ps1`).
This build has the fixed-phrase recognizer on the device and needs no Mac. The
one recognizer that hears the wake phrase and timer commands also knows the
music phrases; `MusicCommand.commandGrammar()` is the timer phrase list
followed by the music phrases. There is still exactly one such recognizer. Its
manifest has the same `<queries>` entry and no new permission.

Release builds and the desktop app get neither the music classes nor the
Spotify entry.

## What is verified

Automated, on the JVM only. Each test runs real classes against stand-ins for
Android and for the recognizer. The stand-ins record what would be sent. They
do not show that Android delivers it or that Spotify acts on it.

`node --test test/android-music-routing.test.js`:

- every phrase in the table parses to its action, and every phrase offered to
  the recognizer parses back to an action;
- wording outside the list is no music action and no timer, and timer words
  parse exactly as before;
- no phrase from the table, and none of the five fragments, is a question;
  questions that mention music, or begin like a music phrase and go on, still
  are;
- nothing is accepted before the wake phrase, including while a timer rings,
  and one wake allows one effect;
- every action is addressed to `com.spotify.music`, and with Spotify missing
  nothing is produced for any app.

`node --test test/android-home-music.test.js`:

- the prepared Home debug sources contain the music classes and the one
  Spotify `<queries>` entry, and no other prepared source does;
- Home's real capture class, given scripted words in place of the Mac, turns a
  music phrase after the wake phrase into a media key addressed to Spotify;
  sends nothing when Spotify is missing; does nothing without the wake phrase;
  and leaves timers and questions as they were;
- audio focus is taken exactly once when Luna listens already awake and given
  back exactly once on every way out, and never taken otherwise.

`node --test test/android-offline-music.test.js`:

- the offline test app's real capture class, given a scripted speech library,
  does the same for wake listening, including when the music phrase is found
  by the second decode;
- focus is given back when the microphone stops, before any second decode;
- the foreground test screen keeps the timer-only phrase list, acts on no
  music phrase and takes no focus.

`node --test test/android-music-service.test.js`:

- the real wake service, as Home packages it, keeps listening after a music
  result, releases its wake lock, creates no timer and speaks nothing;
- a not-sent result sets the caption and the status and re-arms after two and
  a half seconds; a result code it does not know still ends listening.

The Android-facing classes were compiled against the Android platform library.
That shows they build, not that they work.

## What is not verified

Nothing has been installed, heard or confirmed by a person. In particular:

- whether Spotify acts on the media button broadcast at all on the device, and
  whether it starts playing from a cold start;
- whether these phrases are recognized reliably, by the Mac for Home or by the
  recognizer on the device for the test app, and whether other speech is
  mistaken for them;
- whether Luna hears `Hey Luna` over music from her own speaker;
- whether Spotify goes quiet when Luna takes audio focus, and whether it stays
  paused after `pause the music` once focus is given back;
- in what order Spotify receives the return of audio focus and the key, and
  whether that order matters;
- whether the caption and the two and a half seconds are in practice enough
  for a person at the device to notice that nothing was sent;
- whether taking focus in Home cuts off a vehicle greeting or reply playing in
  the same app. `VehicleAudioService` and `VehicleReplyPlayer` stop when they
  lose audio focus, and nothing here has been tried with them;
- whether acting on a music phrase without the wake phrase, while Luna waits
  for a reply, is ever a surprise in use;
- whether music returning while Luna speaks a reply is a problem in use.

Each needs an attended trial with Spotify installed and signed in. Record
automated, installed, audible and owner-confirmed evidence separately.

## Limits

- Spotify only, on the same device. No other player, speaker or account.
- No playing by name: no song, artist, album or playlist requests.
- Bare `stop` and `pause` never mean the music.
- Polite openings such as `please play music` are not understood.
- No now-playing display, no volume control, no spoken confirmation.
- No Spotify Web API or Connect, and no stored sign-in.
