package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.SystemClock;
import android.view.KeyEvent;

/**
 * Hands one media key press to the Spotify app and to nothing else. No Spotify developer app,
 * sign-in or token is involved, and nothing is launched. Home can ask; it cannot hear Spotify obey.
 */
final class MusicPlayer {
    private MusicPlayer() {}
    static final class Outcome {
        final boolean sent;
        final String status;
        private Outcome(boolean sent, String status) { this.sent = sent; this.status = status; }
    }

    private static boolean installed(Context context) {
        try {
            ApplicationInfo info = context.getPackageManager().getApplicationInfo(MusicControl.SPOTIFY, 0);
            return info != null && info.enabled;
        } catch (PackageManager.NameNotFoundException | RuntimeException absent) {
            return false;
        }
    }

    static Outcome send(Context context, int action) {
        // An action that is not one of the four is never looked up or sent.
        if (!MusicCommand.valid(action)) return new Outcome(false, MusicControl.plan(action, false).status);
        MusicControl.Plan plan = MusicControl.plan(action, installed(context));
        if (!plan.sends()) return new Outcome(false, plan.status);
        try {
            long now = SystemClock.uptimeMillis();
            for (int press : new int[] {KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP}) {
                context.sendBroadcast(new Intent(Intent.ACTION_MEDIA_BUTTON).setPackage(plan.target)
                    .addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
                    .putExtra(Intent.EXTRA_KEY_EVENT, new KeyEvent(now, now, press, plan.key, 0)));
            }
        } catch (RuntimeException refused) {
            return new Outcome(false, MusicControl.undelivered());
        }
        return new Outcome(true, plan.status);
    }
}
