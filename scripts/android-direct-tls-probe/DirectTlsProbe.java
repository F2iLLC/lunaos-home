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

/** Disposable emulator-only interop test, never an app enrollment or unlock implementation. */
public final class DirectTlsProbe extends Instrumentation {
    private JSONObject config;
    private String phase = "initialization";
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    private void require(boolean value) throws IOException { if (!value) throw new IOException("Assertion failed"); }
    private InputStream asset(String name) throws IOException { return getContext().getAssets().open(name); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            require("ranchu".equals(Build.HARDWARE));
            try (InputStream in = asset("config.json")) {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] chunk = new byte[1024]; int n;
                while ((n = in.read(chunk)) != -1) { bytes.write(chunk, 0, n); require(bytes.size() <= 8192); }
                config = new JSONObject(bytes.toString("UTF-8"));
            }
            phase = "host-identity-rejection";
            boolean rejected = false;
            try (Client wrongHost = new Client("wrong-host.invalid", config.getString("hostFingerprint"))) { }
            catch (SSLHandshakeException expected) { rejected = true; }
            require(rejected); rejected = false;
            try (Client wrongPin = new Client("localhost", "0000000000000000000000000000000000000000000000000000000000000000")) { }
            catch (SSLPeerUnverifiedException expected) { rejected = true; }
            require(rejected);
            String oldGrant, firstConnection;
            phase = "pair-and-read";
            try (Client first = new Client()) {
                JSONObject paired = first.call(new JSONObject().put("op", "pair").put("offer", config.getString("offer")));
                require(paired.getBoolean("ok"));
                firstConnection = paired.getJSONObject("value").getString("connectionId");
                oldGrant = first.approval();
                first.readMonday(oldGrant);
            }
            phase = "reconnect-and-stale-grant";
            try (Client second = new Client()) {
                JSONObject resumed = second.call(new JSONObject().put("op", "resume"));
                require(resumed.getBoolean("ok"));
                require(!firstConnection.equals(resumed.getJSONObject("value").getString("connectionId")));
                second.denied(second.execute(oldGrant, new JSONObject().put("action", "read").put("recordId", "alex-library")));
                String fresh = second.approval(); require(!fresh.equals(oldGrant));
                second.readMonday(fresh);
                phase = "read-only-and-revocation";
                second.denied(second.execute(fresh, new JSONObject().put("action", "edit").put("recordId", "alex-library")
                    .put("data", new JSONObject().put("memberId", "alex-example").put("label", "Library visit").put("value", "Wednesday"))));
                // Host revokes after observing the second read. A timeout is a failure, not proof of closure.
                require(second.input.read() == -1);
            }
            phase = "revoked-reconnect";
            try (Client third = new Client()) { third.denied(third.call(new JSONObject().put("op", "resume"))); }
            result.putString("result", "PASS: Android TLS1.3; wrong host name and pin rejected; paired read; fresh reconnect approval; stale grant denied; read-only edit denied; peer revocation closes connection and denies reconnect.");
            finish(-1, result);
        } catch (Exception error) {
            // Never print keys, offers, certificates, record contents or TLS diagnostics.
            result.putString("result", "FAIL at " + phase + " (" + error.getClass().getSimpleName() + ")");
            finish(0, result);
        }
    }

    private final class Client implements AutoCloseable {
        private SSLSocket socket;
        private InputStream input;
        private OutputStream output;
        private int sequence;
        private final ArrayDeque<String> approvals = new ArrayDeque<>();
        Client() throws Exception { this("localhost", config.getString("hostFingerprint")); }
        Client(String expectedName, String approvedPin) throws Exception {
            KeyStore keys = KeyStore.getInstance("PKCS12");
            try (InputStream in = asset("phone.p12")) { keys.load(in, "fictional-only".toCharArray()); }
            KeyManagerFactory km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            km.init(keys, "fictional-only".toCharArray());
            KeyStore trust = KeyStore.getInstance(KeyStore.getDefaultType()); trust.load(null);
            try (InputStream in = asset("ca.pem")) { trust.setCertificateEntry("fixture-ca", CertificateFactory.getInstance("X.509").generateCertificate(in)); }
            TrustManagerFactory tm = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); tm.init(trust);
            SSLContext tls = SSLContext.getInstance("TLSv1.3"); tls.init(km.getKeyManagers(), tm.getTrustManagers(), new SecureRandom());
            Socket tcp = new Socket();
            try {
                tcp.connect(new InetSocketAddress("10.0.2.2", config.getInt("port")), 5000);
                socket = (SSLSocket) tls.getSocketFactory().createSocket(tcp, expectedName, config.getInt("port"), true);
                socket.setSoTimeout(15000); socket.setEnabledProtocols(new String[]{"TLSv1.3"});
                SSLParameters parameters = socket.getSSLParameters(); parameters.setEndpointIdentificationAlgorithm("HTTPS"); socket.setSSLParameters(parameters);
                socket.startHandshake(); require("TLSv1.3".equals(socket.getSession().getProtocol()));
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(socket.getSession().getPeerCertificates()[0].getEncoded());
                StringBuilder hex = new StringBuilder(); for (byte b : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
                if (!hex.toString().equals(approvedPin)) throw new SSLPeerUnverifiedException("Approved host differs");
                input = socket.getInputStream(); output = socket.getOutputStream();
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
        void readMonday(String grant) throws Exception {
            JSONObject result = execute(grant, new JSONObject().put("action", "read").put("recordId", "alex-library"));
            require(result.getBoolean("ok")); JSONObject record = result.getJSONObject("value");
            require("alex-example".equals(record.getString("memberId")) && "Library visit".equals(record.getString("label")) && "Monday".equals(record.getString("value")));
        }
        @Override public void close() throws IOException { approvals.clear(); if (socket != null) socket.close(); }
    }
}
