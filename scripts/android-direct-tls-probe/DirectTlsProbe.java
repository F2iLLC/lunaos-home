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

/** Disposable interop test, never an app enrollment or unlock implementation. */
public final class DirectTlsProbe extends Instrumentation {
    private JSONObject config;
    private String phase = "initialization";
    private String action;
    @Override public void onCreate(Bundle args) { super.onCreate(args); action = args.getString("action", "full"); start(); }
    private void require(boolean value) throws IOException { if (!value) throw new IOException("Assertion failed"); }
    private InputStream asset(String name) throws IOException { return getContext().getAssets().open(name); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            boolean fullEmulator = "full".equals(action) && "ranchu".equals(Build.HARDWARE);
            boolean selectedPhysical = "host-rejection".equals(action) &&
                FixtureConfig.approvedPhysicalTarget(getContext());
            require(fullEmulator || selectedPhysical);
            config = FixtureConfig.read(getContext());
            phase = "host-identity-rejection";
            boolean rejected = false;
            try (SyntheticTlsClient wrongHost = new SyntheticTlsClient(getContext(), config, "wrong-host.invalid", config.getString("hostFingerprint"))) { }
            catch (SSLHandshakeException expected) { rejected = true; }
            require(rejected); rejected = false;
            try (SyntheticTlsClient wrongPin = new SyntheticTlsClient(getContext(), config, "localhost", "0000000000000000000000000000000000000000000000000000000000000000")) { }
            catch (SSLPeerUnverifiedException expected) { rejected = true; }
            require(rejected);
            if (selectedPhysical) {
                result.putString("result", "PASS: selected physical Android rejected wrong TLS host name and host fingerprint.");
                finish(-1, result); return;
            }
            String oldGrant, firstConnection;
            phase = "pair-and-read";
            try (SyntheticTlsClient first = new SyntheticTlsClient(getContext(), config)) {
                JSONObject paired = first.call(new JSONObject().put("op", "pair").put("offer", config.getString("offer")));
                require(paired.getBoolean("ok"));
                firstConnection = paired.getJSONObject("value").getString("connectionId");
                oldGrant = first.approval();
                first.readMonday(oldGrant);
            }
            phase = "reconnect-and-stale-grant";
            try (SyntheticTlsClient second = new SyntheticTlsClient(getContext(), config)) {
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
            try (SyntheticTlsClient third = new SyntheticTlsClient(getContext(), config)) { third.denied(third.call(new JSONObject().put("op", "resume"))); }
            result.putString("result", "PASS: Android TLS1.3; wrong host name and pin rejected; paired read; fresh reconnect approval; stale grant denied; read-only edit denied; peer revocation closes connection and denies reconnect.");
            finish(-1, result);
        } catch (Exception error) {
            // Never print keys, offers, certificates, record contents or TLS diagnostics.
            result.putString("result", "FAIL at " + phase + " (" + error.getClass().getSimpleName() + ")");
            finish(0, result);
        }
    }

}
