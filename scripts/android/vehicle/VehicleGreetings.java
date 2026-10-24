package io.github.f2illc.lunaos.home.vehicle;

/** Same bounded catalog as Home's backend; cross-runtime tests keep it aligned. */
public final class VehicleGreetings {
    private static final String[] LINES = {
        "Good {period}, gorgeous. {name} here. Lovely to have you along.",
        "Hello, darling. {name} here. A little luxury, a little company.",
        "Good {period}. It's {name}. Let's make the ordinary a little more fabulous.",
        "Welcome back, gorgeous. {name} here. You bring the company; I'll bring the charm.",
        "Good {period}. {name} here. Excellent company. Impeccable taste.",
        "Hello, gorgeous. {name} here. Your entrance was almost as good as mine.",
        "Good {period}, darling. {name} here. You bring the playlist; I bring the personality.",
        "You, me, impeccable taste. Good {period} from {name}.",
        "Good {period}. {name} here. The entrance has been made. Naturally.",
        "Hello, darling. {name} here. A grand entrance deserves a proper hello.",
        "Good {period}, gorgeous. {name} here. Luxury has entered the conversation.",
        "Good {period}. {name} here. Your chariot has opinions. Mostly excellent ones."
    };
    public static final class Choice {
        public final int id;
        public final String text;
        Choice(int id, String text) { this.id = id; this.text = text; }
    }
    public static boolean validName(String name) {
        if (name == null || name.trim().isEmpty() || name.length() > 40) return false;
        for (int n = 0; n < name.length(); n++) if (Character.isISOControl(name.charAt(n)) || name.charAt(n) == '{' || name.charAt(n) == '}') return false;
        return true;
    }
    public static java.util.Set<String> all(String nickname) {
        if (!validName(nickname)) throw new IllegalArgumentException();
        java.util.Set<String> texts = new java.util.LinkedHashSet<>();
        for (String period : new String[]{"morning", "afternoon", "evening"})
            for (String line : LINES) texts.add(line.replace("{period}", period).replace("{name}", nickname.trim()));
        return texts;
    }
    public static Choice choose(String period, String nickname, int lastId, String preferred) {
        if (!period.equals("morning") && !period.equals("afternoon") && !period.equals("evening")) throw new IllegalArgumentException();
        if (!validName(nickname)) throw new IllegalArgumentException();
        for (int n = 0; n < LINES.length; n++) {
            String text = LINES[n].replace("{period}", period);
            if (text.equals(preferred) && n != lastId) return new Choice(n, text.replace("{name}", nickname.trim()));
        }
        // Pick from the other eleven entries, so time-of-day changes and process
        // restarts cannot accidentally repeat the previous trip's expression.
        boolean previousKnown = lastId >= 0 && lastId < LINES.length;
        int selected = new java.security.SecureRandom().nextInt(LINES.length - (previousKnown ? 1 : 0));
        if (previousKnown && selected >= lastId) selected++;
        return new Choice(selected, LINES[selected].replace("{period}", period).replace("{name}", nickname.trim()));
    }
}
