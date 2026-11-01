package io.github.f2illc.lunaos.home.voiceprobe;

/** One wake/command exchange. Final results only; no text or audio retained. */
public final class WakeSession {
    public static final long WAIT_MS = 300000;
    public static final long COMMAND_MS = 10000;
    public static final int NONE = 0, WAKE = -1;
    private final long end;
    private long deadline;
    private boolean awake, finished;

    public WakeSession(long now) { this(now, false); }
    public WakeSession(long now, boolean persistent) {
        end = persistent ? Long.MAX_VALUE : now + WAIT_MS;
        deadline = end;
    }
    public boolean awaitingCommand() { return awake; }
    public long deadline() { return deadline; }
    public boolean expired(long now) { return finished || now >= deadline; }
    public int acceptFinal(String text, long now) {
        if (expired(now)) { finished = true; return NONE; }
        if (!awake) {
            if (!"hey luna".equals(text)) return NONE;
            awake = true;
            deadline = Math.min(end, now + COMMAND_MS);
            return WAKE;
        }
        int seconds = TimerPhrase.commandSeconds(text);
        if (seconds > 0) finished = true;
        return seconds;
    }
    public static String grammar() { return "[\"[unk]\",\"hey luna\"]"; }
}
