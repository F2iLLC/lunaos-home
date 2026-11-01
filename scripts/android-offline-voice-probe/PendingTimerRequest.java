package io.github.f2illc.lunaos.home.voiceprobe;

/** Memory-only, one-use request. A new session, Stop or blocked access revokes it. */
final class PendingTimerRequest {
    static final long TTL_MS = 60000;
    private int seconds;
    private long expires;
    void offer(int value, long now) {
        clear();
        if (value >= 1 && value <= 3600) { seconds = value; expires = now + TTL_MS; }
    }
    int peek(long now, boolean allowed) {
        if (!allowed || now >= expires) clear();
        return seconds;
    }
    int claim(long now, boolean allowed) {
        int value = peek(now, allowed);
        clear();
        return value;
    }
    void clear() { seconds = 0; expires = 0; }
}
