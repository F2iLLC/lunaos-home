package io.github.f2illc.lunaos.home.voiceprobe;

/** Fixed music phrases after the wake phrase. A structured action only; no recognized text retained. */
final class MusicCommand {
    // Outside every value TimerCommand.valid accepts, so a music action can never run as a timer command.
    static final int PLAY = -51, PAUSE = -52, NEXT = -53, PREVIOUS = -54;
    private static final int[] ACTIONS = {PLAY, PAUSE, NEXT, PREVIOUS};
    // The whole list. Bare "stop", "pause" and "resume" stay timer words, and nothing is played by name.
    private static final String[][] PHRASES = {
        {"play music", "play some music", "play my music", "play spotify", "resume the music", "unpause the music"},
        {"pause the music", "stop the music", "pause music", "stop music", "turn off the music", "turn the music off",
            "pause spotify", "stop spotify"},
        {"next song", "next track", "skip", "skip this song", "skip song", "play the next song"},
        {"previous song", "previous track", "last song", "go back a song", "play the previous song"},
    };
    private MusicCommand() {}
    static boolean valid(int value) { return value <= PLAY && value >= PREVIOUS; }
    /** The action for one complete phrase from the list, after the normalization timers get; otherwise 0. */
    static int parse(String text) {
        if (text == null) return 0;
        String bare = TimerPhrase.normalizeCommand(text);
        for (int group = 0; group < PHRASES.length; group++)
            for (String phrase : PHRASES[group]) if (bare.equals(phrase)) return ACTIONS[group];
        return 0;
    }
    /**
     * A music action only inside an open command window, so never before the wake phrase and
     * never because a timer is ringing. Taking one ends the exchange: one effect per wake.
     */
    static int accept(WakeSession wake, String text, long now) {
        if (wake == null || !wake.awaitingCommand() || wake.expired(now)) return 0;
        int action = parse(text);
        if (valid(action)) wake.decodeUntil(now); // Closes the window at this moment.
        return action;
    }
    static void grammar(StringBuilder out) {
        for (String[] group : PHRASES) for (String phrase : group) out.append(",\"").append(phrase).append('"');
    }
    /** The one fixed-phrase list: the timer phrases as they are, then the music phrases. */
    static String commandGrammar() {
        String timers = TimerPhrase.commandGrammar();
        StringBuilder out = new StringBuilder(timers.substring(0, timers.length() - 1));
        grammar(out);
        return out.append(']').toString();
    }
}
