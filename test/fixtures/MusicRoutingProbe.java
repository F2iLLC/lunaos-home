package io.github.f2illc.lunaos.home.voiceprobe;

/** Where finalized speech goes once music phrases exist: timers, music, a question, or nowhere. */
public final class MusicRoutingProbe {
    private static int checks;
    private static void check(boolean value, String label) {
        checks++;
        if (!value) throw new AssertionError(label);
    }
    private static WakeSession awake() {
        WakeSession wake = new WakeSession(0, true);
        check(wake.acceptFinal("hey luna", 1000) == WakeSession.WAKE, "wake phrase opens the window");
        return wake;
    }
    public static void main(String[] args) {
        String[][] groups = MusicCommandTest.GROUPS;
        int[] actions = MusicCommandTest.ACTIONS;
        StringBuilder fragment = new StringBuilder();
        MusicCommand.grammar(fragment);
        String[] offered = MusicCommandTest.phrases(fragment.toString());

        // Timers keep their words. Each value below is what main returns for the bare word.
        String[] timerWords = {"pause", "stop", "resume", "continue", "hold it", "stop it", "turn it off", "cancel"};
        int[] onMain = {-30, -20, -40, 0, -30, -20, -20, -20};
        check(TimerCommand.pause(0) == -30 && TimerCommand.STOP == -20 && TimerCommand.resume(0) == -40, "timer values are unchanged");
        for (int i = 0; i < timerWords.length; i++) {
            check(TimerCommand.parse(timerWords[i]) == onMain[i], "timer word unchanged: " + timerWords[i]);
            check(MusicCommand.parse(timerWords[i]) == 0, "not a music command: " + timerWords[i]);
            WakeSession wake = awake();
            check(MusicCommand.accept(wake, timerWords[i], 2000) == 0, "music leaves it alone after the wake phrase: " + timerWords[i]);
            check(wake.acceptFinal(timerWords[i], 2000) == onMain[i], "and the timer still gets it: " + timerWords[i]);
        }
        for (String spoken : new String[] {"pause the timer", "stop the alarm", "cancel timer two", "resume timer two",
            "set a timer for five minutes", "add one minute to the timer", "turn off the alarm"}) {
            check(TimerCommand.valid(TimerCommand.parse(spoken)), "timer command still parses: " + spoken);
            check(MusicCommand.parse(spoken) == 0, "a timer command is not music: " + spoken);
        }

        // Music never becomes a timer.
        for (int group = 0; group < groups.length; group++) {
            for (String phrase : groups[group]) {
                for (String spoken : new String[] {phrase, "hey luna " + phrase, phrase + " please"}) {
                    check(TimerCommand.parse(spoken) == 0 && TimerCommand.stop(spoken) == 0
                        && TimerPhrase.commandSeconds(spoken) == 0, "not a timer command: " + spoken);
                }
                WakeSession wake = awake();
                check(wake.acceptFinal(phrase, 2000) == 0, "the timer path does nothing with: " + phrase);
            }
        }
        for (String phrase : offered) check(TimerCommand.parse(phrase) == 0, "grammar phrase is not a timer command: " + phrase);

        // Music never reaches the hosted model. accept() takes no online-answers setting, and the
        // question policy refuses these whether or not anything would have been asked.
        String[] fragments = {"play", "play the", "music", "skip the", "pause the"};
        for (int group = 0; group < groups.length; group++) {
            for (String phrase : groups[group]) {
                for (String spoken : new String[] {phrase, phrase.toUpperCase(java.util.Locale.ROOT), phrase + ".",
                    "hey luna " + phrase, "Hey Luna, " + phrase + "?", phrase + " please"})
                    check(!QuestionPolicy.accepts(spoken), "a music phrase is not a question: " + spoken);
                WakeSession wake = awake();
                check(!wake.acceptQuestion(phrase, 2000), "not sent on after the wake phrase: " + phrase);
            }
        }
        for (String phrase : offered) check(!QuestionPolicy.accepts(phrase), "grammar phrase is not a question: " + phrase);
        for (String spoken : fragments) {
            for (String form : new String[] {spoken, "Hey Luna, " + spoken, spoken + "."})
                check(!QuestionPolicy.accepts(form), "a music fragment is not a question: " + form);
            check(MusicCommand.parse(spoken) == 0, "a fragment is not a command: " + spoken);
            WakeSession wake = awake();
            check(MusicCommand.accept(wake, spoken, 2000) == 0 && !wake.acceptQuestion(spoken, 2000),
                "a fragment does nothing after the wake phrase: " + spoken);
        }
        for (String spoken : new String[] {"skip", "skip please", "next", "previous", "spotify", "the music", "play some", "play my"})
            check(!QuestionPolicy.accepts(spoken), "a music fragment is not a question: " + spoken);
        // A refused music request is refused, not passed on to be answered.
        for (String refused : MusicCommandTest.REFUSED) {
            check(!QuestionPolicy.accepts(refused), "a refused music request is not a question: " + refused);
            WakeSession wake = awake();
            check(MusicCommand.accept(wake, refused, 2000) == 0, "refused after the wake phrase: " + refused);
            check(wake.acceptFinal(refused, 2000) == 0, "and starts no timer: " + refused);
            check(!wake.acceptQuestion(refused, 2000), "and is not asked: " + refused);
        }

        // Not without the wake phrase, whether or not a timer is ringing.
        for (int group = 0; group < groups.length; group++) {
            for (String phrase : groups[group]) {
                WakeSession quiet = new WakeSession(0, true);
                check(MusicCommand.accept(quiet, phrase, 1000) == 0, "nothing before the wake phrase: " + phrase);
                check(MusicCommand.accept(quiet, "hey luna " + phrase, 1001) == 0, "one breath does not wake: " + phrase);
                check(quiet.acceptFinal(phrase, 1002) == WakeSession.NONE && quiet.acceptFinal(phrase, 1003, false) == WakeSession.NONE,
                    "the session ignores it: " + phrase);
                check(!quiet.awaitingCommand() && !quiet.acceptQuestion(phrase, 1004), "and stays asleep: " + phrase);
                WakeSession ringing = new WakeSession(0, true);
                check(ringing.acceptFinal(phrase, 1000, true) == WakeSession.NONE, "ringing does not open music: " + phrase);
                for (int i = 0; i < 5; i++)
                    check(ringing.acceptPartial(phrase, 1100 + i, true) == WakeSession.NONE, "nor do words still being heard: " + phrase);
                check(MusicCommand.accept(ringing, phrase, 1200) == 0 && !ringing.awaitingCommand(), "ringing, still asleep: " + phrase);
                check(ringing.acceptFinal("stop", 1300, true) == TimerCommand.STOP, "only the stop words are honored while ringing");
                check(MusicCommand.accept(ringing, phrase, 1400) == 0, "and a stopped alarm opens nothing: " + phrase);
            }
        }
        check(MusicCommand.accept(null, "play music", 1000) == 0, "no session, no command");

        // After the wake phrase: one music action, addressed to Spotify, and nothing else in that exchange.
        for (int group = 0; group < groups.length; group++) {
            for (String phrase : groups[group]) {
                WakeSession wake = awake();
                int action = MusicCommand.accept(wake, phrase, 2000);
                check(action == actions[group], "after the wake phrase: " + phrase);
                MusicControl.Plan plan = MusicControl.plan(action, true);
                check(plan.sends() && MusicControl.SPOTIFY.equals(plan.target), "delivered to Spotify only: " + phrase);
                check(!MusicControl.plan(action, false).sends(), "Spotify missing, nothing sent: " + phrase);
                check(MusicCommand.accept(wake, phrase, 2001) == 0, "one command per wake: " + phrase);
                check(wake.acceptFinal("set a timer for five seconds", 2002) == 0, "no timer in the same exchange: " + phrase);
                check(!wake.acceptQuestion("why is the sky blue", 2003), "no question in the same exchange: " + phrase);
                check(wake.expired(2004), "the exchange is over: " + phrase);
            }
        }
        WakeSession normalized = awake();
        check(MusicCommand.accept(normalized, "Hey Luna, PLAY MUSIC please!", 2000) == MusicCommand.PLAY, "normalized after the wake phrase");
        WakeSession retry = awake();
        check(MusicCommand.accept(retry, "play song", 2000) == 0 && MusicCommand.accept(retry, "[unk]", 2001) == 0, "a refusal does not end the window");
        check(MusicCommand.accept(retry, "next song", 2002) == MusicCommand.NEXT, "a complete phrase can still follow");
        WakeSession late = awake();
        check(MusicCommand.accept(late, "play music", 1000 + WakeSession.COMMAND_MS) == 0, "nothing after the command window");
        WakeSession almost = awake();
        check(MusicCommand.accept(almost, "pause the music", 999 + WakeSession.COMMAND_MS) == MusicCommand.PAUSE, "accepted until the window closes");
        WakeSession timerFirst = awake();
        check(timerFirst.acceptFinal("set a timer for five seconds", 2000) == 5, "a timer command is taken");
        check(MusicCommand.accept(timerFirst, "play music", 2001) == 0, "one effect per wake");
        WakeSession asked = awake();
        check(asked.acceptQuestion("why is the sky blue", 2000), "a question is taken");
        check(MusicCommand.accept(asked, "play music", 2001) == 0, "one effect per wake after a question");
        WakeSession shortTest = new WakeSession(0);
        check(MusicCommand.accept(shortTest, "play music", 1000) == 0, "the bounded test session also needs the wake phrase");
        shortTest.acceptFinal("hey luna", 1001);
        check(MusicCommand.accept(shortTest, "skip", 1002) == MusicCommand.NEXT, "and accepts after it");

        // Ordinary questions are untouched.
        for (String text : new String[] {"what is music", "tell me a story about a song", "why is the sky blue",
            "How many seconds are in a minute?", "tell me a story about a dragon", "what is the capital of france",
            "play a game with me", "who wrote the first song", "is it safe to play outside today",
            "add milk to the grocery list", "add bananas too", "create a list of movies to watch", "start a packing list",
            "mark laundry as done", "yes", "no"}) {
            check(QuestionPolicy.accepts(text), "ordinary question accepted: " + text);
            check(MusicCommand.parse(text) == 0, "a question is not music: " + text);
            WakeSession wake = awake();
            check(MusicCommand.accept(wake, text, 2000) == 0, "music leaves a question alone: " + text);
            check(wake.acceptFinal(text, 2000) == 0 && wake.acceptQuestion(text, 2000), "still asked after the wake phrase: " + text);
        }
        for (String text : new String[] {"Hey Luna!", "hey luna", "SET A TIMER", "five minutes", "Cancel timer nine", "[UNK]", "hi\nthere"})
            check(!QuestionPolicy.accepts(text), "timer or wake fragment is still not a question");

        System.out.println("Music routing checks passed (" + checks + " cases).");
    }
}
