package io.github.f2illc.lunaos.home.voiceprobe;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Handler;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

/** Explicitly enabled local wake listening. Never launches an activity itself. */
public final class BackgroundWakeService extends Service {
    static final String START = "home.probe.START", STOP = "home.probe.STOP";
    private static final String CHANNEL = "local-wake-probe";
    private static final int LISTENING = 41;
    static boolean running;
    static volatile boolean listeningRequested;
    static volatile boolean replyPlaying;
    static LunaFace.State visual = LunaFace.State.OFF;
    static String latest = "Microphone off. Enable wake-word listening to start.";
    private final Handler handler = new Handler();
    private ProbeCapture capture;
    private PowerManager.WakeLock wakeLock;
    private long renewAt, generation;
    private boolean destroyed, restarting, responding, followUpPending;
    private SpokenReply reply;
    private QuestionReply questionReply;
    private final Runnable watch = new Runnable() {
        @Override public void run() {
            if (destroyed || !running) return;
            if (ProbeCapture.blocked(BackgroundWakeService.this)) {
                end("Listening disabled: lock, mute or permission change. Microphone off.");
                return;
            }
            if (capture != null || responding) {
                try { renewWakeLock(); }
                catch (RuntimeException failure) { end("Listening disabled: could not keep the decoder awake. Microphone off."); return; }
            } else if (!responding && !restarting) scheduleCapture(0);
            handler.postDelayed(this, 100);
        }
    };
    static void revoke(android.content.Context context) {
        QuestionPolicy.resetConversation();
        listeningRequested = false;
        replyPlaying = false;
        // Revoke synchronously, before Android delivers onDestroy or a queued callback.
        running = false;
        visual = LunaFace.State.OFF;
        latest = "Wake-word listening disabled. Microphone off.";
        context.stopService(new Intent(context, BackgroundWakeService.class));
    }
    private Notification notification(String text) {
        PendingIntent open = PendingIntent.getActivity(this, 1, new Intent(this, VoiceProbe.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, BackgroundWakeService.class)
            .setAction(STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Luna: wake-word listening enabled")
            .setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(open).setOnlyAlertOnce(true).setOngoing(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(new Notification.Action.Builder(null, "Disable listening", stop).build()).build();
    }
    private void notifyStatus() {
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(LISTENING, notification(latest));
    }
    private void renewWakeLock() {
        long now = SystemClock.elapsedRealtime();
        if (wakeLock == null) {
            wakeLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HomeVoiceProbe:wakeListening");
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld() || now >= renewAt) {
            wakeLock.acquire(60000);
            renewAt = now + 30000;
        }
    }
    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }
    private void end(String text) {
        running = false; generation++; restarting = false; responding = false; followUpPending = false;
        QuestionPolicy.replyWantsFollowUp = false;
        if (reply != null) reply.close(); reply = null; TimerAlarmService.duck(false);
        if (questionReply != null) questionReply.close(); questionReply = null;
        latest = text; visual = LunaFace.State.OFF; replyPlaying = false;
        if (capture != null) capture.stop();
        capture = null;
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock(); stopForeground(true); stopSelf();
        ProbeCapture.releaseEngine();
        Log.i("HomeVoiceProbe", "BACKGROUND_STOPPED");
    }
    private void scheduleCapture(long delay) {
        if (!running || destroyed || capture != null || restarting || responding) return;
        restarting = true;
        final long id = generation;
        handler.postDelayed(() -> {
            if (destroyed || !running || generation != id) return;
            restarting = false;
            beginCapture();
        }, delay);
    }
    private void beginCapture() {
        if (!running || destroyed || capture != null) return;
        if (ProbeCapture.blocked(this) || ProbeCapture.busy()) {
            end("Listening disabled: unlock, unmute and wait for the previous worker to finish. Microphone off.");
            return;
        }
        final long id = ++generation;
        try {
            renewWakeLock();
            latest = "Connecting to Mac speech recognition. Microphone off.";
            visual = LunaFace.State.PREPARING;
            notifyStatus();
            final boolean followUp = followUpPending;
            followUpPending = false;
            capture = new ProbeCapture(this, true, true, true, followUp, new ProbeCapture.Listener() {
                private boolean current() { return !destroyed && running && generation == id && capture != null; }
                @Override public void visual(LunaFace.State state) {
                    if (current()) { visual = state; TimerAlarmService.duck(state == LunaFace.State.AWAKE); }
                }
                @Override public void status(String text) {
                    if (!current()) return;
                    if (text.startsWith("Listening stopped")) { end(text); return; }
                    latest = text; notifyStatus();
                }
                @Override public void finished(String code, String text, int seconds, long deadline, boolean canceled) {
                    if (!current()) return;
                    capture = null; releaseWakeLock();
                    boolean blocked = ProbeCapture.blocked(BackgroundWakeService.this);
                    boolean hasFinalTranscript = text != null && text.length() <= 1000 && !text.trim().isEmpty();
                    if (!blocked && !canceled && SystemClock.elapsedRealtime() < deadline && hasFinalTranscript)
                        QuestionPolicy.lastHeard = text.trim();
                    if (blocked) {
                        end("Listening disabled: lock, mute or permission change. Microphone off.");
                    } else if (!canceled && SystemClock.elapsedRealtime() < deadline && TimerCommand.valid(seconds)) {
                        QuestionPolicy.notebookFeedback(null);
                        responding = true;
                        visual = LunaFace.State.RESPONSE;
                        String result;
                        try { result = NativeTimers.execute(BackgroundWakeService.this, seconds); }
                        catch (RuntimeException failure) { result = "Timer change failed or is uncertain. Check the timer list before retrying."; }
                        latest = result + " Microphone paused for reply; wake listening resumes afterward.";
                        notifyStatus();
                        Log.i("HomeVoiceProbe", "NATIVE_TIMER_COMMAND_HANDLED");
                        final long responseId = generation;
                        try {
                            renewWakeLock();
                            reply = new SpokenReply(BackgroundWakeService.this, result, () -> {
                                if (destroyed || !running || generation != responseId) return;
                                reply = null; responding = false; releaseWakeLock(); TimerAlarmService.duck(false); scheduleCapture(250);
                            });
                        } catch (RuntimeException failure) { responding = false; releaseWakeLock(); TimerAlarmService.duck(false); scheduleCapture(250); }
                    } else if (!canceled && SystemClock.elapsedRealtime() < deadline && "QUESTION_FINAL".equals(code)
                            && QuestionReply.enabled(BackgroundWakeService.this) && QuestionPolicy.accepts(text)) {
                        QuestionPolicy.notebookFeedback(null);
                        QuestionPolicy.isFollowUp = followUp;
                        responding = true; visual = LunaFace.State.RESPONSE;
                        latest = "Answering online. Microphone paused; waiting resumes after the reply or if the service is unavailable.";
                        notifyStatus();
                        final long responseId = generation;
                        try {
                            renewWakeLock();
                            questionReply = new QuestionReply(BackgroundWakeService.this, text, played -> {
                                if (destroyed || !running || generation != responseId) return;
                                boolean requestedFollowUp = QuestionPolicy.takeFollowUp();
                                followUpPending = played && requestedFollowUp;
                                questionReply = null; responding = false; releaseWakeLock(); TimerAlarmService.duck(false);
                                latest = played ? "Answer playback finished. Returning to wake-word listening."
                                    : "Reply unavailable. A list change may have saved; check the notebook before retrying. Returning to wake-word listening.";
                                visual = played ? LunaFace.State.RESPONSE : LunaFace.State.RETRY; notifyStatus();
                                scheduleCapture(played ? 250 : 2500);
                            });
                        } catch (RuntimeException failure) { responding = false; releaseWakeLock(); TimerAlarmService.duck(false); scheduleCapture(250); }
                    } else if ("COMMAND_WINDOW_EXPIRED".equals(code) || "LISTENING_DEADLINE".equals(code)) {
                        TimerAlarmService.duck(false);
                        visual = LunaFace.State.RETRY;
                        latest = text + " Wake-word listening remains enabled; preparing to listen again.";
                        notifyStatus();
                        Log.i("HomeVoiceProbe", "WAKE_LISTENING_RESUMING");
                        scheduleCapture(750);
                    } else end(text + " Listening disabled. Microphone off. No timer started.");
                }
            });
            if (!capture.start()) end("Previous worker still closing. Listening disabled. Microphone off.");
        } catch (RuntimeException failure) {
            end("Wake-word listening could not start. Microphone off. No timer started.");
        }
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent == null || !START.equals(intent.getAction())) {
            end("Wake-word listening disabled. Microphone off. No timer started.");
            return START_NOT_STICKY;
        }
        if (running || capture != null) return START_NOT_STICKY;
        QuestionPolicy.resetConversation();
        NotificationManager notifications = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Wake-word listening", NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null); channel.enableVibration(false);
        notifications.createNotificationChannel(channel);
        notifications.cancel(42);
        latest = "Starting wake-word listening. Microphone off while loading.";
        visual = LunaFace.State.PREPARING;
        startForeground(LISTENING, notification(latest));
        running = true;
        listeningRequested = true;
        beginCapture();
        if (running) handler.post(watch);
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        destroyed = true; generation++; restarting = false; responding = false;
        if (reply != null) reply.close(); reply = null; TimerAlarmService.duck(false);
        if (questionReply != null) questionReply.close(); questionReply = null;
        if (running || capture != null)
            latest = "Wake-word listening stopped. Microphone off. Enable it to start again.";
        visual = LunaFace.State.OFF;
        replyPlaying = false;
        if (capture != null) capture.stop();
        capture = null; running = false;
        handler.removeCallbacksAndMessages(null); releaseWakeLock(); stopForeground(true);
        ProbeCapture.releaseEngine();
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
