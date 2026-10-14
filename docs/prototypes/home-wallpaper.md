# Home wallpaper

Open **Wallpaper** at the top of Home, then select **Luna Aurora** or **Quiet twilight**. Selection immediately changes the Home background. The picker supports touch and keyboard radio controls; Escape closes it and returns focus to its button. The supplied Aurora PNG is bundled locally, and no network image is requested.

The app remembers only the selected built-in wallpaper name in WebView/browser local storage (`luna-home-wallpaper-v1`). This cosmetic preference is separate from fictional drafts and checklist items, which remain temporary. An unknown saved value falls back to Quiet twilight. If storage is unavailable, Home still works and explains that the selection lasts only for the visit. This preference is not vault storage and does not establish any encrypted-data or backup guarantees.

The setting changes the Home interface, including its checklist and draft screens. It does not change Android's launcher wallpaper, security lock, or the separate [clock screensaver](resting-screen.md). There is no arbitrary image-file picker or device-settings permission.

## Show update and acceptance

This change builds on the existing Android resting-screen branch so an update can retain the installed clock screensaver and software-rendering profile. Follow the [Android build guide](android.md) using the ARMv7 software-rendering configuration and the same debug signing identity. An APK build or source PR is not installation or visual acceptance. The device coordinator retains the installation/testing ownership described in the [resting-screen handoff](resting-screen.md#activation-and-reversible-test).

After an authorized update, open Home, select Luna Aurora and confirm its rendered background. Close and reopen Home to check the choice remains. Select Quiet twilight to verify reversal, then restore the user's selection. Check the Show's 1280 × 800 layout and a narrow mobile layout, text legibility, and that the clock screensaver remains unchanged. Do not uninstall, clear app data, or change unrelated settings to make a test pass.

Source and bundled asset hashes can verify that the exact supplied image is included; they cannot establish that it is selected or displayed on the physical Show. Record those results separately.
