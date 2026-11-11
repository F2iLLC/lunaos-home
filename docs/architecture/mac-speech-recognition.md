# Mac-hosted speech recognition

Home's Android debug app is a microphone/display client. Its APK contains no
Vosk model, local speech recognizer or JNA runtime. The older standalone offline
probe sources are development fixtures, not the capture implementation packaged
in Home. `prepare-android.mjs` selects `HomeProbeCapture.java`, removes the legacy
generated model assets and removes the old recognizer dependencies.

When the user enables listening, energy detection collects short speech segments
as 16 kHz mono signed little-endian PCM. This is signal thresholding, not speech
recognition. Both wake-word and command speech go to the enrolled Mac over the
existing pinned HTTPS connection and bearer authorization. Capture is paused
during recognition and speech playback. Locking, muting, disabling listening or
revoking microphone permission stops capture. If the Mac is unavailable, Home
stops listening with an error; it never falls back to an on-device model.

The relay's `speechRecognition: true` option enables `/recognize`, which accepts
at most 25 seconds / 800,000 bytes, authenticates before consuming audio, and
forwards only to `127.0.0.1:18744`. No audio retries or filesystem writes occur.
`scripts/mac-speech-server.py` uses MLX Whisper on Apple Silicon, with the model
loaded once from a local directory. It requires the same token and binds only
loopback. Raw audio and transcripts are not logged. The existing speech-output
provider receives reply text as before, never microphone audio.

Install the pinned Python requirement from `scripts/requirements-mac-speech.txt`
in a private virtual environment. Download `mlx-community/whisper-large-v3-turbo`
outside the checkout; the validation installation uses repository revision
`a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb`. Start the Python service with the private
relay configuration path and local model directory as arguments. A signed-in Mac
LaunchAgent keeps this loopback service available. Start it before enabling the
relay option and installing the model-free APK.

When Luna's actual reply asks a question, an authenticated response flag requests
one follow-up window. Only successful audio playback enables it. The microphone
opens after playback, and accepts one reply for up to 25 seconds without another
wake phrase. Silence returns to wake-word listening. Failed/cancelled playback,
lock, mute or disabling listening cannot open a follow-up window. Notebook
clarification/confirmation uses the existing isolated dialog. General-answer
follow-ups carry bounded, memory-only prior question context for the same
session, expire after two minutes, and are not applied to a fresh wake request.

Captions stay visible during replies and disappear about six seconds after
playback finishes. The gear toggle still remembers only its on/off preference.

Validation must distinguish packaging checks and synthetic recognition from an
attended microphone test. A successful build or transcription of synthesized
audio is not proof of real-room recognition accuracy or wake latency.
