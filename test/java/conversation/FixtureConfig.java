package io.github.f2illc.lunaos.directtlsprobe;
import android.content.Context;
import org.json.JSONObject;
final class FixtureConfig {
    static JSONObject read(Context context) { return new JSONObject().put("vehicleConversations", true); }
}
