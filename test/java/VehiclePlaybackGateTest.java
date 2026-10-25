package io.github.f2illc.lunaos.home.vehicle;

import static io.github.f2illc.lunaos.home.vehicle.VehiclePlaybackGate.Decision.*;

public final class VehiclePlaybackGateTest {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        VehiclePlaybackGate gate = new VehiclePlaybackGate();
        check(gate.observe(false, false) == WAIT);
        check(gate.observe(true, false) == SEEK);
        check(gate.observe(true, false) == WAIT);
        // Output changes while the asynchronous seek is pending, with the
        // Bluetooth ACL still connected. The old observation cannot unmute.
        check(gate.observe(false, false) == WAIT);
        gate.seekCompleted(); check(gate.observe(false, false) == WAIT);
        check(gate.observe(true, false) == UNMUTE);
        gate.started(); check(gate.observe(true, true) == WAIT);
        check(gate.observe(false, false) == STOP);
        gate.stop(); check(gate.observe(true, false) == STOP);
        gate = new VehiclePlaybackGate();
        check(gate.observe(true, false) == SEEK); gate.seekCompleted();
        check(gate.observe(false, true) == STOP);
        gate.stop(); gate.seekCompleted(); check(gate.observe(true, false) == STOP);
        System.out.println("VehiclePlaybackGate: changed route across seek, delayed route, timeout, loss and cancellation passed");
    }
}
