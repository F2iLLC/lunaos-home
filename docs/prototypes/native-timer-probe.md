# Converted Android native timer probe

This attended feasibility probe sends one 15-second timer request to the installed
`com.android.deskclock` app. It does not implement Home timers, GUI/MCP integration,
speech recognition or wake detection. It uses Android's documented
[`ACTION_SET_TIMER` intent](https://developer.android.com/reference/android/provider/AlarmClock#ACTION_SET_TIMER)
and declares `com.android.alarm.permission.SET_ALARM`. An ADB shell launch of that
intent was denied on the test ROM because shell lacks that permission.

The test app has no microphone, network, storage or notification permission. It
records a private one-shot attempt flag before dispatch and refuses automatic
retries, including activity recreation. The flag uses synchronous persistence;
failure prevents dispatch. It is a probe guard, not an idempotency contract for
Clock. Android's intent does not return a timer ID, saved-state confirmation or
alert-delivery receipt. `INTENT_DISPATCHED_ALERT_UNVERIFIED` means only dispatch.
The app deliberately targets API 30 for the selected Android 11 device; it does
not qualify later Android lifecycle behavior.

## Build and attended run

Use the existing JDK21 and Android SDK setup, including platform/build-tools 37.
The builder derives from Home's existing Android vault probe builder and adds no
dependencies or imported enterprise code. Choose a new output directory outside
the checkout. APKs and disposable development signing material remain there.

```powershell
./scripts/build-android-timer-probe.ps1 -OutputDirectory <new-external-directory> -Sdk <android-sdk> -Jdk <jdk21>
```

Select the authorized device explicitly with `adb -s <selected-device>` when more
than one is connected. Before installing, verify the probe package is absent and
the user is ready to hear a short timer. Do not uninstall or overwrite an existing
probe to bypass its attempt guard without a deliberate fresh-test decision.

```text
adb -s <selected-device> install <new-external-directory>/probe.apk
adb -s <selected-device> shell input keyevent KEYCODE_WAKEUP
adb -s <selected-device> shell am start -W -n io.github.f2illc.lunaos.home.timerprobe/.TimerProbe
adb -s <selected-device> shell input keyevent KEYCODE_SLEEP
adb -s <selected-device> shell dumpsys power
adb -s <selected-device> logcat -d -s HomeTimerProbe:I *:S
```

The app launches Clock from its resumed activity. Do not retry automatically if
ADB reports an activity wait timeout: the intent may already have been dispatched.
Check the probe's sanitized tag and observe Clock. Keep raw device diagnostics
outside source control and public evidence; publish only necessary booleans,
component names, OS/build versions and observed outcomes.

Record native expiry and audio-focus evidence separately from whether the human
heard the alert. Verify display state rather than assuming a sleep key means OFF;
dozing or a dark-looking screensaver does not establish that. Stop the test alert
using Clock's visible control. Uninstall the probe afterward:

```text
adb -s <selected-device> uninstall io.github.f2illc.lunaos.home.timerprobe
```

Uninstalling the probe does not cancel a timer owned by Clock. Do not clear Clock
data, change volume/security/power policy or cancel unrelated household timers.

## November 1 feasibility observation

Selected device: converted Echo Show 8, Android 11/API 30, reported ABI
`armeabi-v7a,armeabi`. Clock version 11/versionCode 30 resolved the native timer
action. Hardware feature reporting advertised microphone and audio output; this
does not verify actual microphone capture.

The isolated app compiled, packaged and passed APK signature verification. A
single installed launch emitted `INTENT_DISPATCHED_ALERT_UNVERIFIED`. ADB's activity
wait timed out after about ten seconds; no automatic retry was made. The later
Clock activity was `.timer.ExpiredTimersActivity`, and audio diagnostics mentioned
Clock as an audio-focus client. No Clock crash appeared in the recent crash buffer.
These observations establish dispatch and native expiry, not audible sound.

After `KEYCODE_SLEEP`, power diagnostics reported `Dozing` with display `ON`;
after expiry they reported `Awake` with display `ON`. The screen-off condition
therefore did not pass. Audible output requires the attended user's separate
observation. Restart/reboot, security lock, cancellation races, duration accuracy,
offline cold start, resource use and wake recognition were not tested. This is
partial feasibility evidence for #136/#149, not completion or supported delivery.

A second activity launch emitted `ALREADY_ATTEMPTED_NO_RETRY`; the scoped probe log
still contained exactly one dispatch event. The test app was then uninstalled and
package absence verified. Clock owns the expired timer independently; removing
the probe does not dismiss its alert. Audible confirmation and visible dismissal
remain attended checks.
