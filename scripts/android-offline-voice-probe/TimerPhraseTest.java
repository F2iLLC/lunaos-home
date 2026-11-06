package io.github.f2illc.lunaos.home.voiceprobe;

public final class TimerPhraseTest {
    private static void check(String text, int expected) {
        if (TimerPhrase.seconds(text) != expected) throw new AssertionError("Unexpected parse result");
    }
    public static void main(String[] args) {
        check("hey luna set a timer for ten seconds", 10);
        check("hey luna set a timer for one minute", 60);
        check("hey luna set a timer for twenty five minutes", 1500);
        check("hey luna set a timer for sixty minutes", 3600);
        for (String rejected : new String[] {null, "", "hey luna", "set a timer for ten seconds",
            "hey luna set a timer for zero seconds", "hey luna set a timer for sixty one minutes",
            "hey luna set a timer for ten", "hey luna set a timer for ten seconds please",
            "no hey luna set a timer for ten seconds", "hey luna set a timer for [unk] seconds",
            "hey luna set a timer for one seconds", "hey luna set a timer for 10 seconds"}) check(rejected, 0);
        String[][] diagnostics = {{"", "NO_SPEECH"}, {null, "NO_SPEECH"},
            {"[unk] set a timer for five seconds", "UNCLEAR_SPEECH"},
            {"hey luna", "WAKE_ONLY"}, {"set a timer for five", "INCOMPLETE_TIMER_PHRASE"},
            {"some fictional unrelated words", "OTHER_SPEECH"},
            {"set a timer for five seconds", "SUPPORTED_TIMER"}};
        for (String[] item : diagnostics) {
            if (!TimerPhrase.commandDiagnostic(item[0]).equals(item[1])) throw new AssertionError("Diagnostic category mismatch");
            if (!item[1].equals("SUPPORTED_TIMER") && TimerPhrase.commandSeconds(item[0]) != 0)
                throw new AssertionError("Diagnostic must not authorize rejected speech");
        }
        String[][] natural = { {"set timer for five seconds", "5"}, {"start a timer for one minute", "60"},
            {"timer for twenty five minutes", "1500"}, {"set a timer for 10 seconds", "10"},
            {"set a timer for five seconds please", "5"}, {"hey luna, set timer for five seconds.", "5"} };
        for (String[] item : natural) {
            int actual = TimerPhrase.commandSeconds(item[0]);
            if (actual != Integer.parseInt(item[1])) throw new AssertionError("Natural timer wording was not recognized");
        }
        for (String rejected : new String[] {"set a timer for zero seconds", "set a timer for 61 minutes",
            "set a timer for 5 seconds tomorrow", "please set a timer for five seconds", "cancel a timer"}) {
            if (TimerPhrase.commandSeconds(rejected) != 0) throw new AssertionError("Unsafe timer wording was accepted");
        }
        String[][] details = {{"set a timer for", "MISSING_DURATION_AND_UNIT"},
            {"set timer for five", "TIMER_WORDING_MISMATCH"},
            {"set a timer for seconds", "MISSING_DURATION"},
            {"set a timer for five", "MISSING_UNIT"},
            {"hey luna set a timer for five", "MISSING_UNIT"},
            {"set a timer for one seconds", "UNIT_NUMBER_MISMATCH"},
            {"set a timer for five second", "UNIT_NUMBER_MISMATCH"},
            {"set a timer for five seconds please", "SUPPORTED_TIMER"},
            {"timer set five seconds", "TIMER_WORDING_MISMATCH"},
            {"set timer for zero seconds", "TIMER_WORDING_MISMATCH"},
            {"set a timer for sixty one seconds", "TIMER_WORDING_MISMATCH"},
            {"set a timer for [unk] seconds", "UNCLEAR_SPEECH"},
            {null, "NO_SPEECH"}, {"", "NO_SPEECH"}, {"hey luna", "WAKE_ONLY"},
            {"fictional unrelated words", "OTHER_SPEECH"},
            {"set a timer for five seconds", "SUPPORTED_TIMER"}};
        for (String[] item : details) {
            String actualDetail = TimerPhrase.commandDetail(item[0]);
            if (!actualDetail.equals(item[1])) throw new AssertionError("Detailed category mismatch: " + actualDetail + " != " + item[1]);
            if (!item[1].equals("SUPPORTED_TIMER") && TimerPhrase.commandSeconds(item[0]) != 0)
                throw new AssertionError("Structural diagnosis must not authorize rejected speech");
        }
        // Every accepted duration keeps its exact authorization, in both command forms.
        for (int n = 1; n <= 60; n++) {
            for (String unit : new String[] {n == 1 ? " second" : " seconds", n == 1 ? " minute" : " minutes"}) {
                for (String wake : new String[] {"", "hey luna "}) {
                    String text = wake + "set a timer for " + TimerPhrase.number(n) + unit;
                    if (!TimerPhrase.commandDetail(text).equals("SUPPORTED_TIMER")) throw new AssertionError("Valid command misclassified");
                    if (TimerPhrase.commandSeconds(text) != n * (unit.contains("minute") ? 60 : 1))
                        throw new AssertionError("Valid command authorization changed");
                }
            }
        }
        System.out.println("Timer phrase boundary and diagnostic checks passed (280 cases).");
    }
}
