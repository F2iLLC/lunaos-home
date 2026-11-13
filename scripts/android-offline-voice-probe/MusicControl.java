package io.github.f2illc.lunaos.home.voiceprobe;

/** What a music action sends and to whom. Needs no Android class. Spotify only, never another app. */
final class MusicControl {
    private MusicControl() {}
    static final String SPOTIFY = "com.spotify.music";
    // Android's media play, pause, next and previous keys.
    private static final int KEY_PLAY = 126, KEY_PAUSE = 127, KEY_NEXT = 87, KEY_PREVIOUS = 88;
    private static final String NOT_INSTALLED = "Spotify is not installed on this device. Nothing was sent.";

    static final class Plan {
        /** The one app the key goes to, or null when nothing is sent. */
        final String target;
        final int key;
        final String status;
        private Plan(String target, int key, String status) { this.target = target; this.key = key; this.status = status; }
        boolean sends() { return target != null && key != 0; }
    }

    /** Asking is never reported as playing: Home can only hand the key over, not hear Spotify obey it. */
    static Plan plan(int action, boolean spotifyInstalled) {
        if (!MusicCommand.valid(action)) return new Plan(null, 0, "Not a music command. Nothing was sent.");
        if (!spotifyInstalled) return new Plan(null, 0, NOT_INSTALLED);
        switch (action) {
            case MusicCommand.PLAY: return new Plan(SPOTIFY, KEY_PLAY, "Asked Spotify to play.");
            case MusicCommand.PAUSE: return new Plan(SPOTIFY, KEY_PAUSE, "Asked Spotify to pause.");
            case MusicCommand.NEXT: return new Plan(SPOTIFY, KEY_NEXT, "Asked Spotify to skip to the next song.");
            default: return new Plan(SPOTIFY, KEY_PREVIOUS, "Asked Spotify to go back a song.");
        }
    }

    /** The command could not be handed over even though Spotify is installed. */
    static String undelivered() { return "Could not hand the command to Spotify. It may not have been received."; }
}
