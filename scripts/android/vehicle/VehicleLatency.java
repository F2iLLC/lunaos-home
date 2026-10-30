package io.github.f2illc.lunaos.home.vehicle;

import android.content.Context;
import android.os.Bundle;
import android.util.AtomicFile;
import io.github.f2illc.lunaos.directtlsprobe.VehicleConversationClient;
import java.io.*;
import org.json.JSONObject;

/** Debug-only last-turn durations. No transcript, identifiers, audio or history. */
public final class VehicleLatency {
    private static final String[] FIELDS = {"recognitionFinalizeMs", "connectionMs", "modelMs", "speechMs", "readyMs", "transferMs", "routeReadyMs", "afterSpeechToUnmuteMs"};
    private static AtomicFile file(Context context) { return new AtomicFile(new File(context.getNoBackupFilesDir(), "vehicle-latency.json")); }
    public static void clear(Context context) { file(context).delete(); }
    public static void record(Context context, VehicleConversationClient.Reply reply, long recognition, long route, long total) {
        long[] values = {recognition, reply.connectionMs, reply.modelMs, reply.speechMs, reply.readyMs, reply.transferMs, route, total};
        AtomicFile target = file(context); FileOutputStream out = null;
        try {
            JSONObject data = new JSONObject();
            for (int i = 0; i < FIELDS.length; i++) data.put(FIELDS[i], Math.max(-1, Math.min(600_000, values[i])));
            out = target.startWrite(); out.write(data.toString().getBytes("UTF-8")); target.finishWrite(out);
        } catch (Exception unavailable) { if (out != null) target.failWrite(out); }
    }
    public static Bundle read(Context context) throws Exception {
        Bundle result = new Bundle();
        try (InputStream in = file(context).openRead()) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] chunk = new byte[512]; int n;
            while ((n = in.read(chunk)) != -1) { bytes.write(chunk, 0, n); if (bytes.size() > 2048) throw new IOException(); }
            JSONObject data = new JSONObject(bytes.toString("UTF-8"));
            if (data.length() != FIELDS.length) throw new IOException();
            for (String name : FIELDS) { long value = data.getLong(name); if (value < -1 || value > 600_000) throw new IOException(); result.putLong(name, value); }
        }
        result.putString("result", "Last local reply-to-unmute durations only. -1 means unmeasured. Unmute is not proof of acoustic first sound or completed playback.");
        return result;
    }
}
