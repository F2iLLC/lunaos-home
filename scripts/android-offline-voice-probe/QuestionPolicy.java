package io.github.f2illc.lunaos.home.voiceprobe;

/** Questions cannot repair or reinterpret incomplete timer commands. */
public final class QuestionPolicy {
    public static boolean accepts(String text) {
        if (text == null || text.trim().isEmpty() || text.length() > 1000 || text.contains("[unk]")) return false;
        if (text.matches("(?s).*\\b(timer|timers|cancel|add)\\b.*")) return false;
        for (int i = 0; i < text.length(); i++) if (Character.isISOControl(text.charAt(i))) return false;
        return true;
    }
}
