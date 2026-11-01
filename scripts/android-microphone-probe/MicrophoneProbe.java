package io.github.f2illc.lunaos.home.micprobe;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.pm.PackageManager;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.SystemClock;
import android.speech.SpeechRecognizer;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.Arrays;

/** Foreground, attended five-second level check. No files or recognition calls. */
public final class MicrophoneProbe extends Activity {
    private TextView status;
    private LevelMeter level;
    private Run active;
    private boolean resumed;
    private boolean workerBusy;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(32, 24, 32, 24);
        TextView explanation = new TextView(this);
        explanation.setText("Home microphone test\n\nTap Allow microphone, then allow access in Android. "
            + "Tap Test for 5 seconds and say a few made-up words. Watch the sound meter. "
            + "Nothing is saved, transcribed or sent anywhere. Leaving this screen stops the test.\n");
        layout.addView(explanation);
        boolean recognizer = SpeechRecognizer.isRecognitionAvailable(this);
        TextView capabilities = new TextView(this);
        capabilities.setText("Installed speech service: " + (recognizer ? "present (offline ability untested)" : "none") + "\n");
        layout.addView(capabilities);
        Log.i("HomeMicProbe", recognizer ? "RECOGNIZER_PRESENT_OFFLINE_UNVERIFIED" : "RECOGNIZER_ABSENT");
        Button allow = new Button(this);
        allow.setText("Allow microphone");
        allow.setOnClickListener(view -> {
            stopRun();
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                status.setText("Permission allowed. Tap Test for 5 seconds when ready.");
            } else {
                requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, 1);
            }
        });
        layout.addView(allow);
        Button test = new Button(this);
        test.setText("Test for 5 seconds");
        test.setOnClickListener(view -> startRun());
        layout.addView(test);
        Button stop = new Button(this);
        stop.setText("Stop");
        stop.setOnClickListener(view -> { stopRun(); status.setText("Stopped. Microphone released."); });
        layout.addView(stop);
        level = new LevelMeter(this);
        layout.addView(level, new LinearLayout.LayoutParams(-1, (int) (120 * getResources().getDisplayMetrics().density)));
        status = new TextView(this);
        status.setText("Microphone off. No test starts automatically.");
        layout.addView(status);
        setContentView(layout);
    }

    @Override public void onResume() { super.onResume(); resumed = true; }
    @Override public void onPause() {
        resumed = false;
        stopRun();
        status.setText("Stopped because this screen was left. Tap Test to start again.");
        super.onPause();
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != 1) return;
        boolean granted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        status.setText(granted ? "Permission allowed. Tap Test for 5 seconds when ready."
            : "Microphone denied. No audio captured. You can allow it later in Android settings.");
        Log.i("HomeMicProbe", granted ? "PERMISSION_ALLOWED_NO_CAPTURE" : "PERMISSION_DENIED_NO_CAPTURE");
    }

    private void stopRun() {
        Run previous = active;
        active = null;
        if (previous != null) {
            previous.close();
            Log.i("HomeMicProbe", "CAPTURE_STOPPED");
        }
        level.showLevel(0, "Microphone off");
    }

    private void startRun() {
        if (!resumed || workerBusy) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            status.setText("Allow microphone access first. No audio captured.");
            Log.i("HomeMicProbe", "PERMISSION_REQUIRED_NO_CAPTURE");
            return;
        }
        KeyguardManager keyguard = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        AudioManager audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (keyguard.isDeviceLocked() || audio.isMicrophoneMute()) {
            status.setText("Device locked or microphone muted. No test started.");
            Log.i("HomeMicProbe", "LOCKED_OR_MUTED_NO_CAPTURE");
            return;
        }
        Run run = new Run();
        active = run;
        workerBusy = true;
        status.setText("Listening for 5 seconds. Say a few made-up words and watch the meter.");
        new Thread(() -> capture(run), "home-mic-probe").start();
    }

    private void capture(Run run) {
        short[] samples = new short[1600];
        String outcome = "CAPTURE_UNAVAILABLE";
        String message = "Microphone could not be opened at 16 kHz mono. No automatic retry.";
        boolean received = false;
        boolean nonzero = false;
        double loudestDb = -100;
        double windowDb = -100;
        try {
            int size = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (size <= 0) throw new IllegalStateException();
            synchronized (run) {
                if (run.closed) return;
                run.recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, 16000,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(size, 6400));
                if (run.recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException();
                run.recorder.startRecording();
                if (run.recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException();
            }
            Log.i("HomeMicProbe", "CAPTURE_STARTED_16KHZ_MONO_PCM16");
            long end = SystemClock.elapsedRealtime() + 5000;
            long nextUi = 0;
            while (SystemClock.elapsedRealtime() < end) {
                int count;
                if (((KeyguardManager) getSystemService(KEYGUARD_SERVICE)).isDeviceLocked()
                    || ((AudioManager) getSystemService(AUDIO_SERVICE)).isMicrophoneMute()
                    || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    outcome = "CAPTURE_LOCK_MUTE_OR_PERMISSION_STOP";
                    message = "Stopped because the device locked, microphone muted or permission changed.";
                    return;
                }
                synchronized (run) {
                    if (run.closed) return;
                    count = run.recorder.read(samples, 0, samples.length, AudioRecord.READ_NON_BLOCKING);
                }
                if (count < 0) throw new IllegalStateException();
                double sum = 0;
                for (int i = 0; i < count; i++) {
                    double value = samples[i];
                    sum += value * value;
                    nonzero |= samples[i] != 0;
                }
                received |= count > 0;
                // A logarithmic scale makes quiet signals visible. Empty polling
                // reads must not overwrite a populated window with a zero bar.
                double db = count == 0 || sum == 0 ? -100 : 20 * Math.log10(Math.sqrt(sum / count) / 32768);
                loudestDb = Math.max(loudestDb, db);
                windowDb = Math.max(windowDb, db);
                Arrays.fill(samples, (short) 0);
                if (SystemClock.elapsedRealtime() >= nextUi) {
                    nextUi = SystemClock.elapsedRealtime() + 100;
                    final int meter = (int) Math.max(0, Math.min(100, (windowDb + 80) * 100 / 80));
                    windowDb = -100;
                    runOnUiThread(() -> { if (active == run && resumed) level.showLevel(meter, "Live sound level"); });
                }
                SystemClock.sleep(10);
            }
            outcome = !received ? "CAPTURE_NO_SAMPLES" : nonzero ? "CAPTURE_NONZERO_PCM" : "CAPTURE_ZERO_PCM";
            message = !received ? "No samples received. Microphone availability is unverified."
                : nonzero ? "Test ended. Audio samples received. Loudest level: " + Math.round(loudestDb)
                    + " dBFS (closer to 0 is louder). Did the meter react to your voice? Nonzero samples alone do not prove voice capture."
                : "Test ended. Only silent samples received; check microphone mute and routing.";
        } catch (RuntimeException failure) {
            // Do not log exception messages, captured samples or content.
        } finally {
            run.close();
            Arrays.fill(samples, (short) 0);
            final String result = outcome;
            final String text = message;
            final int peak = (int) Math.max(0, Math.min(100, (loudestDb + 80) * 100 / 80));
            runOnUiThread(() -> {
                workerBusy = false;
                if (active == run && resumed) {
                    active = null;
                    level.showLevel(peak, "Test ended - peak level (mic off)");
                    status.setText(text + " Microphone off.");
                    Log.i("HomeMicProbe", result);
                }
            });
        }
    }

    /** Explicit size/colors; keep the last peak visible after the short run. */
    private static final class LevelMeter extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private int percent;
        private String label = "Microphone off";
        LevelMeter(Context context) { super(context); }
        void showLevel(int value, String text) {
            percent = value;
            label = text;
            setContentDescription(text + ": " + value + " percent");
            invalidate();
        }
        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float scale = getResources().getDisplayMetrics().density;
            canvas.drawColor(Color.rgb(18, 24, 30));
            paint.setColor(Color.WHITE);
            paint.setTextSize(18 * scale);
            canvas.drawText(label + ": " + percent + "%", 12 * scale, 30 * scale, paint);
            float left = 12 * scale;
            float right = getWidth() - left;
            paint.setColor(Color.rgb(90, 100, 112));
            canvas.drawRect(left, 48 * scale, right, 96 * scale, paint);
            paint.setColor(Color.rgb(56, 230, 155));
            canvas.drawRect(left, 48 * scale, left + (right - left) * percent / 100, 96 * scale, paint);
        }
    }

    private static final class Run {
        AudioRecord recorder;
        boolean closed;
        synchronized void close() {
            closed = true;
            if (recorder == null) return;
            try {
                if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) recorder.stop();
            } catch (RuntimeException ignored) {
            } finally {
                recorder.release();
                recorder = null;
            }
        }
    }
}
