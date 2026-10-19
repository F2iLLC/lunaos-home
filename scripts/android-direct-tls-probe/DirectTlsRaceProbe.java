package io.github.f2illc.lunaos.directtlsprobe;

import android.app.*;
import android.content.Intent;
import android.os.*;
import android.view.*;
import android.widget.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Holds real TLS construction to check End cannot strand a stale connection pointer. */
public final class DirectTlsRaceProbe extends Instrumentation {
    private Activity activity;
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    private TextView find(View root, String text) {
        if (root instanceof TextView && text.contentEquals(((TextView) root).getText())) return (TextView) root;
        if (root instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) root).getChildCount(); i++) {
            TextView found = find(((ViewGroup) root).getChildAt(i), text); if (found != null) return found;
        }
        return null;
    }
    private void tap(String text) {
        runOnMainSync(() -> {
            TextView view = find(activity.getWindow().getDecorView(), text);
            if (!(view instanceof Button) || !view.isEnabled() || !view.performClick()) throw new AssertionError("Button unavailable");
        });
    }
    private void awaitText(String text) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 15000;
        while (SystemClock.elapsedRealtime() < deadline) {
            AtomicBoolean found = new AtomicBoolean();
            runOnMainSync(() -> found.set(find(activity.getWindow().getDecorView(), text) != null));
            if (found.get()) return; Thread.sleep(100);
        }
        throw new AssertionError("Expected state did not appear");
    }
    @Override public void onStart() {
        Bundle result = new Bundle(); int code = 0;
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        try {
            if (!"ranchu".equals(Build.HARDWARE)) throw new AssertionError("Dedicated emulator only");
            Intent intent = new Intent(getTargetContext(), PairingActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity = startActivitySync(intent);
            SyntheticTlsClient.constructionCheckpoint = () -> {
                entered.countDown();
                try { if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Barrier timeout"); }
                catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException("Barrier interrupted"); }
            };
            tap("Approve fictional computer"); tap("Connect to test computer");
            if (!entered.await(10, TimeUnit.SECONDS)) throw new AssertionError("Constructor barrier not reached");
            tap("End connection"); awaitText("No record shown.");
            SyntheticTlsClient.constructionCheckpoint = null; release.countDown();
            tap("Connect to test computer"); awaitText("Connected. Review and allow the selected read.");
            tap("Allow selected read"); tap("Read Alex's record"); awaitText("Library visit: Monday");
            tap("End connection"); awaitText("No record shown.");
            result.putString("result", "PASS: End during held real TLS construction leaves no stale connection; fresh pairing, explicit read approval and Monday read succeed."); code = -1;
        } catch (Throwable error) { result.putString("result", "FAIL: constructor cancellation check (" + error.getClass().getSimpleName() + ")"); }
        finally {
            SyntheticTlsClient.constructionCheckpoint = null; release.countDown();
            if (activity != null) runOnMainSync(() -> activity.finish());
        }
        finish(code, result);
    }
}
