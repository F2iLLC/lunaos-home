package io.github.f2illc.lunaos.directtlsprobe;

import android.app.Activity;
import android.content.Intent;
import java.io.File;
import java.io.IOException;
import java.security.cert.CertificateExpiredException;

/** Debug-only Home entry; no key or record content crosses the Tauri command. */
public final class HomeDirectEntry {
    private HomeDirectEntry() { }

    public static void prepareIdentity(Activity activity) throws Exception {
        if (!NativeIdentity.store().containsAlias(NativeIdentity.ALIAS)) NativeIdentity.create();
        try { NativeIdentity.inspect(activity); }
        catch (CertificateExpiredException expired) {
            // This explicit preparation action renews only an expired debug
            // transport identity. A new fingerprint needs a new host pairing.
            File config = new File(activity.getNoBackupFilesDir(), "config.json");
            if (config.exists() && !config.delete()) throw new IOException("Cannot clear old fictional pairing");
            File publicCert = new File(activity.getNoBackupFilesDir(), "client-public.pem");
            if (publicCert.exists() && !publicCert.delete()) throw new IOException("Cannot clear old fictional certificate");
            NativeIdentity.remove();
            NativeIdentity.create();
            NativeIdentity.inspect(activity);
        }
    }

    public static void open(Activity activity) throws Exception {
        // Only an explicitly provisioned private test target may open on a
        // physical device. PairingActivity repeats this check on entry.
        if (!"ranchu".equals(android.os.Build.HARDWARE) && !FixtureConfig.approvedPhysicalTarget(activity))
            throw new IllegalStateException("Fictional private-network configuration required");
        NativeIdentity.inspect(activity); // Refuse expiry; never rotate on Open.
        activity.startActivity(new Intent(activity, PairingActivity.class));
    }
}
