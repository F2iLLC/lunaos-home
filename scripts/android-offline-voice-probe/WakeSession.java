package io.github.f2illc.lunaos.home.voiceprobe;

/** One wake/command exchange. Final results only; no text or audio retained. */
public final class WakeSession {
    public static final long WAIT_MS = 300000;
    public static final long COMMAND_MS = 25000;
    /** A phrase still being heard must read the same on this many checks in a row. */
    public static final int PARTIAL_REPEATS = 3;
    public static final int NONE = 0, WAKE = -1;
    private final long end;
    private long deadline;
    private boolean awake, finished, timerAttempted;
    private String steady;
    private int repeats;

    public WakeSession(long now) { this(now, false); }
    public WakeSession(long now, boolean persistent) {
        end = persistent ? Long.MAX_VALUE : now + WAIT_MS;
        deadline = end;
    }
    // Only the service may start this after successful playback of a question.
    void beginFollowUp(long now) {
        if (awake || finished || expired(now)) return;
        awake = true; deadline = Math.min(end, now + COMMAND_MS);
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
    /**
     * A ringing alarm fills the room, so the recognizer may never hear the pause
     * that ends an utterance and never produce a final result. While a timer is
     * ringing the words still being heard are therefore checked too. Only the
     * wake phrase or a plain request for silence counts, only as the last thing
     * heard, and only once it has read the same way on consecutive checks.
     */
    public int acceptPartial(String partial, long now, boolean ringing) {
        String tail = ringing && !awake && !expired(now) ? tail(partial) : "";
        boolean wakePhrase = "hey luna".equals(tail);
        if (!wakePhrase && TimerCommand.stop(tail) != TimerCommand.STOP) { steady = null; repeats = 0; return NONE; }
        if (!tail.equals(steady)) { steady = tail; repeats = 1; return NONE; }
        if (++repeats < PARTIAL_REPEATS) return NONE;
        steady = null; repeats = 0;
        if (!wakePhrase) { finished = true; return TimerCommand.STOP; }
        awake = true;
        deadline = Math.min(end, now + COMMAND_MS);
        return WAKE;
    }
    /** The words after the last sound the recognizer could not place. */
    static String tail(String partial) {
        if (partial == null) return "";
        int unknown = partial.lastIndexOf("[unk]");
        return (unknown < 0 ? partial : partial.substring(unknown + 5)).trim();
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
