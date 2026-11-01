package io.github.f2illc.lunaos.home.voiceprobe;

public final class WakeSessionTest {
    private static int checks;
    private static void check(boolean condition) {
        checks++;
        if (!condition) throw new AssertionError("Unexpected wake transition at case " + checks);
    }
    public static void main(String[] args) {
        WakeSession session = new WakeSession(1000);
        check(!session.awaitingCommand());
        check(session.acceptFinal("set a timer for ten seconds", 2000) == 0);
        check(session.acceptFinal("hey luna set a timer for ten seconds", 2001) == 0);
        for (String rejected : new String[] {null, "", "hello luna", "hey luna please", "[unk]", "no hey luna"})
            check(session.acceptFinal(rejected, 2002) == 0);
        check(session.acceptFinal("hey luna", 3000) == WakeSession.WAKE);
        check(session.awaitingCommand());
        check(session.deadline() == 13000);
        check(session.acceptFinal("hey luna", 4000) == 0);
        check(session.deadline() == 13000); // Duplicate wake never extends command capture.
        check(session.acceptFinal("set a timer for ten seconds please", 5000) == 0);
        check(session.acceptFinal("set a timer for ten seconds", 6000) == 10);
        check(session.acceptFinal("set a timer for ten seconds", 6001) == 0);
        check(session.expired(6001));
        WakeSession timed = new WakeSession(0);
        check(timed.acceptFinal("hey luna", 1) == WakeSession.WAKE);
        check(timed.acceptFinal("set a timer for ten seconds", 10001) == 0);
        check(timed.expired(10001));
        WakeSession late = new WakeSession(0);
        check(late.acceptFinal("hey luna", 299999) == WakeSession.WAKE);
        check(late.deadline() == 300000);
        check(late.acceptFinal("set a timer for ten seconds", 300000) == 0);
        check(new WakeSession(0).acceptFinal("hey luna", 300000) == 0);
        WakeSession full = new WakeSession(0);
        full.acceptFinal("hey luna", 1);
        check(full.acceptFinal("hey luna set a timer for one minute", 2) == 60);
        check(TimerPhrase.commandSeconds("set a timer for sixty minutes") == 3600);
        check(TimerPhrase.commandSeconds("set a timer for zero seconds") == 0);
        check(TimerPhrase.commandSeconds("set a timer for one seconds") == 0);
        check(TimerPhrase.commandSeconds(null) == 0);
        check(TimerPhrase.commandGrammar().contains("\"set a timer for ten seconds\""));
        check(WakeSession.grammar().equals("[\"[unk]\",\"hey luna\"]"));
        System.out.println("Wake session checks passed (" + checks + " cases).");
    }
}
