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

1. The one fixed-phrase recognizer that already hears the wake phrase and timer
   commands also knows the music phrases. There is still exactly one such
   recognizer; `MusicCommand.commandGrammar()` is the timer phrase list followed
   by the music phrases.
2. `MusicCommand` turns a complete phrase into one of four actions. The words
   are not kept. A music action is never a timer command, and
   `QuestionPolicy` never passes a music phrase, a fragment of one or a refused
   one on as a question, so none of them reach the hosted model.
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

The music path is in the offline voice test app built by
`scripts/build-android-offline-voice-probe.ps1`, which is the build that has the
fixed-phrase recognizer on the device. Its manifest declares that it can see the
Spotify package (`<queries>`); it asks for no new permission.

The Home debug build does not hear music commands yet. It replaces the capture
class with `scripts/android/voice/HomeProbeCapture.java`, which sends speech to
the enrolled Mac for recognition and has no recognizer on the device. That file
was not changed, and the music classes are not packaged into Home. In Home a
music phrase is refused as a question and nothing else happens.

## What is verified

Automated, on the JVM only (`node --test test/android-music-routing.test.js`):

- every phrase in the table parses to its action, and every phrase offered to
  the recognizer parses back to an action;
- the refusals above, and that timer words parse exactly as before;
- no music phrase is a timer command or a question;
- nothing is accepted before the wake phrase, including while a timer rings,
  and one wake allows one effect;
- every action is addressed to `com.spotify.music`, and with Spotify missing
  nothing is produced for any app.

The Android-facing classes were compiled against the Android platform library.
That shows they build, not that they work.

## What is not verified

Nothing has been installed, heard or confirmed by a person. In particular:

- whether Spotify acts on the media button broadcast at all on the device, and
  whether it starts playing from a cold start;
- whether the recognizer hears these phrases reliably, or mistakes other speech
  for them;
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
