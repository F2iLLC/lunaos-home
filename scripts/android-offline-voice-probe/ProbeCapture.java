package io.github.f2illc.lunaos.home.voiceprobe;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.Model;
import org.vosk.Recognizer;
import com.sun.jna.NativeLibrary;

/** Shared capture worker. Owners stop it and independently gate effects. */
final class ProbeCapture {
    private static final AtomicBoolean BUSY = new AtomicBoolean();
    private static final AtomicBoolean RECORDING = new AtomicBoolean();
    static boolean busy() { return BUSY.get(); }
    static boolean recording() { return RECORDING.get(); }
    interface Listener {
        void visual(LunaFace.State state);
        void status(String text);
        void finished(String code, String text, int seconds, long deadline, boolean canceled);
    }
    private final Context context;
    private final boolean capture, wait, persistent;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final long maximum;
    private volatile long deadline;
    private volatile boolean closed, canceled;
    private volatile boolean awake;
    private volatile String commandDiagnostic = "NO_FINAL_RESULT";
    private volatile String watchdogCode, watchdogMessage;
    private AudioRecord recorder;
    private ToneGenerator cue;
    private final Runnable watchdog = new Runnable() {
        @Override public void run() {
            if (closed) return;
            boolean accessLost = blocked(context);
            if (accessLost || SystemClock.elapsedRealtime() >= deadline) {
                String code = accessLost ? "ACCESS_STOP" : awake ? "COMMAND_WINDOW_EXPIRED" : "LISTENING_DEADLINE";
                watchdogCode = code;
                watchdogMessage = accessLost ? "Listening stopped: lock, mute or permission change. Microphone off."
                    : timeoutMessage();
                stop();
                listener.visual(accessLost ? LunaFace.State.OFF : LunaFace.State.RETRY);
                listener.status(watchdogMessage);
                Log.i("HomeVoiceProbe", code);
            } else main.postDelayed(this, 100);
        }
    };
    ProbeCapture(Context context, boolean capture, boolean wait, Listener listener) {
        this(context, capture, wait, false, listener);
    }
    ProbeCapture(Context context, boolean capture, boolean wait, boolean persistent, Listener listener) {
        this.context = context.getApplicationContext();
        this.capture = capture; this.wait = wait; this.persistent = persistent && capture && wait; this.listener = listener;
        maximum = this.persistent ? Long.MAX_VALUE : SystemClock.elapsedRealtime() + (wait ? WakeSession.WAIT_MS : 30000);
        deadline = maximum;
    }
    static boolean blocked(Context context) {
        return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
            || ((KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE)).isDeviceLocked()
            || ((AudioManager) context.getSystemService(Context.AUDIO_SERVICE)).isMicrophoneMute();
    }
    boolean start() {
        if (!BUSY.compareAndSet(false, true)) return false;
        if (capture) main.post(watchdog);
        new Thread(this::recognize, "home-voice-probe").start();
        return true;
    }
    void stop() { canceled = true; closeRecorder(); main.removeCallbacks(watchdog); }
    private String timeoutMessage() {
        return awake ? "Command timed out after Hey Luna. Decoder: " + commandDiagnostic + ". Microphone off. No timer started."
            : "Listening time limit reached. Microphone off. No timer started.";
    }
    private synchronized void closeRecorder() {
        closed = true;
        RECORDING.set(false);
        closeCue();
        if (recorder == null) return;
        try { if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) recorder.stop(); }
        catch (RuntimeException ignored) { }
        finally { recorder.release(); recorder = null; }
    }
    private synchronized void closeCue() {
        if (cue == null) return;
        try { cue.stopTone(); } catch (RuntimeException ignored) { }
        finally { try { cue.release(); } catch (RuntimeException ignored) { } cue = null; }
    }
    private synchronized void wakeCue() {
        if (closed || blocked(context) || SystemClock.elapsedRealtime() >= deadline) return;
        try {
            cue = new ToneGenerator(AudioManager.STREAM_MUSIC, 12);
            boolean requested = cue.startTone(ToneGenerator.TONE_PROP_BEEP, 90);
            Log.i("HomeVoiceProbe", requested ? "WAKE_CUE_REQUESTED" : "WAKE_CUE_UNAVAILABLE");
            main.postDelayed(this::closeCue, 150);
        } catch (RuntimeException failure) {
            closeCue(); Log.i("HomeVoiceProbe", "WAKE_CUE_UNAVAILABLE");
        }
    }
    private void show(String text, LunaFace.State state) {
        main.post(() -> { if (!canceled && !closed) { listener.visual(state); listener.status(text); } });
    }
    private void copyAsset(String asset, File destination) throws Exception {
        String[] children = context.getAssets().list(asset);
        if (children.length > 0) {
            if (!destination.isDirectory() && !destination.mkdirs()) throw new IllegalStateException();
            for (String child : children) copyAsset(asset + "/" + child, new File(destination, child));
        } else {
            try (InputStream in = context.getAssets().open(asset); FileOutputStream out = new FileOutputStream(destination)) {
                byte[] buffer = new byte[65536];
                int count;
                while (!closed && (count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                if (closed) throw new IllegalStateException();
            }
        }
    }
    private void recognize() {
        short[] samples = new short[1600];
        CaptureTiming timing = new CaptureTiming();
        boolean questions = persistent && QuestionReply.enabled(context);
        String code = "ENGINE_UNAVAILABLE", message = "Offline engine could not start. No timer started.", phase = "NATIVE_LOAD";
        int matched = 0;
        try {
            LibVosk.vosk_set_log_level(-1);
            phase = "MODEL_COPY";
            File modelDir = new File(context.getFilesDir(), "model");
            File ready = new File(context.getFilesDir(), "model-ready");
            if (!ready.exists()) { copyAsset("model", modelDir); if (!ready.createNewFile()) throw new IllegalStateException(); }
            if (closed || (capture && blocked(context))) return;
            phase = "MODEL_LOAD";
            try (Model model = new Model(modelDir.getAbsolutePath())) {
                phase = "VOCABULARY_CHECK";
                int word = NativeLibrary.getInstance("vosk").getFunction("vosk_model_find_word")
                    .invokeInt(new Object[] { model.getPointer(), "luna" });
                if (word < 0) { code = "WAKE_WORD_OUT_OF_VOCABULARY"; message = "Model lacks Luna. Microphone off."; return; }
                try (Recognizer recognizer = new Recognizer(model, 16000, wait ? WakeSession.grammar() : TimerPhrase.grammar());
                     // Keep wake recognition constrained, but let local ASR hear natural command phrasing.
                     // TimerCommand.parse remains the strict allowlist before any native timer dispatch.
                     Recognizer command = wait ? new Recognizer(model, 16000) : null) {
                    if (!capture) { code = "ENGINE_READY_NO_CAPTURE"; message = "Offline engine ready. Microphone stayed off."; return; }
                    phase = "CAPTURE";
                    int size = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                    if (size <= 0) throw new IllegalStateException();
                    synchronized (this) {
                        if (closed || blocked(context) || SystemClock.elapsedRealtime() >= deadline) return;
                        recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, 16000, AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT, Math.max(size, 6400));
                        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException();
                        recorder.startRecording();
                        if (recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException();
                        timing.start(recorder.getBufferSizeInFrames(), wait ? "WAKE" : "COMMAND");
                        RECORDING.set(true);
                    }
                    WakeSession wake = wait ? new WakeSession(SystemClock.elapsedRealtime(), persistent) : null;
                    Log.i("HomeVoiceProbe", wait ? "WAITING_FOR_WAKE" : "LISTENING");
                    show(wait ? "MICROPHONE ON locally. Waiting for Hey Luna" + (persistent ? " until disabled." : " (up to 5 minutes).") + " Pause after the wake phrase."
                        : "MICROPHONE ON. Say: Hey Luna, set a timer for ten seconds.",
                        wait ? LunaFace.State.WAITING : LunaFace.State.AWAKE);
                    code = "NO_COMPLETE_COMMAND"; message = "Test ended without a complete command. No timer started.";
                    while (!closed && SystemClock.elapsedRealtime() < deadline) {
                        if (blocked(context)) { code = "ACCESS_STOP"; message = "Lock, mute or permission changed. No timer started."; return; }
                        int count;
                        synchronized (this) {
                            if (closed) return;
                            count = recorder.read(samples, 0, samples.length, AudioRecord.READ_NON_BLOCKING);
                        }
                        if (count < 0) throw new IllegalStateException();
                        Recognizer current = wake != null && wake.awaitingCommand() ? command : recognizer;
                        long decodeStarted = SystemClock.elapsedRealtime();
                        boolean complete = count > 0 && current.acceptWaveForm(samples, count);
                        timing.decoded(count, SystemClock.elapsedRealtime() - decodeStarted);
                        Arrays.fill(samples, (short) 0);
                        if (complete && !closed && SystemClock.elapsedRealtime() < deadline) {
                            String text = new JSONObject(current.getResult()).optString("text", "");
                            int seconds = wake != null ? wake.acceptFinal(text, SystemClock.elapsedRealtime()) : TimerPhrase.seconds(text);
                            if (seconds == WakeSession.WAKE) {
                                timing.report();
                                timing.start(timing.bufferFrames, "COMMAND");
                                deadline = Math.min(maximum, wake.deadline());
                                awake = true;
                                Log.i("HomeVoiceProbe", "WAKE_MATCH");
                                show(questions ? "Awake. MICROPHONE ON. Ask a question or say a timer command within 15 seconds."
                                    : "Awake. MICROPHONE ON. Say: Set a timer for five seconds. You have 15 seconds.", LunaFace.State.AWAKE);
                                main.post(this::wakeCue);
                            } else if (TimerCommand.valid(seconds)) {
                                matched = seconds; code = "COMMAND_MATCH";
                                message = "Supported timer command recognized. Microphone closing.";
                                return;
                            } else if (questions && wake != null && wake.awaitingCommand() && QuestionPolicy.accepts(text)) {
                                code = "QUESTION_FINAL"; message = text; return;
                            } else if (wake != null && wake.awaitingCommand()) {
                                String diagnostic = TimerPhrase.commandDetail(text);
                                if (!"NO_SPEECH".equals(diagnostic) || "NO_FINAL_RESULT".equals(commandDiagnostic))
                                    commandDiagnostic = diagnostic;
                                Log.i("HomeVoiceProbe", "COMMAND_FINAL_" + diagnostic);
                                show("Awake. Decoder: " + commandDiagnostic + ". No supported timer yet. MICROPHONE ON until the command deadline.", LunaFace.State.AWAKE);
                            }
                        }
                        SystemClock.sleep(10);
                    }
                    if (!closed && SystemClock.elapsedRealtime() >= deadline) {
                        code = awake ? "COMMAND_WINDOW_EXPIRED" : "LISTENING_DEADLINE";
                        message = timeoutMessage();
                    }
                }
            }
        } catch (Exception | LinkageError failure) {
            code = phase + "_FAILED"; message = "Offline engine failed at " + phase + ". No timer started.";
        } finally {
            timing.report();
            closeRecorder(); Arrays.fill(samples, (short) 0);
            String resultCode = watchdogCode != null ? watchdogCode : code;
            String resultMessage = watchdogMessage != null ? watchdogMessage : message; int seconds = matched;
            main.post(() -> {
                main.removeCallbacks(watchdog);
                BUSY.set(false);
                if (!canceled) Log.i("HomeVoiceProbe", resultCode);
                listener.finished(resultCode, resultMessage, seconds, deadline, canceled);
            });
        }
    }

    // Numeric capture diagnostics only: never audio, recognition text or private config.
    // A decode call longer than the recorder buffer can starve this single-threaded
    // capture loop. These measurements identify that risk without claiming data loss.
    private static final class CaptureTiming {
        int bufferFrames;
        long started, lastObserved, frames, maxDecodeMs, slowDecodeCalls;
        String phase;
        void start(int bufferFrames, String phase) {
            this.bufferFrames = bufferFrames;
            this.phase = phase;
            started = lastObserved = SystemClock.elapsedRealtime();
            frames = maxDecodeMs = slowDecodeCalls = 0;
        }
        void decoded(int count, long elapsedMs) {
            if (phase == null) return;
            lastObserved = SystemClock.elapsedRealtime();
            if (count <= 0) return;
            frames += count;
            maxDecodeMs = Math.max(maxDecodeMs, elapsedMs);
            if (elapsedMs * 16 > bufferFrames) slowDecodeCalls++;
        }
        void report() {
            if (phase == null) return;
            Log.i("HomeVoiceProbe", "CAPTURE_TIMING phase=" + phase
                + " bufferMs=" + bufferFrames / 16 + " audioMs=" + frames / 16
                + " elapsedMs=" + (lastObserved - started)
                + " maxDecodeMs=" + maxDecodeMs + " slowDecodeCalls=" + slowDecodeCalls);
            phase = null;
        }
    }
}
