package io.github.f2illc.lunaos.directtlsprobe;

import android.app.Activity;
import android.content.Intent;

/** Debug-only Home entry; no key or record content crosses the Tauri command. */
public final class HomeDirectEntry {
    private HomeDirectEntry() { }

    public static void prepareIdentity(Activity activity) throws Exception {
        if (!NativeIdentity.store().containsAlias(NativeIdentity.ALIAS)) NativeIdentity.create();
        NativeIdentity.inspect(activity);
    }

    public static void open(Activity activity) throws Exception {
        // Only an explicitly provisioned private test target may open on a
        // physical device. PairingActivity repeats this check on entry.
        if (!"ranchu".equals(android.os.Build.HARDWARE) && !FixtureConfig.approvedPhysicalTarget(activity))
            throw new IllegalStateException("Fictional private-network configuration required");
        NativeIdentity.requireIdentity();
        activity.startActivity(new Intent(activity, PairingActivity.class));
    }
}
