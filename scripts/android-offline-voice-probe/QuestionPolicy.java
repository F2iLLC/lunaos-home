package io.github.f2illc.lunaos.home.voiceprobe;

/** Questions cannot repair or reinterpret incomplete timer commands. */
public final class QuestionPolicy {
    private static String normalized(String text) {
        return text.toLowerCase(java.util.Locale.ROOT).trim().replaceAll("[.,!?]+$", "")
            .replaceAll("\\s+", " ").replaceFirst("^hey luna[, ]+", "");
    }
    static boolean timerAttempt(String text) {
        if (text == null) return false;
        String bare = normalized(text);
        return bare.matches("(?s).*\\b(timer|timers|alarm|alarms|cancel|add)\\b.*")
            || bare.matches("(?:set|start|stop|pause|resume|okay stop|luna stop|turn it off|shut it off)(?: .*)?")
            || bare.matches("(?:[0-9]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty)(?: [a-z]+)? (?:seconds?|minutes?|hours?)(?: please)?");
    }
    public static boolean accepts(String text) {
        if (text == null || text.trim().isEmpty() || text.length() > 1000) return false;
        for (int i = 0; i < text.length(); i++) if (Character.isISOControl(text.charAt(i))) return false;
        String bare = normalized(text);
        return !bare.isEmpty() && !bare.equals("hey luna") && !bare.contains("[unk]") && !timerAttempt(text);
    }
}
