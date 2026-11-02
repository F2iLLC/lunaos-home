package io.github.f2illc.lunaos.home.voiceprobe;

/** Structured command transport; no recognized text retained. */
final class TimerCommand {
    static int cancel(int target) { return -10 - target; }
    static int add(int target, int seconds) { return -(100000 + target * 10000 + seconds); }
    static boolean valid(int value) {
        return value > 0 && value <= 3600 || value <= -10 && value >= -18
            || value <= -100001 && value >= -183600 && target(value) <= 8
                && duration(value) >= 1 && duration(value) <= 3600;
    }
    static int target(int value) { return value <= -100000 ? (-value - 100000) / 10000 : -value - 10; }
    static int duration(int value) { return (-value - 100000) % 10000; }
    static int parse(String text) {
        if (text == null) return 0;
        String bare = text.startsWith("hey luna ") ? text.substring(9) : text;
        int seconds = TimerPhrase.commandSeconds(text);
        if (seconds > 0) return seconds;
        if (bare.startsWith("set another timer for "))
            return TimerPhrase.commandSeconds("set a timer for " + bare.substring(22));
        for (int target = 0; target <= 8; target++) {
            String timer = target == 0 ? "the timer" : "timer " + TimerPhrase.number(target);
            if (bare.equals("cancel " + timer)) return cancel(target);
            for (int n = 1; n <= 60; n++) {
                if (bare.equals("add " + TimerPhrase.number(n) + (n == 1 ? " second to " : " seconds to ") + timer)) return add(target, n);
                if (bare.equals("add " + TimerPhrase.number(n) + (n == 1 ? " minute to " : " minutes to ") + timer)) return add(target, n * 60);
            }
        }
        return 0;
    }
    static void grammar(StringBuilder out) {
        for (int n = 1; n <= 60; n++) {
            phrase(out, "set another timer for " + TimerPhrase.number(n) + (n == 1 ? " second" : " seconds"));
            phrase(out, "set another timer for " + TimerPhrase.number(n) + (n == 1 ? " minute" : " minutes"));
        }
        for (int target = 0; target <= 8; target++) {
            String timer = target == 0 ? "the timer" : "timer " + TimerPhrase.number(target);
            phrase(out, "cancel " + timer);
            for (int n = 1; n <= 60; n++) {
                phrase(out, "add " + TimerPhrase.number(n) + (n == 1 ? " second to " : " seconds to ") + timer);
                phrase(out, "add " + TimerPhrase.number(n) + (n == 1 ? " minute to " : " minutes to ") + timer);
            }
        }
    }
    private static void phrase(StringBuilder out, String value) { out.append(",\"").append(value).append('"'); }
}
