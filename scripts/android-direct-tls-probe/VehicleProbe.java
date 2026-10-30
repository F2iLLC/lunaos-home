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
            if ("renew-vehicle-identity".equals(mode)) {
                if (!"true".equals(arguments.getString("allowIdentityRenewal", "false"))) throw new SecurityException();
                NativeIdentity.renewVehicleCertificate(getTargetContext());
                result.putString("result", "Transport certificate renewed for 90 days with the same non-exportable key. Approve the renewed public certificate on Home before connecting.");
                finish(0, result); return;
            }
            if ("remote-readiness".equals(mode)) {
                android.content.Context context = getTargetContext();
                android.net.ConnectivityManager manager = context.getSystemService(android.net.ConnectivityManager.class);
                android.net.NetworkCapabilities active = manager.getNetworkCapabilities(manager.getActiveNetwork());
                result.putBoolean("defaultNetworkAvailable", active != null);
                result.putBoolean("defaultNetworkVpn", active != null && active.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN));
                result.putBoolean("defaultNetworkCellular", active != null && active.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR));
                result.putBoolean("wifiEnabled", context.getSystemService(android.net.wifi.WifiManager.class).isWifiEnabled());
                org.json.JSONObject config = FixtureConfig.read(context);
                result.putBoolean("adbReverseConfigured", config.optBoolean("vehicleHarnessAdbReverse", false));
                java.security.cert.X509Certificate cert = (java.security.cert.X509Certificate) NativeIdentity.requireIdentity().getCertificate(NativeIdentity.ALIAS);
                result.putLong("phoneCertificateDaysRemaining", (cert.getNotAfter().getTime() - System.currentTimeMillis()) / 86_400_000);
                try (SyntheticTlsClient client = new SyntheticTlsClient(context, config)) {
                    result.putBoolean("enrolledTlsReachable", client.call(new org.json.JSONObject().put("op", "resume")).getBoolean("ok"));
                } catch (Exception unavailable) { result.putBoolean("enrolledTlsReachable", false); }
                result.putString("result", "Readiness only; no provider request, microphone or playback. Does not establish vehicle audibility.");
                finish(0, result); return;
            }
            if ("last-conversation-timing".equals(mode)) {
                finish(0, io.github.f2illc.lunaos.home.vehicle.VehicleLatency.read(getTargetContext())); return;
            }
            if ("conversation-check".equals(mode) || "conversation-latency".equals(mode)) {
                if (!"true".equals(arguments.getString("allowProviderTest", "false"))) throw new SecurityException();
                org.json.JSONObject state;
                try (java.io.InputStream in = new java.io.FileInputStream(new java.io.File(getTargetContext().getNoBackupFilesDir(), "vehicle-session.json"))) {
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(); byte[] buffer = new byte[1024]; int n;
                    while ((n = in.read(buffer)) >= 0) { out.write(buffer, 0, n); if (out.size() > 8192) throw new java.io.IOException(); }
                    state = new org.json.JSONObject(out.toString("UTF-8"));
                }
                try (VehicleConversationClient client = new VehicleConversationClient(getTargetContext())) {
                    try {
                        if ("conversation-latency".equals(mode)) {
                            String id = java.util.UUID.randomUUID().toString();
                            VehicleConversationClient.Reply reply = client.ask(id, "In one short sentence, explain why the sky looks blue.", state.getString("voiceId"));
                            result.putLong("connectionMs", reply.connectionMs); result.putLong("modelMs", reply.modelMs);
                            result.putLong("speechMs", reply.speechMs); result.putLong("readyMs", reply.readyMs);
                            result.putLong("initialTransferMs", reply.transferMs); result.putInt("audioBytes", reply.wave.length);
                            int sample = 0;
                            // Counterbalanced order, identical cached bytes, no additional paid asks.
                            for (int window : new int[]{1, 8, 8, 1}) {
                                long start = android.os.SystemClock.elapsedRealtime();
                                byte[] downloaded = client.downloadAudio(id, reply.wave.length, window);
                                long elapsed = android.os.SystemClock.elapsedRealtime() - start;
                                if (!java.util.Arrays.equals(downloaded, reply.wave)) throw new java.io.IOException("Audio changed");
                                result.putLong("window" + window + "Sample" + (++sample) + "Ms", elapsed);
                            }
                            result.putString("result", "One paid fictional turn; identical audio compared with serial and eight-request windows. No microphone or playback.");
                        } else {
                            VehicleConversationClient.Reply reply = client.ask(java.util.UUID.randomUUID().toString(), "Remember this fictional test color: cobalt. Acknowledge briefly.", state.getString("voiceId"));
                            result.putInt("answerCharacters", reply.text.length()); result.putInt("waveBytes", reply.wave.length);
                            VehicleConversationClient.Reply followup = client.ask(java.util.UUID.randomUUID().toString(), "What fictional test color did I just ask you to remember?", state.getString("voiceId"));
                            boolean continuity = reply.conversationId.equals(followup.conversationId) && followup.text.toLowerCase(java.util.Locale.ROOT).contains("cobalt");
                            if (!continuity) throw new java.io.IOException("Follow-up context check failed");
                            result.putBoolean("followupContextVerified", true); result.putInt("followupWaveBytes", followup.wave.length);
                            result.putString("result", "Two fixed test questions answered with bounded context and speech downloaded. No microphone or playback; no car interaction tested.");
                        }
                    } finally { client.clear(); }
                }
                finish(0, result); return;
            }
            if ("conversation-capability".equals(mode)) {
                android.content.Context context = getTargetContext();
                result.putBoolean("onDeviceRecognitionAvailable", android.os.Build.VERSION.SDK_INT >= 31 && android.speech.SpeechRecognizer.isOnDeviceRecognitionAvailable(context));
                result.putBoolean("microphonePermissionGranted", context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED);
                result.putBoolean("localNetworkPermissionGranted", android.os.Build.VERSION.SDK_INT < 37 || context.getApplicationInfo().targetSdkVersion < 37
                    || context.checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") == android.content.pm.PackageManager.PERMISSION_GRANTED);
                boolean configured = false;
                try { configured = FixtureConfig.read(context).optBoolean("vehicleConversations", false); } catch (Exception unavailable) { }
                result.putBoolean("homeConversationConfigured", configured);
                result.putString("result", "Capability check only; microphone not started and no text shared.");
                finish(0, result); return;
            }
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
