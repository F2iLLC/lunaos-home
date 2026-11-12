package io.github.f2illc.lunaos.home.voiceprobe;

/** Decides what a music action sends and to whom. No Android calls, so the JVM suite can run it. */
final class MusicControl {
    /** The only app a music action is ever addressed to. */
    static final String SPOTIFY = "com.spotify.music";
    // android.view.KeyEvent media key codes, fixed since API 11.
    private static final int KEY_PLAY = 126, KEY_PAUSE = 127, KEY_NEXT = 87, KEY_PREVIOUS = 88;
    static final class Plan {
        /** The package to address, or null when nothing is to be sent. */
        final String target;
        final int key;
        final String status;
        Plan(String target, int key, String status) { this.target = target; this.key = key; this.status = status; }
        boolean sends() { return target != null; }
    }
    private MusicControl() {}
    static Plan plan(int action, boolean spotifyInstalled) {
        if (!MusicCommand.valid(action)) return new Plan(null, 0, "Not a music command. Nothing was sent.");
        if (!spotifyInstalled) return new Plan(null, 0, "Spotify is not installed on this device. Nothing was sent.");
        // Asking is all that is known here: Spotify does not report back whether it did it.
        if (action == MusicCommand.PLAY) return new Plan(SPOTIFY, KEY_PLAY, "Asked Spotify to play.");
        if (action == MusicCommand.PAUSE) return new Plan(SPOTIFY, KEY_PAUSE, "Asked Spotify to pause.");
        if (action == MusicCommand.NEXT) return new Plan(SPOTIFY, KEY_NEXT, "Asked Spotify for the next song.");
        return new Plan(SPOTIFY, KEY_PREVIOUS, "Asked Spotify for the previous song.");
    }
    /** Spotify is installed but the command could not be handed to it. */
    static String undelivered() { return "Could not reach Spotify. Nothing was sent."; }
}
