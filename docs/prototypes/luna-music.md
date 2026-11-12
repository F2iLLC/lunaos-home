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

The list is exact. Extra or combined wording is refused and nothing is guessed:
`play music tomorrow`, `don't play music`, `stop the music in five minutes`,
`next song twice` and `play song` do nothing.

`pause`, `stop`, `resume`, `continue`, `hold it`, `stop it`, `turn it off` and
`cancel` on their own still belong to timers and mean what they meant before.
To pause the music, say `pause the music`.

A music phrase does nothing before `Hey Luna`. While a timer is ringing, only
the words that stop the alarm work without the wake phrase.

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
   are not kept. A music action is never a timer command. `QuestionPolicy`
   never passes on as a question a music phrase, the start of one (`play`,
   `play the`, `skip the`, `music`) or one with words added (`play music
   tomorrow`), so none of them reach the hosted model. Other requests that only
   mention music, such as `play a song about dragons` or `what is music`, are
   still questions.
3. `MusicControl` decides what to send: Android's media play, pause, next or
   previous key, addressed to the package `com.spotify.music` and to nothing
   else.
4. `MusicPlayer` sends that key as a media button broadcast limited to the
   Spotify package. No other app can receive it and no screen is opened.

Luna does not speak a confirmation. The status line and the listening
notification say what happened:

| Status | Meaning |
| --- | --- |
| `Asked Spotify to play.` (or pause, next song, previous song) | The key was sent. Spotify does not report back, so this is not a claim that anything is playing. |
| `Spotify is not installed on this device. Nothing was sent.` | Spotify is missing or disabled. Nothing was sent to any app. |
| `Could not reach Spotify. Nothing was sent.` | Android refused the broadcast. |
| `Listening stopped first. Nothing was sent to Spotify.` | Listening was disabled, or the device was locked or muted, before the key could be sent. |

Log codes are fixed words only: `MUSIC_COMMAND`, `MUSIC_NOT_SENT`,
`MUSIC_COMMAND_SENT`, `MUSIC_COMMAND_NOT_SENT`, `MUSIC_COMMAND_UNDELIVERED`,
`MUSIC_COMMAND_HANDLED` and `AUDIO_FOCUS_UNAVAILABLE`.

### Hearing the next command

When Luna wakes for a command she asks Android for short-term audio focus, which
asks other media to go quiet. She gives it back when listening for that command
ends, however it ends: a command, a question, a timeout, or listening being
disabled. For a music command the focus is given back first and the key is sent
after, so the key is the last thing Spotify is told.

Focus is held only while Luna listens. It is not held while she speaks a timer
confirmation or an answer.

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

In Home, audio focus is taken only when Luna is already awake as she starts to
listen: after `Hey Luna` said on its own, or when she is waiting for a reply.
If the wake phrase and the command are said in one breath, Luna does not know
she is awake until the Mac answers, so nothing is quieted first.

**Offline voice test app** (`scripts/build-android-offline-voice-probe.ps1`).
This build has the fixed-phrase recognizer on the device and needs no Mac. The
one recognizer that hears the wake phrase and timer commands also knows the
music phrases; `MusicCommand.commandGrammar()` is the timer phrase list
followed by the music phrases. There is still exactly one such recognizer. Its
manifest has the same `<queries>` entry and no new permission.

Release builds and the desktop app get neither the music classes nor the
Spotify entry.

## What is verified

Automated, on the JVM only.

`node --test test/android-music-routing.test.js`:

- every phrase in the table parses to its action, and every phrase offered to
  the recognizer parses back to an action;
- the refusals above, and that timer words parse exactly as before;
- no music phrase is a timer command or a question;
- nothing is accepted before the wake phrase, including while a timer rings,
  and one wake allows one effect;
- every action is addressed to `com.spotify.music`, and with Spotify missing
  nothing is produced for any app.

`node --test test/android-home-music.test.js`:

- the prepared Home debug sources contain the music classes and the one
  Spotify `<queries>` entry, and no other prepared source does;
- Home's real capture class, given scripted words in place of the Mac and
  stand-ins for Android, turns a music phrase after the wake phrase into a
  media key addressed to Spotify; sends nothing when Spotify is missing; does
  nothing without the wake phrase; and leaves timers, questions and refusals
  as they were.

The stand-ins record what would be sent. They do not show that Android delivers
it or that Spotify acts on it.

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
- whether music returning while Luna speaks a reply is a problem in use.

Each needs an attended trial with Spotify installed and signed in. Record
automated, installed, audible and owner-confirmed evidence separately.

## Limits

- Spotify only, on the same device. No other player, speaker or account.
- No playing by name: no song, artist, album or playlist requests.
- Bare `stop` and `pause` never mean the music.
- No now-playing display, no volume control, no spoken confirmation.
- No Spotify Web API or Connect, and no stored sign-in.
