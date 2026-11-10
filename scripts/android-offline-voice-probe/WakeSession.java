package io.github.f2illc.lunaos.home.voiceprobe;

/** One wake/command exchange. Final results only; no text or audio retained. */
public final class WakeSession {
    public static final long WAIT_MS = 300000;
    public static final long COMMAND_MS = 15000;
    public static final int NONE = 0, WAKE = -1;
    private final long end;
    private long deadline;
    private boolean awake, finished, timerAttempted;

    public WakeSession(long now) { this(now, false); }
    public WakeSession(long now, boolean persistent) {
        end = persistent ? Long.MAX_VALUE : now + WAIT_MS;
        deadline = end;
    }
    public boolean awaitingCommand() { return awake; }
    public long deadline() { return deadline; }
    public boolean expired(long now) { return finished || now >= deadline; }
    public int acceptFinal(String text, long now) { return acceptFinal(text, now, false); }
    /**
     * While a timer is ringing, a plain request for silence ("stop", "luna stop",
     * "turn it off") is honored without the wake phrase: nobody should have to
     * hold a conversation with an alarm. It can do nothing else.
     */
    public int acceptFinal(String text, long now, boolean ringing) {
        if (expired(now)) { finished = true; return NONE; }
        if (!awake) {
            if (ringing && TimerCommand.stop(text) == TimerCommand.STOP) { finished = true; return TimerCommand.STOP; }
            if (!"hey luna".equals(text)) return NONE;
            awake = true;
            deadline = Math.min(end, now + COMMAND_MS);
            return WAKE;
        }
        int seconds = TimerCommand.parse(text);
        if (QuestionPolicy.timerAttempt(text)) timerAttempted = true;
        if (TimerCommand.valid(seconds)) finished = true;
        return seconds;
    }
    /** Capture has ended; allow bounded local decoding of the captured command. */
    public void decodeUntil(long until) {
        if (awake && !finished) deadline = Math.min(end, until);
    }
    public boolean acceptQuestion(String text, long now) {
        if (!awake || expired(now) || timerAttempted || !QuestionPolicy.accepts(text)) return false;
        finished = true;
        return true;
    }
    public static String grammar() { return "[\"[unk]\",\"hey luna\"]"; }
}
