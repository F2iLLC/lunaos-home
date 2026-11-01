package io.github.f2illc.lunaos.home.voiceprobe;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.SystemClock;
import android.provider.AlarmClock;
import android.util.Log;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ScrollView;

/** Explicit controls for attended foreground and finite background feasibility tests. */
public final class VoiceProbe extends Activity {
    private TextView status;
    private ProbeCapture capture;
    private boolean resumed;
    private boolean backgroundView;
    private long generation;
    private CheckBox realTimers;
    private Button review;
    private String lastTimerStatus;
    private final Handler handler = new Handler();
    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            int seconds = BackgroundWakeService.pendingSeconds(VoiceProbe.this);
            review.setEnabled(seconds > 0 && capture == null && !ProbeCapture.busy());
            if (capture == null && backgroundView) status.setText(BackgroundWakeService.latest);
            handler.postDelayed(this, 200);
        }
    };
    private void button(LinearLayout layout, String label, Runnable action) {
        Button button = new Button(this); button.setText(label);
        button.setOnClickListener(v -> action.run()); layout.addView(button);
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL); layout.setPadding(32, 24, 32, 24);
        TextView intro = new TextView(this);
        intro.setText("Home background wake test\nEnable below, wait for Waiting, then press Home or turn off the display. Say Hey Luna, pause 3 seconds, then Set a timer for ten seconds.\n"
            + "Local audio is not saved. Five-minute limit. Security lock stops listening. Background recognition needs a tap to start Clock. Stop does not cancel existing Clock timers.");
        intro.setTextSize(18); layout.addView(intro);
        status = new TextView(this); status.setTextSize(22);
        status.setText("Microphone off. Nothing starts automatically."); layout.addView(status);
        button(layout, "Allow microphone", () -> {
            stopAll();
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
                status.setText("Permission allowed. Choose a test below.");
            else requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, 1);
        });
        button(layout, "Enable background wake test for 5 minutes", () -> {
            if (!resumed || ProbeCapture.busy() || BackgroundWakeService.running) {
                status.setText("Stop and wait for the previous worker to finish first."); return;
            }
            if (ProbeCapture.blocked(this)) { status.setText("Allow microphone, unlock and unmute first."); return; }
            lastTimerStatus = null;
            backgroundView = true;
            BackgroundWakeService.revoke(this);
            try {
                startForegroundService(new Intent(this, BackgroundWakeService.class).setAction(BackgroundWakeService.START));
                status.setText("Starting background test. Wait for Waiting before leaving this screen.");
            } catch (RuntimeException failure) { status.setText("Background start unavailable. Microphone off."); }
        });
        button(layout, "Stop / discard recognized request", () -> {
            stopAll(); status.setText("Listening stopped. Microphone off. Existing timers remain in Clock.");
        });
        review = new Button(this); review.setText("Start recognized timer in Clock (may sound)"); review.setEnabled(false);
        review.setOnClickListener(v -> {
            if (!resumed || capture != null || ProbeCapture.busy()) return;
            int seconds = BackgroundWakeService.claim(this);
            BackgroundWakeService.revoke(this); review.setEnabled(false);
            backgroundView = false;
            if (seconds > 0) dispatchTimer(seconds);
            else status.setText("Request unavailable or expired. Microphone off. No timer started.");
        }); layout.addView(review);
        realTimers = new CheckBox(this);
        realTimers.setText("Start real timers for foreground tests only (may sound)");
        realTimers.setChecked(false); realTimers.setSaveEnabled(false);
        realTimers.setOnCheckedChangeListener((button, checked) -> {
            stopAll(); status.setText(checked ? "Foreground real timers enabled. Choose a foreground test."
                : "Foreground recognition only. No timer will start automatically.");
        }); layout.addView(realTimers);
        button(layout, "Foreground: 30-second voice test", () -> startRun(true, false));
        button(layout, "Foreground: wake listening for 5 minutes", () -> startRun(true, true));
        button(layout, "Check offline engine (microphone off)", () -> startRun(false, false));
        ScrollView scroll = new ScrollView(this); scroll.addView(layout); setContentView(scroll);
    }
    @Override public void onResume() {
        super.onResume(); resumed = true;
        if (BackgroundWakeService.running || BackgroundWakeService.pendingSeconds(this) > 0) backgroundView = true;
        handler.post(refresh);
    }
    @Override public void onPause() {
        resumed = false; handler.removeCallbacks(refresh); stopForegroundRun();
        if (!BackgroundWakeService.running) status.setText(lastTimerStatus != null ? lastTimerStatus : "Microphone off. Choose a test to start again.");
        super.onPause();
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 1) status.setText(checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            ? "Permission allowed. Choose a test below." : "Permission denied. No audio captured.");
    }
    private void stopForegroundRun() {
        generation++;
        if (capture != null) capture.stop();
        capture = null;
    }
    private void stopAll() {
        stopForegroundRun(); BackgroundWakeService.revoke(this); lastTimerStatus = null; backgroundView = false;
    }
    private void startRun(boolean audio, boolean wait) {
        if (!resumed || ProbeCapture.busy() || BackgroundWakeService.running) return;
        if (audio && ProbeCapture.blocked(this)) { status.setText("Allow microphone, unlock and unmute first."); return; }
        BackgroundWakeService.revoke(this); lastTimerStatus = null; backgroundView = false;
        final long id = ++generation;
        final TimerHandoffGate handoff = new TimerHandoffGate(audio && realTimers.isChecked());
        capture = new ProbeCapture(this, audio, wait, new ProbeCapture.Listener() {
            @Override public void status(String text) {
                if (resumed && generation == id) status.setText(text);
            }
            @Override public void finished(String code, String text, int seconds, long deadline, boolean canceled) {
                if (generation != id) return;
                capture = null;
                if (!resumed) return;
                status.setText(text + " Microphone off.");
                if (!canceled && handoff.claim(realTimers.isChecked(), !ProbeCapture.blocked(VoiceProbe.this)
                        && SystemClock.elapsedRealtime() < deadline, seconds)) dispatchTimer(seconds);
            }
        });
        status.setText("Loading offline model. Microphone off; please wait.");
        if (!capture.start()) { capture = null; status.setText("Previous worker still closing. Microphone off."); }
    }
    private void dispatchTimer(int seconds) {
        Intent timer = new Intent(AlarmClock.ACTION_SET_TIMER)
            .setPackage("com.android.deskclock")
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            .putExtra(AlarmClock.EXTRA_MESSAGE, "Home voice timer")
            .putExtra(AlarmClock.EXTRA_SKIP_UI, false);
        try {
            if (timer.resolveActivity(getPackageManager()) == null) {
                status.setText("Clock unavailable. Microphone off. No timer request sent.");
                Log.i("HomeVoiceProbe", "CLOCK_UNAVAILABLE_NO_DISPATCH");
                return;
            }
            lastTimerStatus = "Requested " + seconds + " seconds in Clock. Check its countdown. Microphone off. No automatic retry.";
            status.setText(lastTimerStatus);
            startActivity(timer);
            // Dispatch is not a persistence receipt or proof that an alert will sound.
            Log.i("HomeVoiceProbe", "TIMER_INTENT_DISPATCHED_ALERT_UNVERIFIED");
        } catch (RuntimeException failure) {
            lastTimerStatus = "Clock handoff failed or is uncertain. Check Clock before retrying. Microphone off.";
            status.setText(lastTimerStatus);
            Log.i("HomeVoiceProbe", "TIMER_DISPATCH_UNCERTAIN_NO_RETRY");
        }
    }

}
