package io.github.f2illc.lunaos.home.voiceprobe;
import android.app.Service;
import android.content.*;
import android.media.*;
import android.os.*;
import android.util.Log;

/**
 * Alarm playback is independent of the explicitly enabled microphone service.
 * It plays at the media volume, the one the volume buttons change and the one
 * Luna speaks at, so a person can always turn a timer down. A timer nobody
 * answers stops itself after it has rung for a minute.
 */
public final class TimerAlarmService extends Service {
    private static TimerAlarmService active;
    private MediaPlayer player;
    private boolean attempted;
    static final long RING_MS = 60000;
    private final long[] since = new long[TimerLedger.LIMIT + 1];
    private int foregroundId;
    private final Handler handler = new Handler();
    private final Runnable watch = new Runnable() { public void run() { expire(); update(); if (active == TimerAlarmService.this) handler.postDelayed(this, 250); } };
    static boolean ringing() { return active != null; }
    static void refresh(Context c) { if (active != null) active.update(); }
    static void duck(boolean value) { if (active != null && active.player != null) try { active.player.setVolume(value ? 0.12f : 1f, value ? 0.12f : 1f); } catch (RuntimeException ignored) {} }
    // Counted from when this service began ringing a timer, not from its deadline,
    // so a timer that comes due while the device could not ring is still heard.
    private void expire() {
        long now = SystemClock.elapsedRealtime();
        for (int id = 1; id <= TimerLedger.LIMIT; id++) if (since[id] > 0 && now - since[id] >= RING_MS) {
            since[id] = 0;
            try { NativeTimers.execute(this, TimerCommand.cancel(id)); Log.i("HomeVoiceProbe", "ALARM_AUTO_STOPPED"); }
            catch (RuntimeException failure) { Log.i("HomeVoiceProbe", "ALARM_AUTO_STOP_FAILED"); }
        }
    }
    private void update() {
        TimerLedger ledger = NativeTimers.read(this);
        int first = 0;
        long now = SystemClock.elapsedRealtime();
        for (int id = 1; id <= TimerLedger.LIMIT; id++) {
            if (ledger.deadlines[id] > 0 && ledger.deadlines[id] <= now) {
                first = id; NativeTimers.show(this, ledger, id);
                if (since[id] == 0) since[id] = now;
            } else since[id] = 0;
        }
        if (first == 0) {
            if (player != null) { player.release(); player = null; }
            attempted = false; active = null; stopForeground(true); stopSelf(); return;
        }
        if (foregroundId != 100 + first) {
            // Detach the old notification so another ringing timer retains its Cancel action.
            if (foregroundId != 0) stopForeground(STOP_FOREGROUND_DETACH);
            foregroundId = 100 + first;
        }
        startForeground(foregroundId, NativeTimers.notice(this, ledger, first));
        if (!attempted) {
            attempted = true;
            try {
                player = new MediaPlayer();
                player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
                player.setDataSource(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
                player.setLooping(true); player.prepare(); player.start();
                Log.i("HomeVoiceProbe", "NATIVE_TIMER_PLAYBACK_REQUESTED");
            } catch (Exception failure) {
                if (player != null) player.release(); player = null;
                Log.i("HomeVoiceProbe", "NATIVE_TIMER_SOUND_FAILED");
            }
        }
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        active = this; handler.removeCallbacksAndMessages(null); update();
        if (active == this) handler.postDelayed(watch, 250);
        return START_NOT_STICKY;
    }
    @Override public void onDestroy() { if (active == this) active = null; handler.removeCallbacksAndMessages(null); if (player != null) player.release(); player = null; super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
