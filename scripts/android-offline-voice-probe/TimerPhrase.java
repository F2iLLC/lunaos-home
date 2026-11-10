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
    static String normalizeCommand(String text) {
        if (text == null || text.length() > 1000) return "";
        for (int i = 0; i < text.length(); i++) if (Character.isISOControl(text.charAt(i))) return "";
        String normalized = text.toLowerCase(java.util.Locale.ROOT).trim()
            .replaceAll("[.,!?]+$", "").replaceAll("\\s+", " ");
        normalized = normalized.replaceFirst("^hey luna[, ]+", "");
        if (normalized.endsWith(" please")) normalized = normalized.substring(0, normalized.length() - 7).trim();
        return normalized;
    }
    private static int count(String words, int limit) {
        for (int n = 1; n <= limit; n++) if (words.equals(number(n)) || words.equals(Integer.toString(n))) return n;
        return 0;
    }
    private static final java.util.regex.Pattern DURATION_PART = java.util.regex.Pattern.compile(
        "^([a-z0-9]+(?: [a-z]+)?) (hours?|minutes?|seconds?)(?: (.+))?$");
    /**
     * One to three parts in descending units: "two hours", "five minutes",
     * "one hour and thirty minutes", "two minutes thirty seconds". Hours are
     * 1-24; minutes and seconds are 1-60 alone and 1-59 after a larger unit.
     * The whole duration is at most twenty four hours. Anything else is 0.
     */
    static int durationSeconds(String text) {
        if (text == null) return 0;
        String rest = text.trim().replace(" and ", " ");
        if (rest.equals("an hour")) return 3600;
        if (rest.equals("a minute")) return 60;
        int total = 0, lastScale = Integer.MAX_VALUE, parts = 0;
        while (rest != null) {
            java.util.regex.Matcher part = DURATION_PART.matcher(rest);
            if (!part.matches()) return 0;
            String unit = part.group(2);
            int scale = unit.startsWith("hour") ? 3600 : unit.startsWith("minute") ? 60 : 1;
            if (scale >= lastScale || ++parts > 3) return 0;
            int n = count(part.group(1), scale == 3600 ? 24 : parts > 1 ? 59 : 60);
            if (n == 0 || unit.endsWith("s") == (n == 1)) return 0;
            total += n * scale;
            lastScale = scale;
            rest = part.group(3);
        }
        return total <= 86400 ? total : 0;
    }
    public static int commandSeconds(String text) {
        String normalized = normalizeCommand(text);
        java.util.regex.Matcher standard = java.util.regex.Pattern.compile(
            "^(?:(?:set|start) (?:a |another )?)?timer for (.+)$").matcher(normalized);
        if (standard.matches()) return durationSeconds(standard.group(1));
        // Adjectival units are singular: "start a five minute timer".
        java.util.regex.Matcher adjective = java.util.regex.Pattern.compile(
            "^(?:set|start) (?:a |another )?(.+) (second|minute|hour) timer$").matcher(normalized);
        if (adjective.matches()) {
            boolean hour = adjective.group(2).equals("hour");
            return count(adjective.group(1), hour ? 24 : 60) * (hour ? 3600 : adjective.group(2).equals("minute") ? 60 : 1);
        }
        return 0;
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
                String unitSecond = n == 1 ? " second" : " seconds";
                String unitMinute = n == 1 ? " minute" : " minutes";
                out.append(bare).append(unitSecond).append(" please\"");
                out.append(bare).append(unitMinute).append(" please\"");
                for (String form : new String[] {"set timer for ", "start a timer for ", "timer for "}) {
                    out.append(",\"").append(form).append(number(n)).append(unitSecond).append('"');
                    out.append(",\"").append(form).append(number(n)).append(unitMinute).append('"');
                    out.append(",\"").append(form).append(number(n)).append(unitSecond).append(" please\"");
                    out.append(",\"").append(form).append(number(n)).append(unitMinute).append(" please\"");
                }
                out.append(",\"set a timer for ").append(n).append(unitSecond).append('"');
                out.append(",\"set a timer for ").append(n).append(unitMinute).append('"');
            }
        }
        if (command) {
            // Hours, and enough combined examples for the recognizer to chain
            // "<hours> [and] <minutes>" and "<minutes> [and] <seconds>" freely.
            // durationSeconds stays the strict check on whatever it hears.
            for (String form : new String[] {"set a timer for ", "set timer for ", "start a timer for ", "timer for ", "set another timer for "}) {
                out.append(",\"").append(form).append("an hour\"");
                for (int n = 1; n <= 24; n++)
                    out.append(",\"").append(form).append(number(n)).append(n == 1 ? " hour\"" : " hours\"");
            }
            for (int n = 1; n <= 59; n++) {
                String minutes = number(n) + (n == 1 ? " minute" : " minutes");
                String seconds = number(n) + (n == 1 ? " second" : " seconds");
                out.append(",\"set a timer for one hour and ").append(minutes).append('"');
                out.append(",\"set a timer for two hours ").append(minutes).append('"');
                out.append(",\"set a timer for one minute and ").append(seconds).append('"');
                out.append(",\"set a timer for two minutes ").append(seconds).append('"');
            }
            TimerCommand.grammar(out);
        }
        return out.append(']').toString();
    }
}
