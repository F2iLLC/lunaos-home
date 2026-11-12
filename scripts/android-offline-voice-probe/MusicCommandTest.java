package io.github.f2illc.lunaos.home.voiceprobe;

/** JVM checks for the music phrases, their refusals and where a music action is sent. */
public final class MusicCommandTest {
    private static int checks;
    private static void check(boolean condition, String what) {
        if (!condition) throw new AssertionError(what);
        checks++;
    }

    static final String[] PLAY = {"play music", "play some music", "play my music", "play spotify",
        "resume the music", "unpause the music"};
    static final String[] PAUSE = {"pause the music", "stop the music", "pause music", "stop music",
        "turn off the music", "turn the music off", "pause spotify", "stop spotify"};
    static final String[] NEXT = {"next song", "next track", "skip", "skip this song", "skip song", "play the next song"};
    static final String[] PREVIOUS = {"previous song", "previous track", "last song", "go back a song",
        "play the previous song"};
    static final String[][] GROUPS = {PLAY, PAUSE, NEXT, PREVIOUS};
    static final int[] ACTIONS = {MusicCommand.PLAY, MusicCommand.PAUSE, MusicCommand.NEXT, MusicCommand.PREVIOUS};
    /** Extra or compound wording. None of it is repaired into a command. */
    static final String[] REFUSED = {"play music tomorrow", "don't play music", "stop the music in five minutes",
        "play music and set a timer for five minutes", "next song twice", "play song"};

    /** The phrases a grammar fragment of the form ,"a","b" hands the recognizer. */
    static String[] phrases(String fragment) {
        check(fragment.startsWith(",\"") && fragment.endsWith("\""), "grammar fragment shape");
        return fragment.substring(2, fragment.length() - 1).split("\",\"", -1);
    }

