package io.github.f2illc.lunaos.home.voiceprobe;

/** JVM checks for stopping a ringing alarm and cancelling timers by voice. */
public final class TimerStopTest {
    private static int checks;
    private static void check(boolean condition, String what) {
        if (!condition) throw new AssertionError(what);
        checks++;
    }

    public static void main(String[] args) {
        // Asking for silence without naming a numbered timer.
        for (String spoken : new String[] {
            "stop", "cancel", "stop it", "turn it off", "shut it off", "okay stop", "luna stop", "hey luna stop",
            "Hey Luna, stop.", "stop please", "stop the timer", "stop the alarm", "cancel the timer", "cancel the alarm",
            "turn off the timer", "turn off the alarm", "turn the alarm off", "turn the timer off", "shut off the alarm",
            "shut the alarm off", "end the timer", "stop timer", "stop alarm", "cancel my timer", "stop that alarm",
        }) check(TimerCommand.parse(spoken) == TimerCommand.STOP && TimerCommand.stop(spoken) == TimerCommand.STOP, spoken);
        check(TimerCommand.valid(TimerCommand.STOP), "stop is a valid command");

        // A numbered timer is cancelled by any of the same verbs.
        for (String verb : new String[] {"cancel", "stop", "end", "turn off", "shut off"})
            check(TimerCommand.parse(verb + " timer two") == TimerCommand.cancel(2), verb + " timer two");
        check(TimerCommand.parse("turn timer three off") == TimerCommand.cancel(3), "turn timer three off");
        check(TimerCommand.parse("cancel timer 8") == TimerCommand.cancel(8), "cancel timer 8");
        check(TimerCommand.stop("cancel timer two") == 0, "a numbered timer is not a plain stop");

        // Nothing is guessed.
        for (String refused : new String[] {
            "stop the music", "stop talking", "don't stop", "stop timer nine", "cancel timer zero", "stop the timer now",
            "please stop", "turn off", "turn off the lights", "stop stop", "cancel everything", "pause the timer", "",
        }) check(TimerCommand.parse(refused) == 0, "refused: " + refused);

        // Without the wake phrase, stop works only while a timer is ringing,
        // and nothing else does.
        WakeSession quiet = new WakeSession(0, true);
        check(quiet.acceptFinal("stop", 1000, false) == WakeSession.NONE, "stop is ignored when nothing rings");
        check(quiet.acceptFinal("stop", 1001) == WakeSession.NONE, "the two-argument form never stops");
        check(!quiet.awaitingCommand(), "an ignored stop does not wake");
        for (String spoken : new String[] {"stop", "luna stop", "hey luna stop", "turn it off", "stop the alarm", "cancel the timer"}) {
            WakeSession ringing = new WakeSession(0, true);
            check(ringing.acceptFinal(spoken, 1000, true) == TimerCommand.STOP, "ringing: " + spoken);
            check(ringing.acceptFinal(spoken, 1001, true) == WakeSession.NONE, "one stop per session: " + spoken);
        }
        WakeSession ringing = new WakeSession(0, true);
        for (String other : new String[] {"cancel timer two", "set a timer for five minutes", "add one minute to the timer",
            "stop the music", "[unk]", ""})
            check(ringing.acceptFinal(other, 1000, true) == WakeSession.NONE, "ringing does not open: " + other);
        check(ringing.acceptFinal("hey luna", 2000, true) == WakeSession.WAKE, "the wake phrase still works while ringing");
        check(ringing.acceptFinal("stop", 3000, true) == TimerCommand.STOP, "stop after the wake phrase");

        // After the wake phrase, stop is a command whether or not anything rings.
        WakeSession awake = new WakeSession(0, true);
        awake.acceptFinal("hey luna", 1000);
        check(awake.acceptFinal("stop", 2000) == TimerCommand.STOP, "stop after wake");

        // Stop wording is never sent on as a question.
        for (String spoken : new String[] {"stop", "stop the alarm", "turn it off", "shut it off", "turn off the alarm",
            "okay stop", "luna stop", "pause the timer", "stop the music"})
            check(!QuestionPolicy.accepts(spoken), "not a question: " + spoken);
        check(QuestionPolicy.accepts("what is the capital of france"), "questions still pass");

        // The recognizer's phrase list has the stop wording.
        String grammar = TimerPhrase.commandGrammar();
        for (String phrase : new String[] {"\"stop\"", "\"hey luna stop\"", "\"luna stop\"", "\"turn it off\"",
            "\"stop the alarm\"", "\"turn off the timer\"", "\"turn the alarm off\"", "\"cancel the timer\"",
            "\"stop timer two\"", "\"turn timer two off\"", "\"cancel timer eight\""})
            check(grammar.contains(phrase), "grammar lacks " + phrase);
        check(!TimerPhrase.grammar().contains("\"stop\""), "the short test grammar is unchanged");

        System.out.println(checks + " timer stop checks passed");
    }
}
