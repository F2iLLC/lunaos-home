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
        private final ArrayDeque<String> approvals = new ArrayDeque<>();
        SyntheticTlsClient(android.content.Context context, JSONObject config) throws Exception { this(context, config, "localhost", config.getString("hostFingerprint")); }
        SyntheticTlsClient(android.content.Context context, JSONObject config, String expectedName, String approvedPin) throws Exception {
            KeyStore keys = NativeIdentity.requireIdentity();
            KeyManagerFactory km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            km.init(keys, null);
            KeyStore trust = KeyStore.getInstance(KeyStore.getDefaultType()); trust.load(null);
            try (InputStream in = context.getAssets().open("ca.pem")) { trust.setCertificateEntry("fixture-ca", CertificateFactory.getInstance("X.509").generateCertificate(in)); }
            TrustManagerFactory tm = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); tm.init(trust);
            SSLContext tls = SSLContext.getInstance("TLSv1.3"); tls.init(km.getKeyManagers(), tm.getTrustManagers(), new SecureRandom());
            Socket tcp = new Socket();
            try {
                tcp.connect(new InetSocketAddress(FixtureConfig.transportAddress(config), config.getInt("port")), 5000);
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
            require(approvals.size() < 8 && "read-only".equals(message.getString("mode")));
            require(message.getJSONArray("recordIds").length() == 1 && "alex-library".equals(message.getJSONArray("recordIds").getString(0)));
            approvals.add(message.getString("grantId")); return true;
        }
        JSONObject call(JSONObject body) throws Exception {
            require(sequence < 20); int expected = ++sequence; body.put("seq", expected);
            byte[] bytes = (body.toString() + "\n").getBytes(StandardCharsets.UTF_8); require(bytes.length <= 8192); output.write(bytes); output.flush();
            for (;;) { JSONObject message = receive(); if (receiveApproval(message)) continue; require(message.getInt("seq") == expected); return message; }
        }
        String approval() throws Exception {
            while (approvals.isEmpty()) require(receiveApproval(receive()));
            return approvals.remove();
        }
        JSONObject execute(String grant, JSONObject request) throws Exception { return call(new JSONObject().put("op", "execute").put("grant", grant).put("request", request)); }
        void denied(JSONObject result) throws Exception { require(!result.getBoolean("ok") && "DENIED".equals(result.getString("code"))); }
        JSONObject readRecord(String grant) throws Exception {
            JSONObject result = execute(grant, new JSONObject().put("action", "read").put("recordId", "alex-library"));
            require(result.getBoolean("ok")); JSONObject record = result.getJSONObject("value");
            require(record.length() == 3 && "alex-example".equals(record.getString("memberId")));
            require(record.getString("label").length() > 0 && record.getString("label").length() <= 80);
            require(record.getString("value").length() > 0 && record.getString("value").length() <= 240);
            return record;
        }
        void readMonday(String grant) throws Exception {
            JSONObject record = readRecord(grant);
            require("Library visit".equals(record.getString("label")) && "Monday".equals(record.getString("value")));
        }
        @Override public void close() throws IOException { approvals.clear(); if (socket != null) socket.close(); }
    }
