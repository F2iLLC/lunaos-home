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
            if ("configure-voice".equals(mode) || "verify-voice".equals(mode)) {
                android.util.AtomicFile settings = new android.util.AtomicFile(new java.io.File(getTargetContext().getNoBackupFilesDir(), "vehicle-session.json"));
                org.json.JSONObject state;
                try (java.io.InputStream in = settings.openRead()) {
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(); byte[] buffer = new byte[1024]; int n;
                    while ((n = in.read(buffer)) >= 0) { out.write(buffer, 0, n); if (out.size() > 8192) throw new java.io.IOException(); }
                    state = new org.json.JSONObject(out.toString("UTF-8"));
                }
                String voice = "configure-voice".equals(mode) ? arguments.getString("voiceId", "") : state.optString("voiceId", "");
                String pack = "configure-voice".equals(mode) ? arguments.getString("voicePack", "") : state.optString("voicePack", "");
                if (voice.isEmpty()) throw new IllegalArgumentException();
                int count = io.github.f2illc.lunaos.home.vehicle.VehicleVoiceCache.verify(
                    io.github.f2illc.lunaos.home.vehicle.VehicleVoiceCache.directory(getTargetContext().getNoBackupFilesDir(), pack), voice, state.optString("nickname", "LunaOS"));
                if ("configure-voice".equals(mode)) {
                    state.put("voiceId", voice).put("voicePack", pack).put("status", "ElevenLabs voice configured; complete offline greeting cache verified.");
                    java.io.FileOutputStream out = settings.startWrite();
                    try { out.write(state.toString().getBytes("UTF-8")); settings.finishWrite(out); }
                    catch (Exception error) { settings.failWrite(out); throw error; }
                }
                result.putInt("verifiedVoiceClips", count); result.putString("result", "Offline voice cache verified; no playback attempted.");
                finish(0, result); return;
            }
            if ("configure-names".equals(mode)) {
                String name = arguments.getString("name", ""), nickname = arguments.getString("nickname", "");
                if (!io.github.f2illc.lunaos.home.vehicle.VehicleGreetings.validName(name) ||
                    !io.github.f2illc.lunaos.home.vehicle.VehicleGreetings.validName(nickname)) throw new IllegalArgumentException();
                android.util.AtomicFile settings = new android.util.AtomicFile(new java.io.File(getTargetContext().getNoBackupFilesDir(), "vehicle-session.json"));
                org.json.JSONObject state;
                try (java.io.InputStream in = settings.openRead()) {
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(); byte[] buffer = new byte[1024]; int n;
                    while ((n = in.read(buffer)) >= 0) { out.write(buffer, 0, n); if (out.size() > 8192) throw new java.io.IOException(); }
                    state = new org.json.JSONObject(out.toString("UTF-8"));
                }
                state.put("name", name.trim()).put("nickname", nickname.trim());
                java.io.FileOutputStream out = settings.startWrite();
                try { out.write(state.toString().getBytes("UTF-8")); settings.finishWrite(out); }
                catch (Exception error) { settings.failWrite(out); throw error; }
                result.putString("result", "Vehicle names configured locally; no names returned or sent to Home.");
                finish(0, result); return;
            }
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
        } catch (Exception failure) { result.putString("result", "Requested diagnostic or configuration unavailable"); finish(1, result); }
    }
}
