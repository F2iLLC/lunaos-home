package io.github.f2illc.lunaos.directtlsprobe;

import android.content.Context;
import org.json.JSONObject;

/** Reuses Home's enrolled Keystore identity, TLS pin and private host config. */
public final class VehicleTransport {
    private VehicleTransport() { }
    public static String send(Context context, String trip, int sequence, boolean connected, String period) throws Exception {
        JSONObject config = FixtureConfig.read(context);
        // Separate, explicit endpoint permission; record-read approvals are not reused.
        if (!config.optBoolean("vehicleGreetings", false)) throw new SecurityException();
        try (SyntheticTlsClient client = new SyntheticTlsClient(context, config)) {
            if (!client.call(new JSONObject().put("op", "resume")).getBoolean("ok")) throw new SecurityException();
            JSONObject event = new JSONObject().put("endpoint", "vehicle").put("trip", trip)
                .put("sequence", sequence).put("event", connected ? "connected" : "disconnected").put("period", period);
            JSONObject result = client.call(new JSONObject().put("op", "vehicle").put("event", event));
            if (!result.getBoolean("ok")) throw new SecurityException();
            String greeting = result.getJSONObject("value").optString("greeting", "");
            if (greeting.length() > 240) throw new SecurityException();
            return greeting;
        }
    }
}
