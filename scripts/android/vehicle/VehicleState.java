package io.github.f2illc.lunaos.home.vehicle;

import android.content.Context;
import android.util.AtomicFile;
import java.io.*;
import org.json.JSONObject;

/** App-private, backup-excluded current session only. Never retains trip history. */
final class VehicleState {
    private final AtomicFile file;
    String address = "";
    String status = "Choose your parked vehicle to enable greetings.";
    String backend = "Not contacted";
    String audio = "Not attempted";
    int lastGreetingId = -1;
    String name = "My vehicle";
    String nickname = "LunaOS";
    VehicleTrip trip = new VehicleTrip();
    VehicleState(Context context) {
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), "vehicle-session.json"));
        try (InputStream in = file.openRead()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] bytes = new byte[1024]; int n;
            while ((n = in.read(bytes)) >= 0) { out.write(bytes, 0, n); if (out.size() > 8192) throw new IOException(); }
            JSONObject data = new JSONObject(out.toString("UTF-8"));
            address = data.getString("address"); status = data.getString("status"); backend = data.getString("backend");
            audio = data.optString("audio", "Not recorded");
            lastGreetingId = data.optInt("lastGreetingId", -1);
            name = data.optString("name", "My vehicle"); nickname = data.optString("nickname", "LunaOS");
            if (!VehicleGreetings.validName(name) || !VehicleGreetings.validName(nickname)) throw new IOException("Invalid names");
            trip.id = data.getString("trip"); trip.claimed = data.getBoolean("claimed");
            trip.boot = data.getInt("boot"); trip.sequence = data.getInt("sequence"); trip.disconnectedAt = data.getLong("disconnected");
        } catch (FileNotFoundException absent) { }
        catch (Exception corrupt) { address = ""; status = "Setup unavailable. Choose the vehicle again."; }
    }
    boolean save() {
        FileOutputStream out = null;
        try {
            JSONObject data = new JSONObject().put("address", address).put("status", status).put("backend", backend).put("audio", audio).put("lastGreetingId", lastGreetingId).put("name", name).put("nickname", nickname)
                .put("trip", trip.id).put("claimed", trip.claimed).put("boot", trip.boot)
                .put("sequence", trip.sequence).put("disconnected", trip.disconnectedAt);
            out = file.startWrite(); out.write(data.toString().getBytes("UTF-8")); file.finishWrite(out); return true;
        } catch (Exception failure) { if (out != null) file.failWrite(out); return false; }
    }
}
