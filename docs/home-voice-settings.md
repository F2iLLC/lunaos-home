# Home voice settings

Open the home screen gear, then tap a **Luna’s voice** choice button. Each tap
saves the choice and plays the bundled “Set for 5 minutes” sample, including
when tapping the selected voice again. No timer starts and listening is unchanged.
A new tap replaces the previous preview; playback failures retain the saved choice. Lori is the default when
her complete reply pack is installed; Original retains the existing pack and the
relay's configured voice. The choice persists on this device across restarts and
in-place APK updates. It applies to subsequent replies without enabling listening.
An ongoing timer acknowledgement finishes in the voice it started with.

For Android debug builds, keep prepared audio outside the repository and set:

- `LUNA_HOME_VOICE_REPLY_DIRECTORY`: the existing Original reply pack.
- `LUNA_HOME_LORI_REPLY_DIRECTORY`: the Lori reply pack, whose manifest must include
  `voiceId: "TbMNBJ27fH2U0VgpSNko"`.

Each directory contains `pack.json` with `provider: "ElevenLabs"` and all entries
from `scripts/android-offline-voice-probe/reply-prompts.json`. Each entry has the
exact `id`, `text`, and WAV `sha256`. Audio must be canonical mono 24 kHz PCM16 WAV.
The build validates every clip before publishing that pack's availability marker.
Missing packs are omitted from the choices. Include both to permit switching.
Never commit provider keys, generated audio, or private configuration.

Update the private spoken-question relay alongside the APK. Android sends the
saved `original` or `lori` choice in `X-Home-Voice` on question and confirmation
requests. The relay maps Lori to the fixed ID above and Original to its existing
configured `voiceId`. Requests without the header retain legacy behavior;
unrecognized choices are rejected before provider calls. Older relays ignore the
header and continue using their configured voice until updated.
