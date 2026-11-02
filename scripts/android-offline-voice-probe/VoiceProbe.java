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
import android.graphics.Color;
import android.content.res.Configuration;
import android.content.res.ColorStateList;

/** Explicit controls for wake-word listening and attended foreground tests. */
public final class VoiceProbe extends Activity {
    private TextView status;
    private LunaFace face;
    private ProbeCapture capture;
    private boolean resumed;
    private boolean backgroundView;
    private long generation;
    private CheckBox realTimers;
    private LinearLayout timerList;
    private String timerSnapshot = "";
    private String lastTimerStatus;
    private final Handler handler = new Handler();
    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            refreshTimers();
            if (capture == null && backgroundView) {
                status.setText(BackgroundWakeService.latest);
                face.setState(BackgroundWakeService.visual);
            }
            handler.postDelayed(this, 200);
        }
    };
    private void button(LinearLayout layout, String label, Runnable action) {
        Button button = new Button(this); button.setText(label);
        button.setOnClickListener(v -> action.run()); layout.addView(button);
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(17, 20, 38));
        getWindow().setNavigationBarColor(Color.rgb(17, 20, 38));
        LinearLayout root = new LinearLayout(this);
        boolean landscape = getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
        root.setOrientation(landscape ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(17, 20, 38));
        face = new LunaFace(this);
        root.addView(face, landscape ? new LinearLayout.LayoutParams(0, -1, 1.35f)
            : new LinearLayout.LayoutParams(-1, 0, 1.2f));
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL); layout.setPadding(32, 24, 32, 24);
        TextView intro = new TextView(this);
        intro.setTextColor(Color.rgb(215, 211, 234));
        intro.setText("Luna · wake-word listening\nSay Hey Luna, wait for the bright eyes or wake cue, then speak. Keep this screen open to see Luna.\n"
            + "Enable once to keep listening until disabled. Local audio is not saved. Lock, mute or permission loss disables listening. Android stopping the app requires enabling again.\n"
            + "Luna starts timers hands-free. Say set a timer for five seconds, cancel the timer, or add one minute to the timer. With multiple timers, say timer one or timer two. Listening resumes after the spoken reply and continues during countdowns. Disable stops listening, not timers.");
        intro.setTextSize(18); layout.addView(intro);
        CheckBox questions = new CheckBox(this);
        questions.setTextColor(Color.WHITE);
        questions.setButtonTintList(ColorStateList.valueOf(Color.rgb(129, 245, 214)));
        questions.setBackgroundColor(Color.rgb(39, 48, 68));
        questions.setPadding(20, 16, 20, 16);
        questions.setMinHeight(72);
        questions.setTextSize(18);
        questions.setText("Answer questions online: share post-wake question text with OpenAI and reply text with ElevenLabs. Requires the computer relay and USB. No conversation history. AI can make mistakes.");
        questions.setChecked(QuestionReply.enabled(this));
        questions.setOnCheckedChangeListener((view, checked) -> {
            stopAll();
            boolean saved = getSharedPreferences(QuestionReply.PREFERENCES, MODE_PRIVATE).edit()
                .putBoolean(QuestionReply.ENABLED, checked).commit();
            status.setText(saved ? "Listening off. Enable wake-word listening when ready. Online answers require the configured relay."
                : "Could not save question setting. Listening remains off.");
        });
        status = new TextView(this); status.setTextSize(22);
        status.setTextColor(Color.WHITE);
        status.setText("Microphone off. Nothing starts automatically."); layout.addView(status);
        layout.addView(questions);
        button(layout, "Allow microphone", () -> {
            stopAll();
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
                status.setText("Permission allowed. Enable wake-word listening when ready.");
            else requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, 1);
        });
        button(layout, "Enable wake-word listening", () -> {
            if (!resumed || ProbeCapture.busy() || BackgroundWakeService.running) {
                status.setText("Stop and wait for the previous worker to finish first."); return;
            }
            if (ProbeCapture.blocked(this)) { status.setText("Allow microphone, unlock and unmute first."); return; }
            lastTimerStatus = null;
            backgroundView = true;
            BackgroundWakeService.revoke(this);
            face.setState(LunaFace.State.PREPARING);
            try {
                startForegroundService(new Intent(this, BackgroundWakeService.class).setAction(BackgroundWakeService.START));
                status.setText("Starting wake-word listening. Wait for Waiting before leaving this screen.");
            } catch (RuntimeException failure) {
                face.setState(LunaFace.State.OFF);
                status.setText("Background start unavailable. Microphone off.");
            }
        });
        button(layout, "Disable listening", () -> {
            stopAll(); status.setText("Listening stopped. Microphone off. Existing timers keep running; use their Cancel buttons below.");
        });
        timerList = new LinearLayout(this); timerList.setOrientation(LinearLayout.VERTICAL); layout.addView(timerList);
        realTimers = new CheckBox(this);
        realTimers.setTextColor(Color.WHITE);
        realTimers.setButtonTintList(ColorStateList.valueOf(Color.rgb(129, 245, 214)));
        realTimers.setBackgroundColor(Color.rgb(39, 48, 68));
        realTimers.setPadding(20, 16, 20, 16);
        realTimers.setMinHeight(72);
        realTimers.setTextSize(18);
        realTimers.setText("Start real timers for foreground tests only (may sound)");
        realTimers.setChecked(false); realTimers.setSaveEnabled(false);
        realTimers.setOnCheckedChangeListener((button, checked) -> {
            stopAll(); status.setText(checked ? "Foreground real timers enabled. Choose a foreground test."
                : "Foreground recognition only. No timer will start automatically.");
        }); layout.addView(realTimers);
        button(layout, "Foreground: 30-second voice test", () -> startRun(true, false));
        button(layout, "Foreground: wake listening for 5 minutes", () -> startRun(true, true));
        button(layout, "Check offline engine (microphone off)", () -> startRun(false, false));
        ScrollView scroll = new ScrollView(this); scroll.addView(layout);
        root.addView(scroll, landscape ? new LinearLayout.LayoutParams(0, -1, 1)
            : new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
    }
    @Override public void onResume() {
        super.onResume(); resumed = true;
        face.setActive(true);
        if (BackgroundWakeService.running) backgroundView = true;
        handler.post(refresh);
    }
    @Override public void onPause() {
        resumed = false; handler.removeCallbacks(refresh); stopForegroundRun();
        face.setActive(false);
        if (!BackgroundWakeService.running)
            face.setState(LunaFace.State.OFF);
        if (!BackgroundWakeService.running) status.setText(lastTimerStatus != null ? lastTimerStatus : "Microphone off. Choose a test to start again.");
        super.onPause();
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 1) status.setText(checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            ? "Permission allowed. Enable wake-word listening when ready." : "Permission denied. No audio captured.");
    }
    private void stopForegroundRun() {
        generation++;
        if (capture != null) capture.stop();
        capture = null;
    }
    private void stopAll() {
        stopForegroundRun(); BackgroundWakeService.revoke(this); lastTimerStatus = null; backgroundView = false;
        face.setState(LunaFace.State.OFF);
    }
    private void startRun(boolean audio, boolean wait) {
        if (!resumed || ProbeCapture.busy() || BackgroundWakeService.running) return;
        if (audio && ProbeCapture.blocked(this)) { status.setText("Allow microphone, unlock and unmute first."); return; }
        BackgroundWakeService.revoke(this); lastTimerStatus = null; backgroundView = false;
        final long id = ++generation;
        final TimerHandoffGate handoff = new TimerHandoffGate(audio && realTimers.isChecked());
        capture = new ProbeCapture(this, audio, wait, new ProbeCapture.Listener() {
            @Override public void visual(LunaFace.State state) {
                if (resumed && generation == id) face.setState(state);
            }
            @Override public void status(String text) {
                if (resumed && generation == id) status.setText(text);
            }
            @Override public void finished(String code, String text, int seconds, long deadline, boolean canceled) {
                if (generation != id) return;
                capture = null;
                if (!resumed) return;
                status.setText(text + " Microphone off.");
                if (!canceled) face.setState(audio
                    ? seconds > 0 ? LunaFace.State.REVIEW : LunaFace.State.RETRY : LunaFace.State.OFF);
                if (!canceled && handoff.claim(realTimers.isChecked(), !ProbeCapture.blocked(VoiceProbe.this)
                        && SystemClock.elapsedRealtime() < deadline, seconds)) dispatchTimer(seconds);
            }
        });
        status.setText("Loading offline model. Microphone off; please wait.");
        face.setState(LunaFace.State.PREPARING);
        if (!capture.start()) {
            capture = null; face.setState(LunaFace.State.OFF);
            status.setText("Previous worker still closing. Microphone off.");
        }
    }
    private void dispatchTimer(int seconds) {
        Intent timer = new Intent(AlarmClock.ACTION_SET_TIMER)
            .setPackage("com.android.deskclock")
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            .putExtra(AlarmClock.EXTRA_MESSAGE, "Home voice timer")
            .putExtra(AlarmClock.EXTRA_SKIP_UI, false);
        try {
            if (timer.resolveActivity(getPackageManager()) == null) {
                status.setText("Clock unavailable. No timer request sent. " + listeningStatus());
                Log.i("HomeVoiceProbe", "CLOCK_UNAVAILABLE_NO_DISPATCH");
                return;
            }
            lastTimerStatus = "Requested " + seconds + " seconds in Clock. Check its countdown. "
                + (BackgroundWakeService.running ? "Wake-word listening remains enabled. " : "Microphone off. ") + "No automatic timer retry.";
            status.setText(lastTimerStatus);
            startActivity(timer);
            // Dispatch is not a persistence receipt or proof that an alert will sound.
            Log.i("HomeVoiceProbe", "TIMER_INTENT_DISPATCHED_ALERT_UNVERIFIED");
        } catch (RuntimeException failure) {
            lastTimerStatus = "Clock handoff failed or is uncertain. Check Clock before retrying. " + listeningStatus();
            status.setText(lastTimerStatus);
            Log.i("HomeVoiceProbe", "TIMER_DISPATCH_UNCERTAIN_NO_RETRY");
        }
    }

    private void refreshTimers() {
        TimerLedger ledger = NativeTimers.read(this);
        long now = SystemClock.elapsedRealtime();
        StringBuilder snapshot = new StringBuilder();
        for (int id = 1; id <= TimerLedger.LIMIT; id++) if (ledger.deadlines[id] > 0)
            snapshot.append(id).append(':').append(Math.max(0, (ledger.deadlines[id] - now + 999) / 1000)).append(';');
        if (snapshot.toString().equals(timerSnapshot)) return;
        timerSnapshot = snapshot.toString(); timerList.removeAllViews();
        for (int id = 1; id <= TimerLedger.LIMIT; id++) if (ledger.deadlines[id] > 0) {
            final int target = id;
            long remaining = Math.max(0, (ledger.deadlines[id] - now + 999) / 1000);
            TextView label = new TextView(this); label.setTextColor(Color.WHITE); label.setTextSize(26);
            label.setText("Timer " + id + (remaining == 0 ? " · TIME IS UP" : " · " + remaining / 60 + ":" + String.format(java.util.Locale.US, "%02d", remaining % 60)));
            timerList.addView(label);
            button(timerList, "Cancel timer " + id, () -> {
                try { status.setText(NativeTimers.execute(this, TimerCommand.cancel(target))); }
                catch (RuntimeException failure) { status.setText("Cancellation uncertain. Check the timer list."); }
                refreshTimers();
            });
        }
    }

    private String listeningStatus() {
        return BackgroundWakeService.running ? "Wake-word listening remains enabled." : "Microphone off.";
    }

}
