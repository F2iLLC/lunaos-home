package io.github.f2illc.lunaos.home.voiceprobe;

/** Per-session authorization; never persisted or replayed on activity recreation. */
public final class TimerHandoffGate {
    private final boolean enabledAtStart;
    private boolean claimed;
    public TimerHandoffGate(boolean enabledAtStart) { this.enabledAtStart = enabledAtStart; }
    public boolean claim(boolean enabledNow, boolean foregroundAllowed, int seconds) {
        if (!enabledAtStart || !enabledNow || !foregroundAllowed || claimed || seconds < 1 || seconds > 3600) return false;
        claimed = true; // Claim before resolving/launching Clock. Uncertain launch is never retried.
        return true;
    }
}
