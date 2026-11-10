package io.github.f2illc.lunaos.home.voiceprobe;

import android.app.*;
import android.content.*;
import android.os.SystemClock;
import android.provider.Settings;

/** Luna-owned timers. Never touches Clock timers, capture or device sound settings. */
final class NativeTimers {
    static final String FIRE = "home.probe.TIMER_FIRE", CANCEL = "home.probe.TIMER_CANCEL";
    private static int boot(Context c) { return Settings.Global.getInt(c.getContentResolver(), Settings.Global.BOOT_COUNT, -1); }
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("native-timers", Context.MODE_PRIVATE); }
    static TimerLedger read(Context c) { return TimerLedger.decode(prefs(c).getString("ledger", null), boot(c)); }
    private static void save(Context c, TimerLedger ledger) {
        int boot = boot(c);
        if (boot < 0 || !prefs(c).edit().putString("ledger", ledger.encode(boot)).commit()) throw new IllegalStateException("TIMER_STORAGE_FAILED");
    }
    private static PendingIntent event(Context c, int id, long revision) {
        return PendingIntent.getBroadcast(c, id, new Intent(c, TimerReceiver.class).setAction(FIRE)
            .setData(android.net.Uri.parse("home-timer://alarm/" + id + "/" + revision))
            .putExtra("id", id).putExtra("revision", revision), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    static void schedule(Context c, TimerLedger ledger, int id) {
        PendingIntent open = PendingIntent.getActivity(c, 100 + id, new Intent(c, VoiceProbe.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        long wallDeadline = System.currentTimeMillis() + Math.max(1, ledger.deadlines[id] - SystemClock.elapsedRealtime());
        ((AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).setAlarmClock(new AlarmManager.AlarmClockInfo(wallDeadline, open), event(c, id, ledger.revisions[id]));
    }
    static synchronized String execute(Context c, int command) {
        if (!TimerCommand.valid(command)) return "Unsupported timer command. Nothing changed.";
        TimerLedger ledger = read(c);
        if (command == TimerCommand.STOP) {
            // Silence everything that is ringing; timers still counting are left alone.
            long now = SystemClock.elapsedRealtime();
            long[] stopped = new long[TimerLedger.LIMIT + 1];
            int count = 0;
            for (int ringing = 1; ringing <= TimerLedger.LIMIT; ringing++)
                if (ledger.deadlines[ringing] > 0 && ledger.deadlines[ringing] <= now) {
                    stopped[ringing] = ledger.revisions[ringing]; ledger.set(ringing, 0); count++;
                }
            if (count > 0) {
                save(c, ledger); // Invalidate queued alarms before touching platform resources.
                for (int ringing = 1; ringing <= TimerLedger.LIMIT; ringing++) if (stopped[ringing] > 0) {
                    ((AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).cancel(event(c, ringing, stopped[ringing]));
                    ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(100 + ringing);
                }
                TimerAlarmService.refresh(c);
                return "Alarm stopped.";
            }
            command = TimerCommand.cancel(0); // Nothing is ringing: the one active timer.
        }
        boolean start = command > 0, cancel = command <= -10 && command >= -18;
        int id = start ? ledger.free() : ledger.select(TimerCommand.target(command));
        if (id < 0) return "More than one timer is active. Say the timer number, for example, cancel timer one, or add one minute to timer two.";
        if (id == 0) return start ? "Eight timers are already active. Cancel one first." : "That timer is not active.";
        if (cancel) {
            long previousRevision = ledger.revisions[id];
            ledger.set(id, 0); save(c, ledger); // Invalidate queued alarms before touching platform resources.
            ((AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).cancel(event(c, id, previousRevision));
            TimerAlarmService.refresh(c);
            ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(100 + id);
            return "Timer " + TimerPhrase.number(id) + " canceled.";
        }
        int seconds = start ? command : TimerCommand.duration(command);
        long deadline = (start ? SystemClock.elapsedRealtime() : Math.max(SystemClock.elapsedRealtime(), ledger.deadlines[id])) + seconds * 1000L;
        if (deadline - SystemClock.elapsedRealtime() > 24 * 60 * 60 * 1000L) return "A timer cannot exceed twenty four hours. Nothing changed.";
        TimerLedger previous = read(c);
        ledger.set(id, deadline); save(c, ledger);
        try { schedule(c, ledger, id); }
        catch (RuntimeException failure) {
            // Restore both durable state and the previous alarm if an extension failed.
            previous.revision = ledger.revision;
            save(c, previous);
            if (previous.deadlines[id] > 0) schedule(c, previous, id);
            throw failure;
        }
        if (previous.deadlines[id] > 0)
            ((AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).cancel(event(c, id, previous.revisions[id]));
        TimerAlarmService.refresh(c);
        show(c, ledger, id);
        return "Timer " + TimerPhrase.number(id) + (start ? " started for " : " extended by ") + seconds + " seconds.";
    }
    static synchronized void deliver(Context c, Intent intent) {
        TimerLedger ledger = read(c);
        if (Intent.ACTION_TIME_CHANGED.equals(intent.getAction())) {
            for (int id = 1; id <= TimerLedger.LIMIT; id++) if (ledger.deadlines[id] > 0) schedule(c, ledger, id);
            return;
        }
        int id = intent.getIntExtra("id", 0);
        if (CANCEL.equals(intent.getAction())) {
            if (id > 0 && id <= TimerLedger.LIMIT && ledger.revisions[id] == intent.getLongExtra("revision", -1)) execute(c, TimerCommand.cancel(id));
        } else if (FIRE.equals(intent.getAction()) && id > 0 && id <= TimerLedger.LIMIT
                && ledger.deadlines[id] > 0 && ledger.revisions[id] == intent.getLongExtra("revision", -1)) {
            if (ledger.due(id, ledger.revisions[id], SystemClock.elapsedRealtime()))
                c.startForegroundService(new Intent(c, TimerAlarmService.class));
            else schedule(c, ledger, id); // Wall-clock changes must not cause an early expiry.
        }
    }
    static PendingIntent cancelAction(Context c, TimerLedger ledger, int id) {
        return PendingIntent.getBroadcast(c, 100 + id, new Intent(c, TimerReceiver.class).setAction(CANCEL)
            .setData(android.net.Uri.parse("home-timer://cancel/" + id + "/" + ledger.revisions[id]))
            .putExtra("id", id).putExtra("revision", ledger.revisions[id]), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    static void channel(Context c) {
        NotificationChannel channel = new NotificationChannel("luna-timers", "Luna timers", NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null); channel.enableVibration(false);
        ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(channel);
    }
    static Notification notice(Context c, TimerLedger ledger, int id) {
        channel(c);
        boolean due = ledger.deadlines[id] <= SystemClock.elapsedRealtime();
        return new Notification.Builder(c, "luna-timers").setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Luna timer " + id + (due ? " · time is up" : " · counting down"))
            .setContentText("Cancel this Luna timer").setOngoing(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(PendingIntent.getActivity(c, 100 + id, new Intent(c, VoiceProbe.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .addAction(new Notification.Action.Builder(null, "Cancel timer " + id, cancelAction(c, ledger, id)).build()).build();
    }
    static void show(Context c, TimerLedger ledger, int id) {
        ((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(100 + id, notice(c, ledger, id));
    }
}
