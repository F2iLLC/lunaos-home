package io.github.f2illc.lunaos.home.voiceprobe;

/** Structured command transport; no recognized text retained. */
final class TimerCommand {
    /**
     * "Stop", "turn it off", "cancel the alarm": silence every timer that is
     * ringing. With nothing ringing it means the one active timer, exactly
     * like "cancel the timer".
     */
    static final int STOP = -20;
    static int cancel(int target) { return -10 - target; }
    static int pause(int target) { return -30 - target; }
    static int resume(int target) { return -40 - target; }
    static boolean pauses(int value) { return value <= -30 && value >= -38; }
    static boolean resumes(int value) { return value <= -40 && value >= -48; }
    static int add(int target, int seconds) { return -(100000 + target * 10000 + seconds); }
    static boolean valid(int value) {
        // A new timer may run up to twenty four hours; adding time stays within an hour.
        return value > 0 && value <= 86400 || value <= -10 && value >= -18 || value == STOP || pauses(value) || resumes(value)
            || value <= -100001 && value >= -183600 && target(value) <= 8
                && duration(value) >= 1 && duration(value) <= 3600;
    }
    static int target(int value) {
        return value <= -100000 ? (-value - 100000) / 10000 : resumes(value) ? -value - 40 : pauses(value) ? -value - 30 : -value - 10;
    }
    static int duration(int value) { return (-value - 100000) % 10000; }
    // Every way to say "make it stop". "turn" and "shut" also take the split
    // form: "turn the timer off".
    private static final String[] STOP_VERBS = {"cancel", "stop", "end", "turn off", "shut off"};
    private static final String[] SPLIT_VERBS = {"turn", "shut"};
    private static final String[] STOP_ALONE = {"stop", "cancel", "stop it", "turn it off", "shut it off",
        "okay stop", "luna stop"};
    private static final String[] UNNAMED = {"the timer", "the alarm", "timer", "alarm", "that timer", "that alarm",
        "my timer", "the timers", "the alarms"};
    // Pausing is only ever about a timer, never an alarm that is ringing.
    private static final String[] PAUSE_VERBS = {"pause", "hold"}, RESUME_VERBS = {"resume", "continue"};
    private static final String[] HELD_UNNAMED = {"the timer", "timer", "that timer", "my timer", "it"};
    private static int held(String bare, String[] verbs, boolean resume) {
        for (String verb : verbs) {
            if (bare.equals(verb) && verb.equals(verbs[0])) return resume ? resume(0) : pause(0);
            for (String object : HELD_UNNAMED) if (bare.equals(verb + " " + object)) return resume ? resume(0) : pause(0);
            for (int target = 1; target <= 8; target++)
                if (bare.equals(verb + " timer " + TimerPhrase.number(target)) || bare.equals(verb + " timer " + target))
                    return resume ? resume(target) : pause(target);
        }
        return 0;
    }
    private static boolean stops(String bare, String object) {
        for (String verb : STOP_VERBS) if (bare.equals(verb + " " + object)) return true;
        for (String verb : SPLIT_VERBS) if (bare.equals(verb + " " + object + " off")) return true;
        return false;
    }
    /** STOP when the words ask for silence without naming a numbered timer; otherwise 0. */
    static int stop(String text) {
        if (text == null) return 0;
        String bare = TimerPhrase.normalizeCommand(text);
        for (String alone : STOP_ALONE) if (bare.equals(alone)) return STOP;
        for (String object : UNNAMED) if (stops(bare, object)) return STOP;
        return 0;
    }
    static int parse(String text) {
        if (text == null) return 0;
        String bare = TimerPhrase.normalizeCommand(text);
        int seconds = TimerPhrase.commandSeconds(text);
        if (seconds > 0) return seconds;
        if (stop(text) == STOP) return STOP;
        int held = held(bare, PAUSE_VERBS, false);
        if (held == 0) held = held(bare, RESUME_VERBS, true);
        if (held != 0) return held;
        for (int target = 0; target <= 8; target++) {
            String[] names = target == 0 ? new String[] {"the timer"}
                : new String[] {"timer " + TimerPhrase.number(target), "timer " + target};
            for (String timer : names) {
                if (target > 0 && stops(bare, timer)) return cancel(target);
                String suffix = " to " + timer;
                if (bare.startsWith("add ") && bare.endsWith(suffix) && bare.length() > 4 + suffix.length()) {
                    int duration = TimerPhrase.durationSeconds(bare.substring(4, bare.length() - suffix.length()));
                    if (duration > 0 && duration <= 3600) return add(target, duration);
                }
            }
        }
        return 0;
    }
    static void grammar(StringBuilder out) {
        for (int n = 1; n <= 60; n++) {
            phrase(out, "set another timer for " + TimerPhrase.number(n) + (n == 1 ? " second" : " seconds"));
            phrase(out, "set another timer for " + TimerPhrase.number(n) + (n == 1 ? " minute" : " minutes"));
        }
        for (String alone : STOP_ALONE) {
            phrase(out, alone);
            if (!alone.startsWith("luna ")) phrase(out, "hey luna " + alone);
        }
        for (String object : UNNAMED) stopPhrases(out, object);
        for (String[] verbs : new String[][] {PAUSE_VERBS, RESUME_VERBS}) {
            phrase(out, verbs[0]);
            for (String verb : verbs) {
                for (String object : HELD_UNNAMED) phrase(out, verb + " " + object);
                for (int target = 1; target <= 8; target++) phrase(out, verb + " timer " + TimerPhrase.number(target));
            }
        }
        for (int target = 0; target <= 8; target++) {
            String timer = target == 0 ? "the timer" : "timer " + TimerPhrase.number(target);
            if (target > 0) stopPhrases(out, timer);
            for (int n = 1; n <= 60; n++) {
                phrase(out, "add " + TimerPhrase.number(n) + (n == 1 ? " second to " : " seconds to ") + timer);
                phrase(out, "add " + TimerPhrase.number(n) + (n == 1 ? " minute to " : " minutes to ") + timer);
            }
        }
    }
    private static void stopPhrases(StringBuilder out, String object) {
        for (String verb : STOP_VERBS) phrase(out, verb + " " + object);
        for (String verb : SPLIT_VERBS) phrase(out, verb + " " + object + " off");
    }
    private static void phrase(StringBuilder out, String value) { out.append(",\"").append(value).append('"'); }
}
