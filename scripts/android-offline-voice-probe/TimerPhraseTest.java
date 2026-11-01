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
        System.out.println("Timer phrase boundary and diagnostic checks passed (23 cases).");
    }
}
