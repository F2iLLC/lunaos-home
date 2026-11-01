package io.github.f2illc.lunaos.home.voiceprobe;

public final class TimerHandoffGateTest {
    private static void check(boolean condition) {
        if (!condition) throw new AssertionError("Unexpected timer authorization");
    }
    public static void main(String[] args) {
        check(!new TimerHandoffGate(false).claim(true, true, 10)); // Late opt-in cannot authorize an old session.
        check(!new TimerHandoffGate(true).claim(false, true, 10)); // Revoked.
        check(!new TimerHandoffGate(true).claim(true, false, 10)); // Background/blocked.
        check(!new TimerHandoffGate(true).claim(true, true, 0));
        check(!new TimerHandoffGate(true).claim(true, true, -1));
        check(!new TimerHandoffGate(true).claim(true, true, 3601));
        check(new TimerHandoffGate(true).claim(true, true, 1));
        check(new TimerHandoffGate(true).claim(true, true, 3600));
        TimerHandoffGate gate = new TimerHandoffGate(true);
        check(gate.claim(true, true, 10));
        check(!gate.claim(true, true, 10)); // Duplicate callback.
        check(!gate.claim(true, true, 60)); // Same session cannot dispatch another duration.
        System.out.println("Timer handoff authorization checks passed (11 cases).");
    }
}
