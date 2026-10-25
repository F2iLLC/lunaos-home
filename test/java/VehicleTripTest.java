package io.github.f2illc.lunaos.home.vehicle;

public final class VehicleTripTest {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        VehicleTrip trip = new VehicleTrip();
        check(trip.connect(0, 1)); String first = trip.id;
        check(trip.claim()); check(!trip.claim()); check(!trip.connect(50, 1));
        trip.disconnect(100, 1); check(!trip.claim());
        trip.disconnect(1000, 1); check(trip.disconnectedAt == 100);
        check(!trip.connect(119_999, 1)); check(first.equals(trip.id)); check(!trip.claim());
        trip.disconnect(120_000, 1); check(!trip.ended(239_999, 1)); check(trip.ended(240_000, 1));
        check(trip.connect(240_000, 1)); check(!first.equals(trip.id)); check(trip.claim());
        // Process recreation restores this state; reboot without a confirmed
        // disconnect is uncertain, so it must not replay an already claimed trip.
        check(!trip.connect(0, 2)); check(!trip.claim());
        trip.disconnect(5, 2); check(trip.connect(0, 3)); check(trip.claim());
        trip.disconnect(10, 3); check(trip.connect(1, 3));
        System.out.println("VehicleTrip: connect, duplicate, grace boundary, end, reboot and clock rollback passed");
    }
}
