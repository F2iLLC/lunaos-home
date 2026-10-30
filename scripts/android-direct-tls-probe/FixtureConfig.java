package io.github.f2illc.lunaos.directtlsprobe;

import android.content.Context;
import java.io.*;
import org.json.JSONObject;

/** Test controller writes only a fixed app-private file after public-key enrollment. */
final class FixtureConfig {
    static boolean approvedPhysicalTarget(Context context) throws Exception {
        JSONObject config = read(context);
        return "attended-fictional-lan-only".equals(config.optString("physicalOptIn"))
            && android.os.Build.MODEL.equals(config.getString("expectedModel"))
            && android.os.Build.VERSION.SDK_INT == config.getInt("expectedApi");
    }
    static String transportAddress(JSONObject config) throws IOException {
        String address = config.optString("transportAddress", "10.0.2.2");
        String[] parts = address.split("\\.", -1);
        if (parts.length != 4) throw new IOException("Private literal IPv4 required");
        int[] octets = new int[4];
        for (int i = 0; i < 4; i++) {
            if (!parts[i].matches("0|[1-9][0-9]{0,2}")) throw new IOException("Invalid IPv4");
            octets[i] = Integer.parseInt(parts[i]);
            if (octets[i] > 255) throw new IOException("Invalid IPv4");
        }
        if (!(octets[0] == 10 || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
            || (octets[0] == 192 && octets[1] == 168)
            || (octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127))) throw new IOException("Private IPv4 required");
        return address;
    }
    static JSONObject read(Context context) throws Exception {
        try (InputStream in = new FileInputStream(new File(context.getNoBackupFilesDir(), "config.json"))) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] chunk = new byte[1024]; int n;
            while ((n = in.read(chunk)) != -1) { bytes.write(chunk, 0, n); if (bytes.size() > 8192) throw new IOException("Oversized test config"); }
            return new JSONObject(bytes.toString("UTF-8"));
        }
    }
}
