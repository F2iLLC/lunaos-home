package io.github.f2illc.lunaos.home.voiceprobe;

/** JVM checks for spoken timer durations: seconds, minutes, hours and combinations. */
public final class TimerDurationTest {
    private static int checks;
    private static void is(String spoken, int seconds) {
        int parsed = TimerCommand.parse(spoken);
        if (parsed != seconds) throw new AssertionError(spoken + " -> " + parsed + ", expected " + seconds);
        if (seconds > 0 && !TimerCommand.valid(parsed)) throw new AssertionError(spoken + " not valid");
        checks++;
    }

    public static void main(String[] args) {
        // Single units.
        is("set a timer for thirty seconds", 30);
        is("set a timer for five minutes", 300);
        is("set a timer for sixty minutes", 3600);
        is("set a timer for one hour", 3600);
        is("set a timer for an hour", 3600);
        is("set a timer for a minute", 60);
        is("set a timer for two hours", 7200);
        is("set a timer for twenty four hours", 86400);
        is("hey luna set a timer for 2 hours please", 7200);
        is("timer for three hours", 10800);
        is("start a timer for twelve hours", 43200);
        is("set another timer for one hour", 3600);
        is("set a two hour timer", 7200);
        is("start a ten minute timer", 600);

        // Combined, with or without "and", in descending units only.
        is("set a timer for one hour and thirty minutes", 5400);
        is("set a timer for one hour thirty minutes", 5400);
        is("set a timer for two hours fifteen minutes", 8100);
        is("set a timer for two minutes and thirty seconds", 150);
        is("set a timer for one minute thirty seconds", 90);
        is("set a timer for one hour one minute one second", 3661);
        is("set a timer for twenty three hours fifty nine minutes fifty nine seconds", 86399);
        is("set a timer for 1 hour and 5 minutes", 3900);

        // Refused: nothing is guessed or repaired.
        for (String refused : new String[] {
            "set a timer for twenty five hours", "set a timer for zero hours", "set a timer for sixty one minutes",
            "set a timer for one hours", "set a timer for two hour", "set a timer for one minutes",
            "set a timer for thirty minutes one hour", "set a timer for five seconds two minutes",
            "set a timer for one hour sixty minutes", "set a timer for two minutes sixty seconds",
            "set a timer for one hour one hour", "set a timer for five minutes five minutes",
            "set a timer for twenty four hours one minute", "set a timer for hours", "set a timer for one",
            "set a timer for one hour and", "set a timer for and five minutes", "set a timer for half an hour",
            "set a timer for one hour and and five minutes", "set a twenty five hour timer", "set a timer for",
        }) is(refused, 0);

        // The widened range does not widen cancel or add commands.
        if (!TimerCommand.valid(86400) || TimerCommand.valid(86401) || TimerCommand.valid(0)) throw new AssertionError("range");
        is("add two hours to timer one", 0);
        if (!TimerCommand.valid(TimerCommand.parse("add five minutes to timer one"))) throw new AssertionError("add");
        if (!TimerCommand.valid(TimerCommand.parse("cancel timer two"))) throw new AssertionError("cancel");

        // Every hour phrase and the chaining examples are in the recognizer's phrase list.
        String grammar = TimerPhrase.commandGrammar();
        for (String phrase : new String[] {"\"set a timer for an hour\"", "\"set a timer for twenty four hours\"",
            "\"timer for one hour\"", "\"set a timer for one hour and fifty nine minutes\"",
            "\"set a timer for two hours thirty minutes\"", "\"set a timer for one minute and thirty seconds\"",
            "\"set a timer for two minutes one second\"", "\"hey luna\"", "\"cancel timer one\""})
            if (!grammar.contains(phrase)) throw new AssertionError("grammar lacks " + phrase);
        checks++;

        System.out.println(checks + " timer duration checks passed");
    }
}
