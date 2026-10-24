package io.github.f2illc.lunaos.directtlsprobe;

import android.app.Instrumentation;
import android.os.Bundle;

/** Disposable developer harness; not packaged with Home. Public identity only. */
public final class VehicleProbe extends Instrumentation {
    private Bundle arguments;
    @Override public void onCreate(Bundle args) {
        super.onCreate(args); arguments = args; start();
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            String mode = arguments == null ? "prepare" : arguments.getString("mode", "prepare");
            if ("network".equals(mode)) {
                String phase = "config";
                try {
                    org.json.JSONObject config = FixtureConfig.read(getTargetContext()); phase = "TLS";
                    try (SyntheticTlsClient client = new SyntheticTlsClient(getTargetContext(), config)) {
                        phase = "resume";
                        result.putString("result", client.call(new org.json.JSONObject().put("op", "resume")).getBoolean("ok") ? "TLS and enrolled resume passed" : "Resume denied");
                    }
                } catch (Exception error) { result.putString("result", phase + ": " + error.getClass().getSimpleName()); }
                finish(0, result); return;
            }
            if ("audio".equals(mode)) {
                org.json.JSONObject state;
                try (java.io.InputStream in = new java.io.FileInputStream(new java.io.File(getTargetContext().getNoBackupFilesDir(), "vehicle-session.json"))) {
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(); byte[] buffer = new byte[1024]; int n;
                    while ((n = in.read(buffer)) >= 0) { out.write(buffer, 0, n); if (out.size() > 8192) throw new java.io.IOException(); }
                    state = new org.json.JSONObject(out.toString("UTF-8"));
                }
                String address = state.optString("address");
                android.media.AudioManager audio = getTargetContext().getSystemService(android.media.AudioManager.class);
                boolean match = false;
                for (android.media.AudioDeviceInfo device : audio.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS))
                    if (device.getType() == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP && address.equalsIgnoreCase(device.getAddress())) match = true;
                result.putBoolean("selectedBluetoothMediaOutputAvailable", match);
                result.putBoolean("tripClaimed", state.optBoolean("claimed"));
                result.putString("audio", state.optString("audio", "Not recorded by previous build"));
                result.putString("status", state.optString("status"));
                result.putString("backend", state.optString("backend"));
                finish(0, result); return;
            }
            if (!NativeIdentity.store().containsAlias(NativeIdentity.ALIAS)) NativeIdentity.create();
            NativeIdentity.inspect(getTargetContext());
            result.putString("result", "Keystore identity prepared; public certificate in app-private no-backup directory.");
            finish(0, result);
        } catch (Exception failure) { result.putString("result", "Identity unavailable"); finish(1, result); }
    }
}
