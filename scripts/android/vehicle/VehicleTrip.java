package io.github.f2illc.lunaos.home.vehicle;

import java.util.UUID;

/** Pure state machine. Persist before audio; uncertainty suppresses replay. */
public final class VehicleTrip {
    public static final long GRACE_MS = 120_000;
    public String id = "";
    public long disconnectedAt = -1;
    public int boot;
    public int sequence;
    public boolean claimed;

    public boolean connect(long now, int currentBoot) {
        boolean fresh = id.isEmpty() || (disconnectedAt >= 0 &&
            (boot != currentBoot || now < disconnectedAt || now - disconnectedAt >= GRACE_MS));
        if (fresh) { id = UUID.randomUUID().toString(); claimed = false; sequence = 0; }
        boot = currentBoot; disconnectedAt = -1;
        return fresh;
    }
    public void disconnect(long now, int currentBoot) {
        if (!id.isEmpty() && disconnectedAt < 0) { disconnectedAt = now; boot = currentBoot; }
    }
    public boolean claim() {
        if (id.isEmpty() || disconnectedAt >= 0 || claimed) return false;
        claimed = true; return true;
    }
    public boolean ended(long now, int currentBoot) {
        return !id.isEmpty() && disconnectedAt >= 0 &&
            (boot != currentBoot || now < disconnectedAt || now - disconnectedAt >= GRACE_MS);
    }
}
