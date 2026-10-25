package io.github.f2illc.lunaos.directtlsprobe;

import android.app.Instrumentation;
import android.os.Build;
import android.os.Bundle;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.CertificateFactory;
import java.util.ArrayDeque;
import javax.net.ssl.*;
import org.json.JSONObject;

final class SyntheticTlsClient implements AutoCloseable {
        // Fixed-purpose instrumentation barrier in this disposable test APK only.
        static volatile Runnable constructionCheckpoint;
        private void require(boolean value) throws IOException { if (!value) throw new IOException("Assertion failed"); }
        private SSLSocket socket;
        final InputStream input;
        private OutputStream output;
        private int sequence;
        private final ArrayDeque<JSONObject> approvals = new ArrayDeque<>();
        private final boolean versioned;
        SyntheticTlsClient(android.content.Context context, JSONObject config) throws Exception { this(context, config, "localhost", config.getString("hostFingerprint")); }
        SyntheticTlsClient(android.content.Context context, JSONObject config, String expectedName, String approvedPin) throws Exception {
            versioned = "versioned-edit-v1".equals(config.optString("experiment"));
            KeyStore keys = NativeIdentity.requireIdentity();
            KeyManagerFactory km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            km.init(keys, null);
            KeyStore trust = KeyStore.getInstance(KeyStore.getDefaultType()); trust.load(null);
            // The standalone probe packages this public CA as an asset. Home's
            // debug build receives the same public CA through its app-private
            // test provisioning channel after installation.
            InputStream ca = "io.github.f2illc.lunaos.directtlsprobe".equals(context.getPackageName())
                ? context.getAssets().open("ca.pem")
                : new FileInputStream(new File(context.getNoBackupFilesDir(), "ca.pem"));
            try (InputStream in = ca) { trust.setCertificateEntry("fixture-ca", CertificateFactory.getInstance("X.509").generateCertificate(in)); }
            TrustManagerFactory tm = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); tm.init(trust);
            SSLContext tls = SSLContext.getInstance("TLSv1.3"); tls.init(km.getKeyManagers(), tm.getTrustManagers(), new SecureRandom());
            Socket tcp = new Socket();
            try {
                // Only the disposable vehicle harness may use an explicit adb
                // reverse tunnel. Home's normal private-address policy is intact.
                String address = "io.github.f2illc.lunaos.home.vehicleprobe".equals(context.getPackageName())
                    && config.optBoolean("vehicleHarnessAdbReverse", false) ? "127.0.0.1" : FixtureConfig.transportAddress(config);
                tcp.connect(new InetSocketAddress(address, config.getInt("port")), 5000);
                socket = (SSLSocket) tls.getSocketFactory().createSocket(tcp, expectedName, config.getInt("port"), true);
                socket.setSoTimeout(15000); socket.setEnabledProtocols(new String[]{"TLSv1.3"});
                SSLParameters parameters = socket.getSSLParameters(); parameters.setEndpointIdentificationAlgorithm("HTTPS"); socket.setSSLParameters(parameters);
                socket.startHandshake(); require("TLSv1.3".equals(socket.getSession().getProtocol()));
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(socket.getSession().getPeerCertificates()[0].getEncoded());
                StringBuilder hex = new StringBuilder(); for (byte b : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
                if (!hex.toString().equals(approvedPin)) throw new SSLPeerUnverifiedException("Approved host differs");
                input = socket.getInputStream(); output = socket.getOutputStream();
                Runnable checkpoint = constructionCheckpoint; if (checkpoint != null) checkpoint.run();
            } catch (Exception failure) { if (socket != null) socket.close(); else tcp.close(); throw failure; }
        }
        private JSONObject receive() throws Exception {
            ByteArrayOutputStream line = new ByteArrayOutputStream(); int b;
            while ((b = input.read()) != '\n') { if (b == -1) throw new EOFException(); require(line.size() < 8192); line.write(b); }
            return new JSONObject(line.toString("UTF-8"));
        }
        private boolean receiveApproval(JSONObject message) throws Exception {
            if (!"approval".equals(message.optString("event"))) return false;
            require(approvals.size() < 8 && ("read-only".equals(message.getString("mode"))
                || (versioned && "edit".equals(message.getString("mode")))));
            require(message.getJSONArray("recordIds").length() == 1 && "alex-library".equals(message.getJSONArray("recordIds").getString(0)));
            require(VersionedEditState.validRevision(message.getString("grantId")));
            approvals.add(message); return true;
        }
        JSONObject call(JSONObject body) throws Exception {
            require(sequence < 128); int expected = ++sequence; body.put("seq", expected);
            byte[] bytes = (body.toString() + "\n").getBytes(StandardCharsets.UTF_8); require(bytes.length <= 8192); output.write(bytes); output.flush();
            for (;;) { JSONObject message = receive(); if (receiveApproval(message)) continue; require(message.getInt("seq") == expected); return message; }
        }
        String approval() throws Exception {
            return approval("read-only");
        }
        String approval(String mode) throws Exception {
            while (approvals.isEmpty()) require(receiveApproval(receive()));
            JSONObject message = approvals.remove();
            require(mode.equals(message.getString("mode")));
            return message.getString("grantId");
        }
        JSONObject execute(String grant, JSONObject request) throws Exception { return call(new JSONObject().put("op", "execute").put("grant", grant).put("request", request)); }
        void requirePresence(String grant) throws Exception {
            if (socket == null) throw new IOException("Connection closed");
            socket.setSoTimeout(2000);
            try { require(call(new JSONObject().put("op", "presence").put("grant", grant).put("recordId", "alex-library")).getBoolean("ok")); }
            finally { socket.setSoTimeout(15000); }
        }
        void denied(JSONObject result) throws Exception { require(!result.getBoolean("ok") && "DENIED".equals(result.getString("code"))); }
        JSONObject readRecord(String grant) throws Exception {
            require(!versioned);
            JSONObject result = execute(grant, new JSONObject().put("action", "read").put("recordId", "alex-library"));
            require(result.getBoolean("ok")); JSONObject record = result.getJSONObject("value");
            validateRecord(record);
            return record;
        }
        private void validateRecord(JSONObject record) throws Exception {
            require(record.length() == 3 && "alex-example".equals(record.getString("memberId")));
            require(record.get("label") instanceof String && record.get("value") instanceof String);
            require(record.getString("label").length() > 0 && record.getString("label").length() <= 80);
            require(record.getString("value").length() > 0 && record.getString("value").length() <= 240);
        }
        JSONObject readVersioned(String grant) throws Exception {
            require(versioned);
            JSONObject reply = execute(grant, new JSONObject().put("version", 2).put("action", "read").put("recordId", "alex-library"));
            require(reply.getBoolean("ok"));
            JSONObject value = reply.getJSONObject("value");
            require(value.length() == 4 && Integer.valueOf(2).equals(value.get("version")) && "alex-library".equals(value.getString("recordId"))
                && VersionedEditState.validRevision(value.getString("revision")));
            validateRecord(value.getJSONObject("data")); return value;
        }
        String editFriday(String grant, String expectedRevision) throws Exception {
            require(versioned && VersionedEditState.validRevision(expectedRevision));
            JSONObject data = new JSONObject().put("memberId", "alex-example").put("label", "Library visit").put("value", "Friday from phone");
            JSONObject reply = execute(grant, new JSONObject().put("version", 2).put("action", "edit")
                .put("recordId", "alex-library").put("expectedRevision", expectedRevision).put("data", data));
            if (!reply.getBoolean("ok")) {
                String code = reply.getString("code");
                require("CONFLICT".equals(code) || "WRITE_UNKNOWN".equals(code) || "DENIED".equals(code)); return code;
            }
            JSONObject receipt = reply.getJSONObject("value");
            require(receipt.length() == 5 && Integer.valueOf(2).equals(receipt.get("version")) && "alex-library".equals(receipt.getString("recordId"))
                && receipt.get("accessEnded") instanceof Boolean && "applied".equals(receipt.getString("status"))
                && VersionedEditState.validRevision(receipt.getString("revision")) && !expectedRevision.equals(receipt.getString("revision")));
            return receipt.getBoolean("accessEnded") ? "APPLIED_ENDED" : "APPLIED";
        }
        void readMonday(String grant) throws Exception {
            JSONObject record = readRecord(grant);
            require("Library visit".equals(record.getString("label")) && "Monday".equals(record.getString("value")));
        }
        @Override public void close() throws IOException { approvals.clear(); if (socket != null) socket.close(); }
    }
