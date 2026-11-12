package io.github.f2illc.lunaos.home.voiceprobe;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.*;
import android.os.*;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

/** Microphone transport only. All speech recognition runs on the enrolled Mac. */
final class ProbeCapture {
    private static final AtomicBoolean BUSY = new AtomicBoolean(), RECORDING = new AtomicBoolean();
    interface Listener {
        void visual(LunaFace.State state); void status(String text);
        default void wake(String assistant) {}
        default void transcript(String text, boolean isFinal) {}
        default void speechActive() {}
        void finished(String code, String text, int seconds, long deadline, boolean canceled);
    }
    private final Context context;
    private final Listener listener;
    private final boolean followUp;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean closed;
    private AudioRecord recorder;
    ProbeCapture(Context c, boolean capture, boolean wait, boolean persistent, boolean followUp, Listener listener) {
        if (!capture || !wait || !persistent) throw new IllegalArgumentException();
        context = c.getApplicationContext(); this.followUp = followUp; this.listener = listener;
    }
    ProbeCapture(Context c, boolean capture, boolean wait, boolean persistent, Listener listener) {
        this(c, capture, wait, persistent, false, listener);
    }
    static boolean recording() { return RECORDING.get(); }
    static boolean busy() { return BUSY.get(); }
    static void releaseEngine() { /* No model or recognizer on this device. */ }
    static boolean blocked(Context c) {
        return c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
            || ((KeyguardManager)c.getSystemService(Context.KEYGUARD_SERVICE)).isDeviceLocked()
            || ((AudioManager)c.getSystemService(Context.AUDIO_SERVICE)).isMicrophoneMute();
    }
    boolean start() {
        if (!BUSY.compareAndSet(false, true)) return false;
        new Thread(this::run, "home-mac-speech").start(); return true;
    }
    synchronized void stop() { closed = true; closeRecorder(); }
    private synchronized void closeRecorder() {
        RECORDING.set(false);
        if (recorder != null) { try { recorder.stop(); } catch (RuntimeException ignored) {} recorder.release(); recorder = null; }
    }
    private void show(String text, LunaFace.State state) {
        main.post(() -> { if (!closed) { listener.visual(state); listener.status(text); } });
    }
    // Energy detection only: bounded speech segments, no vocabulary or model.
    private byte[] capture(long until, boolean awake) throws Exception {
        short[] samples = new short[1600], audio = new short[400000], lead = new short[4800];
        int used = 0, leadAt = 0, leadCount = 0, quiet = 0; boolean speech = false;
        try {
            synchronized (this) {
                if (closed || blocked(context)) return null;
                int minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (minimum <= 0) throw new IllegalStateException();
                recorder = new AudioRecord(MediaRecorder.AudioSource.MIC,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(minimum,12800));
                if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException();
                recorder.startRecording(); RECORDING.set(true);
            }
            show(awake ? "Your turn. Listening for your reply on the Mac." : "Listening for Hey Luna on your Mac.", awake ? LunaFace.State.AWAKE : LunaFace.State.WAITING);
            while (!closed && !blocked(context) && SystemClock.elapsedRealtime() < until && used < audio.length) {
                int count;
                synchronized (this) { if (recorder == null) return null; count = recorder.read(samples,0,samples.length,AudioRecord.READ_NON_BLOCKING); }
                if (count < 0) throw new IllegalStateException();
                if (count == 0) { SystemClock.sleep(10); continue; }
                long power = 0; for (int i=0;i<count;i++) power += (long)samples[i]*samples[i];
                boolean voiced = power / count > 40000; // RMS > 200 out of 32768.
                if (!speech && voiced) {
                    speech = true;
                    if (awake) main.post(() -> { if (!closed) listener.speechActive(); });
                    for (int i=0;i<leadCount;i++) audio[used++] = lead[(leadAt-leadCount+i+lead.length)%lead.length];
                }
                if (speech) {
                    int keep = Math.min(count,audio.length-used); System.arraycopy(samples,0,audio,used,keep); used += keep;
                    quiet = voiced ? 0 : quiet + count;
                    if (quiet >= 14400 && used >= 8000) break;
                } else for(int i=0;i<count;i++) { lead[leadAt] = samples[i]; leadAt=(leadAt+1)%lead.length; leadCount=Math.min(leadCount+1,lead.length); }
            }
            if (closed || blocked(context) || !speech) return null;
            byte[] pcm = new byte[used*2];
            for(int i=0;i<used;i++) { pcm[2*i]=(byte)audio[i]; pcm[2*i+1]=(byte)(audio[i]>>8); }
            return pcm;
        } finally { closeRecorder(); Arrays.fill(samples,(short)0); Arrays.fill(audio,(short)0); Arrays.fill(lead,(short)0); }
    }
    private void run() {
        String code="COMMAND_WINDOW_EXPIRED", text="No reply heard. Returning to Hey Luna.";
        int seconds=0; long deadline=Long.MAX_VALUE;
        WakeSession wake=new WakeSession(SystemClock.elapsedRealtime(),true);
        if(followUp) {
            wake.beginFollowUp(SystemClock.elapsedRealtime());
            main.post(() -> { if (!closed) listener.wake(QuestionPolicy.activeAssistant); });
        }
        try {
            while(!closed && !blocked(context)) {
                deadline=wake.deadline();
                if(wake.expired(SystemClock.elapsedRealtime())) break;
                byte[] pcm=capture(deadline,wake.awaitingCommand());
                if(pcm==null) break;
                String heard;
                show("Working it out on your Mac. Microphone paused.", wake.awaitingCommand() ? LunaFace.State.REVIEW : LunaFace.State.WAITING);
                try { heard=QuestionReply.recognize(context,pcm); } finally { Arrays.fill(pcm,(byte)0); }
                if(closed || blocked(context)) break;
                String normalized=heard.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9' ]"," ").trim().replaceAll("\\s+"," ");
                if(!wake.awaitingCommand()) {
                    if(normalized.equals("hey luna") || normalized.startsWith("hey luna ") || normalized.equals("hey liam") || normalized.startsWith("hey liam ")) {
                        final String assistant = normalized.startsWith("hey liam") ? "liam" : "luna";
                        main.post(() -> { if (!closed) { listener.wake(assistant); listener.visual(LunaFace.State.AWAKE); } });
                        wake.acceptFinal("hey luna",SystemClock.elapsedRealtime());
                        normalized=normalized.substring(8).trim();
                        if(normalized.isEmpty()) continue;
                        // Preserve the actual recognized command, including casing/punctuation.
                        heard=heard.replaceFirst("(?i)^\\s*hey[ ,]+(?:luna|liam)[ ,.!?:;-]*", "").trim();
                    } else {
                        seconds=wake.acceptFinal(normalized,SystemClock.elapsedRealtime(),TimerAlarmService.ringing());
                        if(seconds==TimerCommand.STOP) { code="COMMAND_MATCH";text="Alarm stopped.";break; }
                        continue;
                    }
                }
                final String recognized = heard;
                main.post(() -> { if (!closed) { listener.transcript(recognized, true); listener.visual(LunaFace.State.REVIEW); } });
                // Capture ended before the deadline; permit bounded remote decoding.
                wake.decodeUntil(SystemClock.elapsedRealtime()+1000); deadline=wake.deadline();
                seconds=wake.acceptFinal(normalized,SystemClock.elapsedRealtime());
                if(TimerCommand.valid(seconds)) {code="COMMAND_MATCH";text="Timer command recognized.";break;}
                if(wake.acceptQuestion(heard,SystemClock.elapsedRealtime())) {code="QUESTION_FINAL";text=heard;break;}
                break;
            }
            if(blocked(context)) {code="ACCESS_STOP";text="Listening stopped: unlock and unmute first.";}
        } catch(Exception failure) {code="HOST_UNAVAILABLE";text="Mac speech recognition unavailable. Listening stopped.";}
        finally { closeRecorder(); BUSY.set(false); final String resultCode=code,resultText=text;final int duration=seconds;final long end=deadline;main.post(()->listener.finished(resultCode,resultText,duration,end,closed)); }
    }
}
