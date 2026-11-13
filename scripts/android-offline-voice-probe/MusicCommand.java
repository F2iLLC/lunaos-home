package io.github.f2illc.lunaos.home.voiceprobe;

/**
 * Deliberately narrow, complete-utterance parser for the four music actions. Structured
 * action only: no recognized text is kept. Anything outside the table is 0, never repaired.
 * Bare "pause", "stop", "resume" and the other timer words are not here; they stay the timers'.
 */
final class MusicCommand {
    private MusicCommand() {}
    // Distinct from every value TimerCommand.valid accepts and from WakeSession.WAKE.
    static final int PLAY = -51, PAUSE = -52, NEXT = -53, PREVIOUS = -54;
    static boolean valid(int value) { return value <= PLAY && value >= PREVIOUS; }

    private static final String[] PLAY_PHRASES = {"play music", "play some music", "play my music", "play spotify",
        "resume the music", "unpause the music"};
    private static final String[] PAUSE_PHRASES = {"pause the music", "stop the music", "pause music", "stop music",
        "turn off the music", "turn the music off", "pause spotify", "stop spotify"};
    private static final String[] NEXT_PHRASES = {"next song", "next track", "skip", "skip this song", "skip song",
        "play the next song"};
    private static final String[] PREVIOUS_PHRASES = {"previous song", "previous track", "last song", "go back a song",
        "play the previous song"};
    private static final String[][] GROUPS = {PLAY_PHRASES, PAUSE_PHRASES, NEXT_PHRASES, PREVIOUS_PHRASES};
    private static final int[] ACTIONS = {PLAY, PAUSE, NEXT, PREVIOUS};

    /** The action for one complete phrase, with the normalization timers get; otherwise 0. */
    static int parse(String text) {
        String bare = TimerPhrase.normalizeCommand(text);
        for (int group = 0; group < GROUPS.length; group++)
            for (String phrase : GROUPS[group]) if (bare.equals(phrase)) return ACTIONS[group];
        return 0;
    }

    /**
     * The action, only inside an open command window; taking one ends the exchange, so a wake
     * gives one effect. Before the wake phrase, after the window, or after another effect: 0.
     */
    static int accept(WakeSession wake, String text, long now) {
        if (wake == null) return 0;
        int action = parse(text);
        return valid(action) && wake.takeCommand(now) ? action : 0;
    }

    /** Appends ,"phrase","phrase"... for exactly the table. */
    static void grammar(StringBuilder out) {
        for (String[] group : GROUPS) for (String phrase : group) out.append(",\"").append(phrase).append('"');
    }

    /** One phrase list for one recognizer: the timer phrases, unchanged, then the music phrases. */
    static String commandGrammar() {
        StringBuilder out = new StringBuilder(TimerPhrase.commandGrammar());
        out.setLength(out.length() - 1);
        grammar(out);
        return out.append(']').toString();
    }
}
