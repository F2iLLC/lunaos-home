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
        System.out.println("Timer phrase boundary checks passed (16 cases).");
    }
}
