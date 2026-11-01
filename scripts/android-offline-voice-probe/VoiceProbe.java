package io.github.f2illc.lunaos.home.voiceprobe;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.AlarmClock;
import android.util.Log;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ScrollView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Arrays;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.Model;
import org.vosk.Recognizer;
import com.sun.jna.NativeLibrary;

/** Attended foreground probe with optional, explicitly enabled native Clock handoff. */
public final class VoiceProbe extends Activity {
    private TextView status;
    private Run active;
    private boolean resumed;
    private boolean workerBusy;
    private CheckBox realTimers;
    private String lastTimerStatus;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(32, 24, 32, 24);
        TextView intro = new TextView(this);
        intro.setText("Home wake waiting test\nSay Hey Luna, pause for Awake, then say Set a timer for ten seconds.\n"
            + "Keep this screen open. Audio stays local and is not saved. Stop ends listening; cancel timers in Clock.");
        intro.setTextSize(18);
        layout.addView(intro);
        status = new TextView(this);
        status.setTextSize(22);
        status.setText("Microphone off. Nothing starts automatically.");
        layout.addView(status);
        Button allow = new Button(this);
        allow.setText("Allow microphone");
        allow.setOnClickListener(v -> {
            stopRun();
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
                status.setText("Permission allowed. Tap Start when ready.");
            else requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, 1);
        });
        layout.addView(allow);
        Button check = new Button(this);
        check.setText("Check offline engine (microphone off)");
        check.setOnClickListener(v -> startRun(false));
        layout.addView(check);
        realTimers = new CheckBox(this);
        realTimers.setText("Start real timers in Clock (may sound)");
        realTimers.setChecked(false);
        realTimers.setSaveEnabled(false);
        realTimers.setOnCheckedChangeListener((button, checked) -> {
            stopRun();
            status.setText(checked ? "Real timers enabled for this screen. Tap Start, then say the full phrase."
                : "Recognition only. No timer will start. Tap Start to test.");
        });
        layout.addView(realTimers);
        Button start = new Button(this);
        start.setText("Start 30-second voice test");
        start.setOnClickListener(v -> startRun(true));
        layout.addView(start);
        Button wait = new Button(this);
        wait.setText("Enable local wake listening for 5 minutes");
        wait.setOnClickListener(v -> startRun(true, true));
        layout.addView(wait);
        Button stop = new Button(this);
        stop.setText("Stop");
        stop.setOnClickListener(v -> { stopRun(); status.setText("Listening stopped. Microphone off. Existing timers remain in Clock."); });
        layout.addView(stop);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(layout);
        setContentView(scroll);
    }
    @Override public void onResume() { super.onResume(); resumed = true; }
    @Override public void onPause() {
        resumed = false;
        stopRun();
        status.setText(lastTimerStatus != null ? lastTimerStatus
            : "Stopped after leaving this screen. Tap Start to try again.");
        super.onPause();
    }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == 1) status.setText(checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            ? "Permission allowed. Tap Start when ready." : "Permission denied. No audio captured.");
    }
    private void stopRun() {
        Run old = active;
        active = null;
        if (old != null) {
            if (old.watchdog != null) handler.removeCallbacks(old.watchdog);
            old.close();
            Log.i("HomeVoiceProbe", "STOP_REQUESTED");
        }
    }
    private boolean blocked() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
            || ((KeyguardManager) getSystemService(KEYGUARD_SERVICE)).isDeviceLocked()
            || ((AudioManager) getSystemService(AUDIO_SERVICE)).isMicrophoneMute();
    }
    private void startRun(boolean capture) {
        startRun(capture, false);
    }
    private void startRun(boolean capture, boolean waitForWake) {
        if (!resumed || workerBusy) return;
        if (capture && blocked()) { status.setText("Allow the microphone, unlock the device and unmute before starting."); return; }
        lastTimerStatus = null;
        Run run = new Run(capture && realTimers.isChecked(), waitForWake); active = run; workerBusy = true;
        status.setText("Loading offline model. Microphone off; please wait.");
        new Thread(() -> recognize(run, capture), "home-voice-probe").start();
    }
    private void show(Run run, String text) {
        runOnUiThread(() -> { if (resumed && active == run) status.setText(text); });
    }
    private void watch(Run run) {
        run.watchdog = () -> {
            if (active != run || !resumed) return;
            if (blocked() || SystemClock.elapsedRealtime() >= run.deadline) {
                stopRun();
                status.setText("Listening ended: time limit, lock, mute or permission change. Microphone off. No timer started.");
                Log.i("HomeVoiceProbe", "DEADLINE_OR_ACCESS_STOP");
            } else handler.postDelayed(run.watchdog, 100);
        };
        handler.post(run.watchdog);
    }
    private void copyAsset(String asset, File destination) throws Exception {
        String[] children = getAssets().list(asset);
        if (children.length > 0) {
            if (!destination.isDirectory() && !destination.mkdirs()) throw new IllegalStateException();
            for (String child : children) copyAsset(asset + "/" + child, new File(destination, child));
        } else {
            try (InputStream in = getAssets().open(asset); FileOutputStream out = new FileOutputStream(destination)) {
                byte[] buffer = new byte[65536];
                int count;
                while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            }
        }
    }
    private void recognize(Run run, boolean capture) {
        short[] samples = new short[1600];
        String outcome = "ENGINE_UNAVAILABLE";
        String message = "Offline engine could not start. No timer started.";
        String phase = "NATIVE_LOAD";
        int matchedSeconds = 0;
        try {
            LibVosk.vosk_set_log_level(-1);
            phase = "MODEL_COPY";
            File modelDir = new File(getFilesDir(), "model");
            File ready = new File(getFilesDir(), "model-ready");
            if (!ready.exists()) { copyAsset("model", modelDir); if (!ready.createNewFile()) throw new IllegalStateException(); }
            if (run.closed || (capture && blocked())) return;
            phase = "MODEL_LOAD";
            try (Model model = new Model(modelDir.getAbsolutePath())) {
                // Do not silently drop an unavailable wake word from the grammar.
                phase = "VOCABULARY_CHECK";
                int word = NativeLibrary.getInstance("vosk").getFunction("vosk_model_find_word")
                    .invokeInt(new Object[] { model.getPointer(), "luna" });
                if (word < 0) {
                    outcome = "WAKE_WORD_OUT_OF_VOCABULARY";
                    message = "This model does not contain Luna. Microphone stayed off. Another model is needed.";
                    return;
                }
                try (Recognizer recognizer = new Recognizer(model, 16000,
                        run.waitForWake ? WakeSession.grammar() : TimerPhrase.grammar());
                     Recognizer commandRecognizer = run.waitForWake
                        ? new Recognizer(model, 16000, TimerPhrase.commandGrammar()) : null) {
                    if (!capture) {
                        outcome = "ENGINE_READY_NO_CAPTURE";
                        message = "Offline engine and Luna vocabulary ready. Microphone stayed off. Tap Start for speech testing.";
                        return;
                    }
                    phase = "CAPTURE";
                    int size = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                    if (size <= 0) throw new IllegalStateException();
                    synchronized (run) {
                        if (run.closed || blocked()) return;
                        run.recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, 16000,
                            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(size, 6400));
                        if (run.recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException();
                        run.recorder.startRecording();
                        if (run.recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException();
                    }
                    long started = SystemClock.elapsedRealtime();
                    WakeSession wake = run.waitForWake ? new WakeSession(started) : null;
                    run.deadline = wake != null ? wake.deadline() : started + 30000;
                    // UI watchdog releases capture even if native decoding is pending.
                    runOnUiThread(() -> { if (active == run && resumed) watch(run); });
                    Log.i("HomeVoiceProbe", run.waitForWake ? "WAITING_FOR_WAKE" : "LISTENING");
                    show(run, run.waitForWake
                        ? "MICROPHONE ON locally. Waiting for Hey Luna (up to 5 minutes). Pause after the wake phrase."
                        : "MICROPHONE ON. Say: Hey Luna, set a timer for ten seconds.");
                    outcome = "NO_COMPLETE_COMMAND";
                    message = "Test ended without a complete matching command. No timer started.";
                    while (!run.closed && SystemClock.elapsedRealtime() < run.deadline) {
                        if (blocked()) { outcome = "ACCESS_STOP"; message = "Stopped: lock, mute or permission changed."; return; }
                        int count;
                        synchronized (run) {
                            if (run.closed) return;
                            count = run.recorder.read(samples, 0, samples.length, AudioRecord.READ_NON_BLOCKING);
                        }
                        if (count < 0) throw new IllegalStateException();
                        Recognizer current = wake != null && wake.awaitingCommand() ? commandRecognizer : recognizer;
                        boolean complete = count > 0 && current.acceptWaveForm(samples, count);
                        Arrays.fill(samples, (short) 0);
                        if (complete) {
                            String text = new JSONObject(current.getResult()).optString("text", "");
                            int seconds = wake != null ? wake.acceptFinal(text, SystemClock.elapsedRealtime()) : TimerPhrase.seconds(text);
                            if (seconds == WakeSession.WAKE) {
                                run.deadline = wake.deadline();
                                Log.i("HomeVoiceProbe", "WAKE_MATCH");
                                show(run, "Awake. MICROPHONE ON. Say: Set a timer for ten seconds. You have 10 seconds.");
                                continue;
                            }
                            if (seconds > 0) {
                                matchedSeconds = seconds;
                                outcome = "COMMAND_MATCH";
                                message = "Recognized duration: " + seconds + " seconds. NO timer started.";
                                return;
                            }
                            if (wake == null) show(run, "No complete match yet. Try the whole phrase again; pause afterward.");
                        }
                        SystemClock.sleep(10);
                    }
                }
            }
        } catch (Exception | LinkageError failure) {
            // Never log exception text, samples or recognition text.
            outcome = phase + "_FAILED";
            message = "Offline engine failed at " + phase + " (" + failure.getClass().getSimpleName() + "). No timer started.";
        } finally {
            run.close(); Arrays.fill(samples, (short) 0);
            final String code = outcome;
            final String result = message;
            final int duration = matchedSeconds;
            runOnUiThread(() -> {
                if (run.watchdog != null) handler.removeCallbacks(run.watchdog);
                workerBusy = false;
                if (active == run && resumed) {
                    active = null;
                    status.setText(result + (result.contains("Microphone off") ? "" : " Microphone off."));
                    Log.i("HomeVoiceProbe", code);
                    boolean allowed = resumed && !blocked() && SystemClock.elapsedRealtime() < run.deadline;
                    if (run.handoff.claim(realTimers.isChecked(), allowed, duration)) dispatchTimer(duration);
                }
            });
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
    private static final class Run {
        final TimerHandoffGate handoff;
        final boolean waitForWake;
        volatile long deadline;
        Runnable watchdog;
        Run(boolean realTimers, boolean waitForWake) {
            handoff = new TimerHandoffGate(realTimers);
            this.waitForWake = waitForWake;
        }
        volatile boolean closed;
        AudioRecord recorder;
        synchronized void close() {
            closed = true;
            if (recorder == null) return;
            try { if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) recorder.stop(); }
            catch (RuntimeException ignored) { }
            finally { recorder.release(); recorder = null; }
        }
    }
}
