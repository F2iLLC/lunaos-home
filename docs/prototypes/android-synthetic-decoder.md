# Synthetic wake/command decoder experiment

This Windows-only development harness investigates the decoder switch without
recording a person or starting the probe. It uses Windows SAPI voices to produce
16 kHz, 16-bit mono PCM in memory. It exports the current Java wake and command
grammars and classifies Windows decoder results with the current Java parser.
Only fixed codes and synthetic fixture coordinates are printed. Generated PCM,
models, downloaded libraries and compiled helpers remain outside Git.

The Windows native runtime is Vosk 0.3.45 from the official PyPI distribution,
which differs from the APK's pinned Vosk Android 0.3.75. The model archive is the
same pinned `vosk-model-small-en-us-0.15` used by the offline APK builder.
[Vosk installation documentation](https://alphacephei.com/vosk/install) describes
its Windows support and PCM format. The experiment does not use Python or a
microphone. It cannot establish Android lifecycle behavior, cue acoustics,
recognition reliability or timer delivery.

## Run the Windows experiment

Use Windows x64 PowerShell 7, a JDK and installed SAPI voices. Keep the existing
offline builder input directory containing the pinned `model.zip`. Fetch the
additional wheel described by
`scripts/android-offline-voice-probe/synthetic-inputs.json` into that directory;
the harness verifies both checksums before extracting or loading native code.
No dependencies are downloaded by the harness itself.

```powershell
$inputRoot = 'C:\path\outside-git\offline-inputs'
$outputRoot = Join-Path $env:TEMP ('home-synthetic-' + [guid]::NewGuid().ToString('N'))
$dependency = Get-Content -Raw scripts/android-offline-voice-probe/synthetic-inputs.json | ConvertFrom-Json
Invoke-WebRequest $dependency.url -OutFile (Join-Path $inputRoot $dependency.file)
./scripts/test-android-synthetic-decoder.ps1 -InputDirectory $inputRoot -OutputDirectory $outputRoot -Jdk 'C:\path\to\jdk'
```

The default matrix uses each installed voice at SAPI rates -2, 0 and 2, with two
replays of each fixture. Each has a command-only control and five two-stage
trials with 0, 250, 500, 1000 or 1500 ms added silence between synthesized wake
and command buffers. SAPI includes pauses of its own, so added silence is not
the measured interval between spoken words. A 100 ms chunk capacity matches
`ProbeCapture`'s 1600-sample array; actual nonblocking device reads can be shorter.
Only finalized results are considered, and commands are never joined or repaired.
The command deadline is simulated on the PCM timeline. This is not the real
watchdog, service or review path, and no cue audio is mixed into the fixtures.

`results.json` contains the fixed outcomes. `commandBufferBeforeSwitchMs` is the
portion of the command buffer consumed by the wake decoder, not a measurement
of lost spoken words. Rejected cases are experimental observations: the script
does not report them as passing qualification or change acceptance to hide them.
The exported `fixtures` directory contains only the generated synthetic PCM,
grammars and a manifest for native Android replay.

## Replay through the pinned Android library

The optional `scripts/android-offline-voice-probe/synthetic-replay.c` executable
loads the APK builder's extracted ARM32 `libvosk.so` and model, then replays the
same synthetic fixtures. It has no capture, service, Clock or timer APIs. Its
output includes expected-command match, wake match and fixed rejection counts;
the Windows Java classification is more detailed. It accepts only the expected
five-second command for the experiment, not a substitute production policy.

Compile with an installed Android NDK for `armv7a-linux-androideabi26`, using
`-Wall -Wextra -Werror -fPIE -pie` and `-ldl`. Put the executable outside Git.
With a single authorized device connected and microphone capture stopped, copy
the executable, pinned library, pinned model directory and generated fixtures
to a new task-specific `/data/local/tmp/home-synthetic-<unique>` directory. Run:

```text
<scratch>/synthetic-replay <scratch>/libvosk.so <scratch>/model <scratch>/fixtures 2
```

The final argument is the number of repetitions, from 1 to 10. Use the native
library and model produced by the checksum-verifying APK builder. Verify their
device-side hashes against the local inputs. This standalone shell process
bypasses AudioRecord and the app lifecycle; matching the native decoder version
does not make this a complete device recognition or cancellation test. Do not
start microphone capture through ADB to complete this experiment.

## Initial synthetic results

With the Microsoft David and Zira desktop voices, three rates, six control/gap
conditions and two repetitions, the Windows run completed 72 cases. All 12
command-only controls and all 48 trials with added silence matched the expected
five-second command. Of the 12 two-stage zero-added-gap trials, the four at rate
2 rejected with `UNCLEAR_SPEECH`; the slower eight matched. In the failing cases,
260 or 265 ms of the command buffer went to the wake decoder before the switch.
The same fixture matrix through the pinned Android 0.3.75 ARM32 library completed
72 cases with the same four failures and 68 expected matches. Native library
and acoustic-model hashes on the device matched the local builder outputs.

This is a reproducible synthetic timing failure when command audio begins
before the wake decoder finishes. It supports waiting for the wake cue as
already instructed. It does not identify the cause of the earlier attended
`INCOMPLETE_TIMER_PHRASE` failures: those had a different category and their
wake/command timing is unknown. SAPI-generated audio, artificial silence and a
standalone native process do not reproduce a room, speaker, cue echo, device
AudioRecord path or app scheduling. No production parsing, capture or timer
authorization was changed based on this experiment.