    public static void main(String[] args) {
        // Four actions, each its own value, none of them a value a timer could act on.
        for (int i = 0; i < ACTIONS.length; i++) {
            check(ACTIONS[i] != 0 && MusicCommand.valid(ACTIONS[i]), "action is valid");
            check(!TimerCommand.valid(ACTIONS[i]), "a music action is never a timer command");
            for (int j = 0; j < i; j++) check(ACTIONS[i] != ACTIONS[j], "actions are distinct");
        }
        for (int other : new int[] {0, 1, 5, 300, 86400, TimerCommand.STOP, TimerCommand.cancel(1), TimerCommand.pause(0),
            TimerCommand.resume(0), TimerCommand.add(1, 60), WakeSession.WAKE, Integer.MIN_VALUE, Integer.MAX_VALUE})
            check(!MusicCommand.valid(other), "not a music action: " + other);

        // Every phrase in the table, with the normalization timers already get.
        for (int group = 0; group < GROUPS.length; group++) {
            for (String phrase : GROUPS[group]) {
                String title = Character.toUpperCase(phrase.charAt(0)) + phrase.substring(1);
                for (String spoken : new String[] {phrase, phrase.toUpperCase(java.util.Locale.ROOT), title + ".", phrase + "!",
                    phrase + " please", "hey luna " + phrase, "Hey Luna, " + phrase + " please.", "  " + phrase + "  "})
                    check(MusicCommand.parse(spoken) == ACTIONS[group], "parses: " + spoken);
            }
        }

        // Strict, never repaired. At least one refusal for each group of phrases.
        for (String refused : REFUSED) check(MusicCommand.parse(refused) == 0, "refused: " + refused);
        for (String refused : new String[] {
            // play
            "play", "play the", "play song", "play a song", "play music now", "replay music", "please play music",
            "play music play music", "play music on spotify tomorrow", "can you play music",
            // pause
            "pause", "stop", "pause the", "pause the music now", "stop the musical", "stop the music stop the music",
            "do not stop the music", "turn off", "turn it off", "turn off the lights",
            // next
            "next", "skip the", "skip two songs", "next song next song", "skip this", "next song and pause",
            // previous
            "previous", "last", "go back", "previous song twice", "last song again", "go back two songs",
            // not speech worth acting on
            "music", "spotify", "song", "[unk]", "play [unk]", "[unk] music", "", "   ", "hey luna", "play\nmusic",
        }) check(MusicCommand.parse(refused) == 0, "refused: " + refused);
        check(MusicCommand.parse(null) == 0, "nothing heard");
        StringBuilder padded = new StringBuilder("play music");
        while (padded.length() <= 1000) padded.append(' ');
        check(MusicCommand.parse(padded.toString()) == 0, "over-long text is refused");

        // Round trip: everything the grammar hands the recognizer parses back to an action,
        // and the grammar offers exactly the table.
        StringBuilder fragment = new StringBuilder();
        MusicCommand.grammar(fragment);
        String[] offered = phrases(fragment.toString());
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (String phrase : offered) {
            check(phrase.matches("[a-z]+(?: [a-z]+)*"), "plain words only: " + phrase);
            check(MusicCommand.valid(MusicCommand.parse(phrase)), "grammar phrase parses: " + phrase);
            check(seen.add(phrase), "offered once: " + phrase);
        }
        int table = 0;
        for (int group = 0; group < GROUPS.length; group++) {
            for (String phrase : GROUPS[group]) {
                table++;
                check(seen.contains(phrase), "grammar offers: " + phrase);
            }
        }
        check(offered.length == table, "the grammar offers the table and nothing else");
        for (String refused : REFUSED) check(!seen.contains(refused), "grammar does not offer: " + refused);

        // One fixed-phrase list: the timer phrases, unchanged, followed by the music phrases.
        String timers = TimerPhrase.commandGrammar();
        String combined = MusicCommand.commandGrammar();
        check(combined.equals(timers.substring(0, timers.length() - 1) + fragment + "]"), "music is added to the one phrase list");
        check(combined.startsWith("[\"[unk]\",\"hey luna\","), "the wake phrase still leads the list");
        check(combined.contains("\"set a timer for ten seconds\"") && combined.contains("\"stop\""), "timer phrases remain");
        check(!timers.contains("music") && !timers.contains("spotify") && !timers.contains("song"), "the timer list itself is unchanged");
        check(!TimerPhrase.grammar().contains("music") && WakeSession.grammar().equals("[\"[unk]\",\"hey luna\"]"),
            "the short lists are unchanged");

        // A music action is addressed to Spotify and to nothing else.
        check(MusicControl.SPOTIFY.equals("com.spotify.music"), "the Spotify app");
        int[] keys = {126, 127, 87, 88}; // Android's media play, pause, next and previous keys.
        java.util.Set<String> sentStatuses = new java.util.HashSet<>();
        for (int i = 0; i < ACTIONS.length; i++) {
            MusicControl.Plan plan = MusicControl.plan(ACTIONS[i], true);
            check(plan.sends(), "installed: a command is produced");
            check("com.spotify.music".equals(plan.target), "addressed to Spotify only");
            check(plan.key == keys[i], "the matching media key");
            check(plan.status != null && plan.status.contains("Spotify"), "status names Spotify");
            check(!plan.status.toLowerCase(java.util.Locale.ROOT).contains("playing"), "asking is not reported as playing");
            check(sentStatuses.add(plan.status), "each action has its own status");
        }

        // Spotify missing: nothing is produced for any action, for any app, and the status says so.
        for (int action : ACTIONS) {
            MusicControl.Plan plan = MusicControl.plan(action, false);
            check(!plan.sends() && plan.target == null && plan.key == 0, "not installed: nothing to send");
            check(plan.status != null && plan.status.contains("Spotify") && plan.status.contains("not installed"),
                "not installed: said plainly");
            check(!sentStatuses.contains(plan.status), "not installed never reads as sent");
        }

        // Anything that is not one of the four actions produces nothing, installed or not.
        for (int other : new int[] {0, 1, 5, 300, 126, 127, 87, 88, TimerCommand.STOP, TimerCommand.cancel(2),
            TimerCommand.pause(0), TimerCommand.resume(0), TimerCommand.add(1, 60), WakeSession.WAKE}) {
            for (boolean installed : new boolean[] {true, false}) {
                MusicControl.Plan plan = MusicControl.plan(other, installed);
                check(!plan.sends() && plan.target == null && plan.key == 0, "no command for " + other);
                check(plan.status != null && !sentStatuses.contains(plan.status), "no sent status for " + other);
            }
        }

        // A command that could not be handed over is reported as not delivered.
        String undelivered = MusicControl.undelivered();
        check(undelivered != null && undelivered.contains("Spotify") && !sentStatuses.contains(undelivered),
            "undelivered has its own status");
        check(!undelivered.toLowerCase(java.util.Locale.ROOT).contains("playing"), "undelivered is never reported as playing");
        check(!undelivered.equals(MusicControl.plan(MusicCommand.PLAY, false).status), "undelivered is not the same as not installed");

        System.out.println(checks + " music command checks passed");
    }
}
