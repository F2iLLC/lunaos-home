package io.github.f2illc.lunaos.home.preview;

import android.app.KeyguardManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.service.dreams.DreamService;
import android.view.View;
import android.widget.TextClock;

/** A user-selected Android screensaver, independent of the Home WebView. */
public final class RestingDreamService extends DreamService {
    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(true);
        setFullscreen(true);
        setScreenBright(false);
        setContentView(R.layout.resting_screen);
        View screen = findViewById(R.id.resting_screen);
        // Keep this simple native view on software drawing too. No WebView,
        // animation loop, brightness override, wake lock, or household data.
        screen.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        TextClock clock = findViewById(R.id.resting_clock);
        // TextClock follows the system time zone and 12/24-hour choice, and
        // updates by the minute while visible (the formats omit seconds).
        screen.addOnLayoutChangeListener((view, l, t, r, b, ol, ot, or, ob) -> {
            float scale = Math.min((r - l) / 1280f, (b - t) / 800f);
            clock.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, 144 * scale);
        });
        screen.setOnClickListener(view -> openHome());
    }

    private void openHome() {
        KeyguardManager keyguard = getSystemService(KeyguardManager.class);
        // Fail closed if lock state is unavailable. Never dismiss keyguard or
        // show Home over it. A locked-device tap only exits the screensaver.
        if (keyguard == null || keyguard.isKeyguardLocked()) {
            finish();
            return;
        }
        Intent home = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            startActivity(home);
        } catch (ActivityNotFoundException | SecurityException unavailable) {
            // System policy may disallow launching an activity from a dream.
            // End normally; the user can still open Home from the launcher.
        } finally {
            finish();
        }
    }
}
