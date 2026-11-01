package io.github.f2illc.lunaos.home.voiceprobe;

/** Deliberately narrow, complete-utterance parser. No transcript retention. */
public final class TimerPhrase {
    private TimerPhrase() {}
    static String number(int n) {
        String[] small = {"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
            "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"};
        String[] tens = {"", "", "twenty", "thirty", "forty", "fifty", "sixty"};
        return n < 20 ? small[n] : tens[n / 10] + (n % 10 == 0 ? "" : " " + small[n % 10]);
    }
    public static int seconds(String text) {
        if (text == null) return 0;
        for (int n = 1; n <= 60; n++) {
            String prefix = "hey luna set a timer for " + number(n);
            if (text.equals(prefix + (n == 1 ? " second" : " seconds"))) return n;
            if (text.equals(prefix + (n == 1 ? " minute" : " minutes"))) return n * 60;
        }
        return 0;
    }
    public static int commandSeconds(String text) {
        if (text == null) return 0;
        return text.startsWith("set a timer for ") ? seconds("hey luna " + text) : seconds(text);
    }
    /** Fixed diagnostic categories only; never return recognized speech. */
    public static String commandDiagnostic(String text) {
        if (text == null || text.trim().isEmpty()) return "NO_SPEECH";
        if (text.contains("[unk]")) return "UNCLEAR_SPEECH";
        if (commandSeconds(text) > 0) return "SUPPORTED_TIMER";
        if (text.equals("hey luna")) return "WAKE_ONLY";
        if (text.contains("timer")) return "INCOMPLETE_TIMER_PHRASE";
        return "OTHER_SPEECH";
    }
    /** Structural rejection codes only. Never repairs text or authorizes a timer. */
    public static String commandDetail(String text) {
        String category = commandDiagnostic(text);
        if (!"INCOMPLETE_TIMER_PHRASE".equals(category)) return category;
        String bare = text.startsWith("hey luna ") ? text.substring(9) : text;
        String prefix = "set a timer for ";
        if (bare.equals("set a timer for")) return "MISSING_DURATION_AND_UNIT";
        if (bare.startsWith("set timer for ")
                && commandSeconds(prefix + bare.substring(14)) > 0) return "MISSING_ARTICLE";
        for (String unit : new String[] {"second", "seconds", "minute", "minutes"}) {
            if (bare.equals(prefix + unit)) return "MISSING_DURATION";
        }
        for (int n = 1; n <= 60; n++) {
            String stem = prefix + number(n);
            if (bare.equals(stem)) return "MISSING_UNIT";
            if (bare.equals(stem + (n == 1 ? " seconds" : " second"))
                    || bare.equals(stem + (n == 1 ? " minutes" : " minute")))
                return "UNIT_NUMBER_MISMATCH";
            for (String unit : new String[] {n == 1 ? " second" : " seconds", n == 1 ? " minute" : " minutes"}) {
                if (bare.startsWith(stem + unit + " ")) return "EXTRA_WORDS_AFTER_TIMER";
            }
        }
        return "TIMER_WORDING_MISMATCH";
    }
    public static String grammar() { return grammar(false); }
    public static String commandGrammar() { return grammar(true); }
    private static String grammar(boolean command) {
        StringBuilder out = new StringBuilder("[\"[unk]\",\"hey luna\"");
        for (int n = 1; n <= 60; n++) {
            String prefix = ",\"hey luna set a timer for " + number(n);
            out.append(prefix).append(n == 1 ? " second\"" : " seconds\"");
            out.append(prefix).append(n == 1 ? " minute\"" : " minutes\"");
            if (command) {
                String bare = ",\"set a timer for " + number(n);
                out.append(bare).append(n == 1 ? " second\"" : " seconds\"");
                out.append(bare).append(n == 1 ? " minute\"" : " minutes\"");
            }
        }
        return out.append(']').toString();
    }
}
