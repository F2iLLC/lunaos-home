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
        String bare = TimerPhrase.normalizeCommand(text);
        int seconds = TimerPhrase.commandSeconds(text);
        if (seconds > 0) return seconds;
        for (int target = 0; target <= 8; target++) {
            String[] names = target == 0 ? new String[] {"the timer"}
                : new String[] {"timer " + TimerPhrase.number(target), "timer " + target};
            for (String timer : names) {
                if (bare.equals("cancel " + timer)) return cancel(target);
                String suffix = " to " + timer;
                if (bare.startsWith("add ") && bare.endsWith(suffix) && bare.length() > 4 + suffix.length()) {
                    int duration = TimerPhrase.durationSeconds(bare.substring(4, bare.length() - suffix.length()));
                    if (duration > 0) return add(target, duration);
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
