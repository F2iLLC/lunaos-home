package io.github.f2illc.lunaos.home.vehicle;

/** Route observations are fresh inputs; readiness before a seek is never a grant. */
public final class VehiclePlaybackGate {
    public enum Decision { WAIT, SEEK, UNMUTE, STOP }
    private int state; // initial, seeking, rewound, audible, stopped
    public Decision observe(boolean selectedRoute, boolean expired) {
        if (state == 4) return Decision.STOP;
        if (!selectedRoute) return expired || state == 3 ? Decision.STOP : Decision.WAIT;
        if (state == 0) { state = 1; return Decision.SEEK; }
        return state == 2 ? Decision.UNMUTE : Decision.WAIT;
    }
    public void seekCompleted() { if (state == 1) state = 2; }
    public void started() { if (state != 2) throw new IllegalStateException(); state = 3; }
    public void stop() { state = 4; }
}
