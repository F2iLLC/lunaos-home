package io.github.f2illc.lunaos.directtlsprobe;

import android.content.Context;
import java.io.*;
import org.json.JSONObject;

/** Test controller writes only a fixed app-private file after public-key enrollment. */
final class FixtureConfig {
    static JSONObject read(Context context) throws Exception {
        try (InputStream in = new FileInputStream(new File(context.getNoBackupFilesDir(), "config.json"))) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] chunk = new byte[1024]; int n;
            while ((n = in.read(chunk)) != -1) { bytes.write(chunk, 0, n); if (bytes.size() > 8192) throw new IOException("Oversized test config"); }
            return new JSONObject(bytes.toString("UTF-8"));
        }
    }
}
