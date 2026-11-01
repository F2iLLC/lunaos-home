package io.github.f2illc.lunaos.home.voiceprobe;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Arrays;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.Model;
import org.vosk.Recognizer;
import com.sun.jna.NativeLibrary;

/** Attended foreground probe. No network, audio files, transcript logs or alarms. */
public final class VoiceProbe extends Activity {
    private TextView status;
    private Run active;
    private boolean resumed;
    private boolean workerBusy;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(32, 24, 32, 24);
        TextView intro = new TextView(this);
        intro.setText("Home offline voice test\n\nAllow the microphone, then tap Start. After it says Listening, say:\n"
            + "Hey Luna, set a timer for ten seconds.\n\n"
            + "Recognition test only: NO timer or alarm will start. Audio stays on this device and is not saved. "
            + "Listening ends after 30 seconds or when you leave. Keep this screen open.\n");
        intro.setTextSize(20);
        layout.addView(intro);
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
        Button start = new Button(this);
        start.setText("Start 30-second voice test");
        start.setOnClickListener(v -> startRun(true));
        layout.addView(start);
        Button stop = new Button(this);
        stop.setText("Stop");
        stop.setOnClickListener(v -> { stopRun(); status.setText("Stopped. Microphone off. No timer started."); });
        layout.addView(stop);
        status = new TextView(this);
        status.setTextSize(24);
        status.setText("Microphone off. Nothing starts automatically.");
        layout.addView(status);
        setContentView(layout);
    }
    @Override public void onResume() { super.onResume(); resumed = true; }
    @Override public void onPause() {
        resumed = false;
        stopRun();
        status.setText("Stopped after leaving this screen. Tap Start to try again.");
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
        if (old != null) { old.close(); Log.i("HomeVoiceProbe", "STOP_REQUESTED"); }
    }
    private boolean blocked() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
            || ((KeyguardManager) getSystemService(KEYGUARD_SERVICE)).isDeviceLocked()
            || ((AudioManager) getSystemService(AUDIO_SERVICE)).isMicrophoneMute();
    }
    private void startRun(boolean capture) {
        if (!resumed || workerBusy) return;
        if (capture && blocked()) { status.setText("Allow the microphone, unlock the device and unmute before starting."); return; }
        Run run = new Run(); active = run; workerBusy = true;
        status.setText("Loading offline model. Microphone off; please wait.");
        new Thread(() -> recognize(run, capture), "home-voice-probe").start();
    }
    private void show(Run run, String text) {
        runOnUiThread(() -> { if (resumed && active == run) status.setText(text); });
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
                try (Recognizer recognizer = new Recognizer(model, 16000, TimerPhrase.grammar())) {
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
                    Log.i("HomeVoiceProbe", "LISTENING");
                    // Release capture on the UI clock even if a native decode takes longer.
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        if (active == run) {
                            stopRun();
                            status.setText("30-second test ended. Microphone off. No timer started.");
                            Log.i("HomeVoiceProbe", "DEADLINE_STOP");
                        }
                    }, 30000);
                    show(run, "Listening. Say: Hey Luna, set a timer for ten seconds.");
                    long end = SystemClock.elapsedRealtime() + 30000;
                    outcome = "NO_COMPLETE_COMMAND";
                    message = "Test ended without a complete matching command. No timer started.";
                    while (!run.closed && SystemClock.elapsedRealtime() < end) {
                        if (blocked()) { outcome = "ACCESS_STOP"; message = "Stopped: lock, mute or permission changed."; return; }
                        int count;
                        synchronized (run) {
                            if (run.closed) return;
                            count = run.recorder.read(samples, 0, samples.length, AudioRecord.READ_NON_BLOCKING);
                        }
                        if (count < 0) throw new IllegalStateException();
                        boolean complete = count > 0 && recognizer.acceptWaveForm(samples, count);
                        Arrays.fill(samples, (short) 0);
                        if (complete) {
                            String text = new JSONObject(recognizer.getResult()).optString("text", "");
                            int seconds = TimerPhrase.seconds(text);
                            if (seconds > 0) {
                                outcome = "COMMAND_MATCH";
                                message = "Recognized duration: " + seconds + " seconds. Microphone off. NO timer started.";
                                return;
                            }
                            show(run, "No complete match yet. Try the whole phrase again; pause afterward.");
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
            runOnUiThread(() -> {
                workerBusy = false;
                if (active == run && resumed) {
                    active = null; status.setText(result + " Microphone off.");
                    Log.i("HomeVoiceProbe", code);
                }
            });
        }
    }
    private static final class Run {
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
