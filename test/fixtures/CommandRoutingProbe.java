package io.github.f2illc.lunaos.home.voiceprobe;

public final class CommandRoutingProbe {
    private static int checks;
    private static void check(boolean value, String label) {
        checks++;
        if (!value) throw new AssertionError(label);
    }
    public static void main(String[] args) {
        check(TimerCommand.parse("Hey Luna, CANCEL TIMER 2 please!") == TimerCommand.cancel(2), "normalized cancellation");
        check(TimerCommand.parse("Add 5 minutes to timer 2.") == TimerCommand.add(2, 300), "digit extension");
        check(TimerCommand.parse("set another timer for 5 seconds please") == 5, "another timer");
        check(TimerCommand.parse("start a five minute timer") == 300, "duration before timer");
        for (int n = 1; n <= 60; n++) {
            String number = TimerPhrase.number(n);
            for (int target = 0; target <= 8; target++) {
                String timer = target == 0 ? "the timer" : "timer " + target;
                // "the timer" names no number: it stops what is ringing, else the one active timer.
                check(TimerCommand.parse("cancel " + timer) == (target == 0 ? TimerCommand.STOP : TimerCommand.cancel(target)), "cancel target");
                for (String unit : new String[] {n == 1 ? "second" : "seconds", n == 1 ? "minute" : "minutes"}) {
                    int duration = n * (unit.startsWith("minute") ? 60 : 1);
                    check(TimerCommand.parse("add " + n + " " + unit + " to " + timer) == TimerCommand.add(target, duration), "exact extension");
                    check(TimerCommand.parse("set another timer for " + number + " " + unit) == duration, "exact creation");
                }
            }
        }
        for (String text : new String[] {"cancel timer 9", "cancel timer 0", "cancel both timers", "don't cancel timer two",
            "add -5 seconds to timer 2", "add 61 minutes to timer two", "add five seconds to timer two tomorrow",
            "add to the timer", "add to timer 2", "add seconds to the timer",
            "set a timer for -5 seconds", "set a timer for 1.5 minutes", "set a timer for 65 minutes",
            "set a five minutes timer", "start a five minute timer tomorrow", "set a timer for five seconds and cancel timer two"}) {
            check(TimerCommand.parse(text) == 0, "ambiguous command rejected");
        }
        for (String text : new String[] {"Hey Luna!", "hey luna", "SET A TIMER", "set time for five seconds", "five minutes",
            "5 seconds please", "Cancel timer nine", "add one minute", "[UNK]", "hi\nthere"}) {
            check(!QuestionPolicy.accepts(text), "timer or wake fragment cannot be a question");
        }
        for (String text : new String[] {"why is the sky blue", "How many seconds are in a minute?", "tell me a story about a dragon"}) {
            check(QuestionPolicy.accepts(text), "ordinary question accepted");
        }
        WakeSession wake = new WakeSession(0, true);
        check(!wake.acceptQuestion("why is the sky blue", 1), "no question before wake");
        wake.acceptFinal("hey luna", 2);
        wake.acceptFinal("hey luna", 3);
        check(!wake.acceptQuestion("hey luna", 3), "duplicate wake stays local");
        wake.acceptFinal("set a timer", 4);
        check(!wake.acceptQuestion("why is the sky blue", 5), "incomplete timer cannot fall through to Qwen");
        check(wake.acceptFinal("set a timer for five seconds", 6) == 5, "complete timer retry remains possible");
        check(!wake.acceptQuestion("why is the sky blue", 7), "one effect per wake");
        wake = new WakeSession(0, true);
        wake.acceptFinal("hey luna", 1);
        check(wake.acceptFinal("why is the sky blue", 2) == 0, "question creates no timer");
        check(wake.acceptQuestion("why is the sky blue", 2), "final question accepted");
        check(!wake.acceptQuestion("why is the sky blue", 3), "question is single use");
        wake = new WakeSession(0, true);
        wake.acceptFinal("hey luna", 1);
        check(!wake.acceptQuestion("why is the sky blue", 15001), "expired question rejected");
        System.out.println("Command routing checks passed (" + checks + " cases).");
    }
}
