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

/** User-started finite microphone service. Never launches an activity itself. */
public final class BackgroundWakeService extends Service {
    static final String START = "home.probe.START", STOP = "home.probe.STOP";
    private static final String CHANNEL = "local-wake-probe";
    private static final int LISTENING = 41, RESULT = 42;
    private static final PendingTimerRequest pending = new PendingTimerRequest();
    static boolean running;
    static LunaFace.State visual = LunaFace.State.OFF;
    static String latest = "Microphone off. Nothing starts automatically.";
    private final Handler handler = new Handler();
    private ProbeCapture capture;
    private PowerManager.WakeLock wakeLock;
    private long maximum;
    private boolean destroyed;
    private final Runnable watch = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            boolean allowed = !ProbeCapture.blocked(BackgroundWakeService.this);
            if (!allowed || (capture != null && SystemClock.elapsedRealtime() >= maximum)) {
                end("Listening stopped: deadline, lock, mute or permission change. Microphone off.");
            } else if (capture == null && pending.peek(SystemClock.elapsedRealtime(), allowed) == 0) {
                end("Timer review expired. Microphone off. No timer started.");
            } else handler.postDelayed(this, 100);
        }
    };
    static int pendingSeconds(android.content.Context context) {
        return pending.peek(SystemClock.elapsedRealtime(), !ProbeCapture.blocked(context));
    }
    static int claim(android.content.Context context) {
        return pending.claim(SystemClock.elapsedRealtime(), !ProbeCapture.blocked(context));
    }
    static void revoke(android.content.Context context) {
        visual = LunaFace.State.OFF;
        pending.clear();
        ((NotificationManager) context.getSystemService(NOTIFICATION_SERVICE)).cancel(RESULT);
        context.stopService(new Intent(context, BackgroundWakeService.class));
    }
    private Notification notification(String text, boolean microphone) {
        PendingIntent open = PendingIntent.getActivity(this, 1, new Intent(this, VoiceProbe.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 2, new Intent(this, BackgroundWakeService.class)
            .setAction(STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(microphone ? "Home: local microphone test" : "Home: microphone off")
            .setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(open).setOnlyAlertOnce(true).setOngoing(microphone)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(new Notification.Action.Builder(null, "Stop / discard", stop).build()).build();
    }
    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }
    private void end(String text) {
        latest = text;
        visual = text.startsWith("Command timed out") || text.startsWith("Listening time limit")
            ? LunaFace.State.RETRY : LunaFace.State.OFF;
        pending.clear();
        if (capture != null) capture.stop();
        capture = null; running = false;
        handler.removeCallbacks(watch);
        releaseWakeLock();
        stopForeground(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(RESULT);
        stopSelf();
        Log.i("HomeVoiceProbe", "BACKGROUND_STOPPED");
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent == null || !START.equals(intent.getAction())) {
            end("Listening stopped. Microphone off. No timer started.");
            return START_NOT_STICKY;
        }
        if (running || capture != null) return START_NOT_STICKY;
        pending.clear();
        NotificationManager notifications = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Local wake test", NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null); channel.enableVibration(false);
        notifications.createNotificationChannel(channel); notifications.cancel(RESULT);
        latest = "Loading local model. Microphone off; please wait.";
        visual = LunaFace.State.PREPARING;
        startForeground(LISTENING, notification(latest, true));
        if (ProbeCapture.blocked(this) || ProbeCapture.busy()) {
            end("Could not start: unlock, unmute and wait for the previous worker to finish. Microphone off.");
            return START_NOT_STICKY;
        }
        maximum = SystemClock.elapsedRealtime() + WakeSession.WAIT_MS;
        try {
            wakeLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HomeVoiceProbe:finiteWakeTest");
            wakeLock.acquire(WakeSession.WAIT_MS + 1000);
            capture = new ProbeCapture(this, true, true, new ProbeCapture.Listener() {
                @Override public void visual(LunaFace.State state) {
                    if (!destroyed && capture != null) visual = state;
                }
                @Override public void status(String text) {
                    if (destroyed || capture == null) return;
                    if (text.startsWith("Listening stopped") || text.startsWith("Command timed out")
                            || text.startsWith("Listening time limit")) { end(text); return; }
                    latest = text;
                    notifications.notify(LISTENING, notification(text, true));
                }
                @Override public void finished(String code, String text, int seconds, long deadline, boolean canceled) {
                    if (destroyed || capture == null) return;
                    capture = null; running = false;
                    releaseWakeLock(); stopForeground(true);
                    if (!canceled && !ProbeCapture.blocked(BackgroundWakeService.this)
                            && SystemClock.elapsedRealtime() < Math.min(maximum, deadline) && seconds > 0) {
                        pending.offer(seconds, SystemClock.elapsedRealtime());
                        visual = LunaFace.State.REVIEW;
                        latest = "Recognized " + seconds + " seconds. Microphone off. Tap notification, then Start recognized timer in Clock within 60 seconds. NO timer started.";
                        notifications.notify(RESULT, notification(latest, false));
                        Log.i("HomeVoiceProbe", "BACKGROUND_REVIEW_READY_NO_TIMER");
                    } else end(text + " Microphone off. No timer started.");
                }
            });
            if (!capture.start()) { end("Previous worker still closing. Microphone off."); return START_NOT_STICKY; }
            running = true;
            handler.post(watch);
        } catch (RuntimeException failure) {
            end("Background test could not start. Microphone off. No timer started.");
        }
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() {
        destroyed = true;
        if (capture != null || pending.peek(SystemClock.elapsedRealtime(), true) > 0) {
            latest = "Background test stopped. Microphone off. No timer started.";
            visual = LunaFace.State.OFF;
        }
        if (capture != null) capture.stop();
        capture = null; running = false; pending.clear();
        handler.removeCallbacks(watch); releaseWakeLock(); stopForeground(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(RESULT);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
