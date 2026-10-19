package io.github.f2illc.lunaos.directtlsprobe;

import android.app.Instrumentation;
import android.os.*;
import java.io.*;
import java.security.KeyStoreException;
import javax.net.ssl.SSLException;
import org.json.JSONObject;

public final class IdentityProbe extends Instrumentation {
    private String action;
    @Override public void onCreate(Bundle args) { super.onCreate(args); action = args.getString("action", "inspect"); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            if (!"ranchu".equals(Build.HARDWARE) || Build.VERSION.SDK_INT != 36) throw new IllegalStateException("Dedicated API36 emulator required");
            if ("create".equals(action)) NativeIdentity.create();
            else if ("reject-replace".equals(action)) {
                boolean rejected = false;
                try { NativeIdentity.create(); } catch (KeyStoreException expected) { rejected = true; }
                if (!rejected) throw new IllegalStateException("Existing identity replaced");
            }
            else if ("remove".equals(action)) {
                NativeIdentity.remove();
                if (NativeIdentity.store().containsAlias(NativeIdentity.ALIAS)) throw new IllegalStateException("Removal failed");
                result.putString("result", "PASS: identity removed"); finish(-1, result); return;
            } else if ("reject-missing".equals(action)) {
                boolean rejected = false;
                try (SyntheticTlsClient client = new SyntheticTlsClient(getContext(), FixtureConfig.read(getContext()))) { }
                catch (KeyStoreException expected) { rejected = true; }
                if (!rejected || NativeIdentity.store().containsAlias(NativeIdentity.ALIAS)) throw new IllegalStateException("Missing identity not rejected");
                result.putString("result", "PASS: missing identity denied; no automatic recreation"); finish(-1, result); return;
            } else if ("reject-unenrolled".equals(action)) {
                boolean rejected = false;
                try (SyntheticTlsClient client = new SyntheticTlsClient(getContext(), FixtureConfig.read(getContext()))) {
                    JSONObject response = client.call(new JSONObject().put("op", "resume"));
                    rejected = !response.getBoolean("ok") && "DENIED".equals(response.optString("code"));
                } catch (SSLException | EOFException expected) { rejected = true; }
                if (!rejected) throw new IllegalStateException("Unenrolled identity admitted");
                result.putString("result", "PASS: replacement identity denied before new enrollment"); finish(-1, result); return;
            } else if (!"inspect".equals(action)) throw new IllegalArgumentException("Unsupported test action");
            result.putString("identity", NativeIdentity.inspect(getContext()).toString());
            result.putString("result", "PASS: device-generated identity inspected; public certificate exported"); finish(-1, result);
        } catch (Exception error) {
            result.putString("result", "FAIL: identity " + action + " (" + error.getClass().getSimpleName() + ")"); finish(0, result);
        }
    }
}
