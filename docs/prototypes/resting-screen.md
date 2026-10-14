# Android resting screen

Home includes an optional Android screensaver with a large clock and the generic greeting **Rest easy.** over a still twilight, moon and stars scene. No date, checklist, household information, account, network request or integration is added to this screen. The new Java/XML source and vector artwork are authored for Home; no new dependency or external asset is imported.

## Integration and boundaries

This uses Android's [DreamService](https://developer.android.com/reference/android/service/dreams/DreamService), selected by the user in system screensaver settings. It does not replace the security lock, launcher or wallpaper. It does not select itself, change idle timeouts, start at boot, request overlay/device-admin privileges, dismiss keyguard or change any system setting. Automatic start depends on the ROM exposing and supporting screensavers while charging/docked. Installing the APK alone does not activate it.

Tapping anywhere opens Home when Android reports the device is unlocked, then ends the screensaver. If locked, or lock status cannot be read, the tap only ends the screensaver: unlock normally and open Home. If the ROM refuses the activity launch, the screensaver exits and Home remains available from its launcher icon. A race with locking still relies on Android's normal activity/keyguard boundary; Home is not configured to display over the lock. Do not treat this resting screen as authentication or vault protection.

The service is exported for the system picker but protected by `android.permission.BIND_DREAM_SERVICE`; the app does not request that permission. It creates a native layout, not another WebView. [TextClock](https://developer.android.com/reference/android/widget/TextClock) displays local device time using its 12/24-hour preference, with no seconds. It updates while visible through the platform lifecycle. The layout draws in software; no animation loop, custom wake lock, brightness override, always-on policy or background network work is added. Screen dimming remains under Android. This limits additional work but is not a measured battery, heat, long-term display-retention or performance guarantee.

## Build and preview

Follow the [Android setup](android.md) first. The normal preparation step copies tracked Java/XML resources into the generated Android app and registers the service. It rejects modified/duplicate managed declarations rather than silently weakening the service permission. Generated platform files stay untracked.

For the ARM32 device that required the rendering workaround:

```powershell
npm test
npm run native:android -- build --debug --target armv7 --apk --ci --config src-tauri/tauri.software-rendering.conf.json
```

Keep the same existing signing identity and `.debug` package for an update. Inspect the final APK for `armeabi-v7a`, MainActivity hardware acceleration disabled, the protected dream service, no Internet permission, backup disabled, cleartext disabled and a valid matching signature. Do not publish generated binaries or signing material. Public redistribution notices remain a separate gate.

Generate a reviewable SVG using the actual Android background paths/colors:

```powershell
node scripts/preview-resting.mjs <local-output-file.svg>
```

The preview uses an example time and approximate text layout/font. It is a design preview, not an Android screenshot or proof of physical rendering.

## Activation and reversible test

The device coordinator owns installation and testing. This implementation task must not operate a physical device or emulator.

1. Verify the provided APK checksum, ARM32 architecture, package and matching certificate. Select only the previously identified physical device. Install as an update; do not uninstall or clear app data as a workaround.
2. Open Home and confirm the existing welcome/checklist still works. The earlier software-profile build survived more than 30 seconds on Android 11 and the owner reported those screens looked fine; that is limited prior evidence, not a test of this new feature or completion of Session 1.
3. With the user's selection, open Android **Settings → Display → Advanced → Screen saver** (wording may differ). Choose **Luna OS Home**, choose the available charging/docked condition, then **Start now/Preview**. If this ROM does not expose the picker or cannot start the dream, record that gap. Do not force secure-setting values, replace the ROM, or disable the lock.
4. Confirm only the clock, greeting and artwork appear. Check minute rollover, device time-zone changes, and both 12/24-hour modes using only authorized settings changes, restoring the original choices afterward. Check clock legibility at 1280 × 800 and the user's normal dimming level. Verify touch and accessibility activation.
5. Tap while unlocked: Home should open without a crash and the resting screen should end. Test entry/exit twice, idle activation, background/resume, and screen-off behavior. Record any ROM launch restriction; a successful launch command alone is insufficient evidence.
6. If a security lock already exists, confirm a locked-device tap does not bypass it or reveal Home. Never remove a lock to make this test pass. Without an existing lock, record the lock check as untested instead of changing security settings.
7. To undo activation, return to Screen saver settings and choose the previous saver or **Off/Never**. Home remains installed. Power/lock behavior stays governed by Android.

## Verification status

The device coordinator reports that the ARMv7 software build at `b89469e` installed successfully on the Android 11 Show, retained the same Home process for more than 30 seconds, and appeared in Android's screensaver picker. The user selected Luna OS Home, while charging, and Start now, then confirmed the preview rendered and approved its appearance. This is limited user-observed preview evidence, not a test of minute rollover, tap navigation, automatic idle activation, security-lock handling or resource use; those checks remain pending.

Local JavaScript tests cover repeated preparation, exact resource installation, service permission integrity, malformed declarations, profile switching and existing application behavior. Android build/packaged-manifest/signature results belong in the review PR and local artifact handoff. Hosted Actions remains disabled. This feature does not complete native assistant integration, encrypted storage or the other vault-session gates. A separate [wake-word design note](../architecture/android-wake-word.md) records possible future activation work; the resting screen has no microphone or voice capability.
