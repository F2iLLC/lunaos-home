# Converted Android foreground microphone probe

This attended five-second test checks the selected Android device's ordinary
microphone route. It is not a wake detector, speech recognizer or background
listening service. It adds no dependencies or enterprise source. The Android
[AudioRecord API](https://developer.android.com/reference/android/media/AudioRecord)
supplies transient mono PCM16 samples at a requested 16 kHz. The app computes
only level information and clears each sample array after use and on exit.
It writes no audio, transcript or level history to files or logs, and has no
network permission. Android and the device audio stack remain separate custody
boundaries; this probe does not establish their internal retention behavior.

## Controls and limits

The activity starts with the microphone off. **Allow microphone** invokes Android's
normal permission prompt; granting it does not start capture. **Test for 5 seconds**
starts only while the activity is resumed, permission is granted, the device is
unlocked and Android reports the microphone unmuted. **Stop**, leaving the activity,
or the time limit releases capture. Resume never restarts automatically. Permission,
lock and mute are rechecked during the loop; read failures stop without retry.
Physical mute routing still needs a separate attended check on the actual hardware.

A large dark panel shows a green level meter and its percentage. The logarithmic
display maps -80 to 0 dBFS to 0-100%; this is a display scale, not calibrated sound
pressure or recognition confidence. The meter aggregates samples between UI updates;
empty nonblocking reads cannot erase a populated window. After completion, it keeps
the peak visible with an explicit microphone-off label. The text also reports the
loudest RMS block in dBFS. Nonzero input can be noise and does not prove intelligible
speech, correct distance response or recognition quality.

The app calls only
[`SpeechRecognizer.isRecognitionAvailable`](https://developer.android.com/reference/android/speech/SpeechRecognizer#isRecognitionAvailable(android.content.Context))
to check for an installed recognition service. It declares the Android 11 service
visibility query but never creates a recognizer or invokes a third-party service.
A present service would not establish offline ability.

## Build and attended run

Use JDK21 and Android SDK platform/build-tools 37 as for the existing timer probe.
The package deliberately targets Android 11/API 30 and requires API 24 or later;
this does not qualify newer Android lifecycle rules. Choose a fresh output outside
the checkout; APKs and disposable signing material stay outside Git.

```powershell
./scripts/build-android-microphone-probe.ps1 -OutputDirectory <new-external-directory> -Sdk <android-sdk> -Jdk <jdk21>
```

Select the authorized device explicitly if multiple devices are connected. Verify
the package is absent rather than overwriting someone else's probe. Install and
open it; the attended tester must use its buttons and Android's permission prompt.
Use made-up speech; do not record household audio or publish raw device diagnostics.

```text
adb -s <selected-device> install <new-external-directory>/probe.apk
adb -s <selected-device> shell am start -W -n io.github.f2illc.lunaos.home.micprobe/.MicrophoneProbe
adb -s <selected-device> logcat -d -s HomeMicProbe:I *:S
adb -s <selected-device> shell cmd appops get io.github.f2illc.lunaos.home.micprobe RECORD_AUDIO
adb -s <selected-device> uninstall io.github.f2illc.lunaos.home.micprobe
```

The scoped tag logs fixed capability/state outcomes only. Do not collect general
logs or screenshots into source, issues or CI artifacts. Test permission denial,
Stop during capture, leaving during capture, revocation, mute and lock separately;
successful normal expiry cannot establish those cases. Stop and uninstall when
the attended test is complete; do not change system mute, security or power policy.

## November 1 observation

Target: converted Echo Show 8, Android 11/API 30, ARM32. The app built and passed
APK signature verification, installed and launched. The tester granted permission
through Android and started bounded captures. The sanitized state tag reported
16 kHz mono PCM16 capture and nonzero samples. AppOps showed bounded microphone
use ending after approximately five seconds. An initial platform progress bar was
not visible to the tester; the explicit high-contrast replacement was built,
installed and confirmed visible by the tester. No speech
content, exact amplitude or physical device identifier is published here.

The recognition-service query returned absent. Backgrounding and reopening after
a completed test did not add a capture-start event. Pressing Test without
permission produced a permission-required result without capture. A final run
emitted an early-stop event; the triggering control was not independently isolated.
Package removal was verified
after the final attended test. These observations qualify only finite foreground
audio input and the visible meter. Permission denial/revocation, lock/mute during
capture, Stop during capture, competing apps, echo, other sample rates, real
screen off, a foreground service, reboot and resource budgets remain unverified.
No offline engine has been adopted, and #136/#137 remain incomplete.
