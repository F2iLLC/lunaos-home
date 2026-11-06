package io.github.f2illc.lunaos.home.voiceprobe;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import app.tauri.plugin.JSObject;
import org.json.JSONArray;

/** Read-only Home snapshot and explicit controls for the Home-owned voice service. */
public final class HomeLunaBridge {
    private HomeLunaBridge() {}

    private static boolean modelAvailable(Context context) throws Exception {
        String[] acoustic = context.getAssets().list("model/am");
        String[] config = context.getAssets().list("model/conf");
        if (acoustic == null || config == null) return false;
        boolean decoder = false, settings = false;
        for (String name : acoustic) if ("final.mdl".equals(name)) decoder = true;
        for (String name : config) if ("model.conf".equals(name)) settings = true;
        return decoder && settings;
    }

    private static boolean debugApiAvailable(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0
            && Build.VERSION.SDK_INT >= 26;
    }

    public static JSObject snapshot(Context context) {
        JSObject out = new JSObject();
        try {
            boolean model = modelAvailable(context);
            String reason = model ? "" : "local_model_unavailable";
            String phase = BackgroundWakeService.running ? BackgroundWakeService.visual.name().toLowerCase()
                : "off";
            boolean microphone = ProbeCapture.recording();
            JSONArray timers = new JSONArray();
            TimerLedger ledger = NativeTimers.read(context);
            long now = SystemClock.elapsedRealtime();
            for (int id = 1; id <= TimerLedger.LIMIT; id++) {
                if (ledger.deadlines[id] > 0) {
                    JSObject timer = new JSObject();
                    timer.put("id", Integer.toString(id));
                    timer.put("label", "Timer " + id);
                    timer.put("remainingSeconds", Math.max(0, (ledger.deadlines[id] - now + 999) / 1000));
                    timers.put(timer);
                }
            }
            out.put("status", model ? "ready" : "unavailable");
            out.put("reason", reason);
            out.put("capturePhase", phase);
            out.put("microphoneInUse", microphone);
            out.put("onlineAnswersEnabled", QuestionReply.enabled(context));
            out.put("onlineAnswersAvailable", QuestionReply.configured(context));
            out.put("activeTimers", timers);
        } catch (Exception failure) {
            throw new IllegalStateException("Luna snapshot unavailable");
        }
        return out;
    }

    public static void requestMicrophone(Activity activity) {
        if (!debugApiAvailable(activity)) throw new IllegalStateException("Debug Android API 26+ required");
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            activity.requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, 902);
    }

    public static void enable(Activity activity) throws Exception {
        if (!debugApiAvailable(activity)) throw new IllegalStateException("Debug Android API 26+ required");
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestMicrophone(activity);
            throw new IllegalStateException("Allow microphone access, then tap Enable again");
        }
        if (!modelAvailable(activity)) throw new IllegalStateException("Local wake model unavailable");
        if (ProbeCapture.blocked(activity)) throw new IllegalStateException("Unlock, unmute and allow microphone access first");
        activity.startForegroundService(new Intent(activity, BackgroundWakeService.class).setAction(BackgroundWakeService.START));
    }

    public static void disable(Context context) { BackgroundWakeService.revoke(context); }

    public static void setOnlineAnswers(Context context, boolean enabled) {
        if (!debugApiAvailable(context)) throw new IllegalStateException("Debug Android API 26+ required");
        BackgroundWakeService.revoke(context);
        if (enabled && !QuestionReply.configured(context)) throw new IllegalStateException("Qwen relay is not configured");
        if (!context.getSharedPreferences(QuestionReply.PREFERENCES, Context.MODE_PRIVATE).edit()
            .putBoolean(QuestionReply.ENABLED, enabled).commit()) throw new IllegalStateException("Could not save setting");
        if (enabled) QuestionReply.confirmEnabled(context);
    }

    public static void cancel(Context context, int id) {
        if (id < 1 || id > TimerLedger.LIMIT) throw new IllegalArgumentException("Invalid timer");
        NativeTimers.execute(context, TimerCommand.cancel(id));
    }
}
