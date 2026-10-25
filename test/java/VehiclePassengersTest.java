package io.github.f2illc.lunaos.home.vehicle;

import java.util.*;
import static io.github.f2illc.lunaos.home.vehicle.VehiclePassengers.*;

/** Simulated inputs and audio sink. No phone, sensor, CUE or audible result is claimed. */
public final class VehiclePassengersTest {
    static final long NOW = 1_800_000_000_000L;
    static final class Sensor implements Provider {
        List<Observation> values = new ArrayList<>();
        public List<Observation> snapshot() { return values; }
    }
    static void check(boolean value) { if (!value) throw new AssertionError(); }
    static Observation reading(Occupied value, Seat seat, String trip, long time) {
        return new Observation(value, seat, Source.independent_sensor, null, time, trip);
    }
    static final class Flow {
        final VehicleTrip trip = new VehicleTrip();
        final Sensor sensor = new Sensor();
        final List<String> audio = new ArrayList<>();
        final List<Profile> profiles = Arrays.asList(new Profile("alex", "Alex", Preference.named), new Profile("sam", "Sam", Preference.named));
        Identity identity; boolean configured, disabled;
        long now = NOW;
        Flow() { trip.connect(0, 1); }
        Decision decision() { return decide(sensor, trip.id, now, "afternoon", profiles, configured, identity, disabled); }
        void present(Seat seat) { sensor.values.add(reading(Occupied.TRUE, seat, trip.id, now)); }
        void confirm(String mechanism, long time, String tripId, String... ids) { identity = new Identity(Arrays.asList(ids), tripId, mechanism, time); }
        // Exercise the same selection -> route check -> durable trip claim order as Android,
        // with the final speaker replaced by an in-memory sink.
        void deliver(Decision prepared, boolean route) {
            VehicleGreetings.Choice choice = VehiclePassengers.choose("afternoon", "Example", -1, "", prepared);
            if (choice == null || !prepared.same(decision())) return;
            VehiclePlaybackGate gate = new VehiclePlaybackGate();
            gate.observe(route, false); gate.seekCompleted();
            if (gate.observe(route, true) == VehiclePlaybackGate.Decision.UNMUTE && trip.claim()) audio.add(choice.text);
        }
        void greet() { deliver(decision(), true); }
    }
    public static void main(String[] args) {
        Flow f = new Flow(); String scenario = args[0];
        switch (scenario) {
        case "driver":
            f.sensor.values.add(reading(Occupied.FALSE, null, f.trip.id, NOW));
            check(presence(f.sensor, f.trip.id, NOW) == Occupied.FALSE); f.greet(); check(f.audio.size() == 1); check(!f.audio.get(0).contains("passengers")); break;
        case "one": case "multiple":
            f.present(Seat.rear_left); if (scenario.equals("multiple")) f.present(Seat.rear_right);
            f.greet(); check(f.audio.size() == 1 && f.audio.get(0).startsWith("Hello, passengers!")); check(!f.audio.get(0).contains("Alex")); break;
        case "unknown":
            check(presence(f.sensor, f.trip.id, NOW) == Occupied.UNKNOWN); f.greet(); check(f.audio.size() == 1);
            check(!f.audio.get(0).matches(".*(alone|empty|no passengers).*")); break;
        case "partial-negative":
            f.sensor.values.add(reading(Occupied.FALSE, Seat.rear_left, f.trip.id, NOW));
            check(presence(f.sensor, f.trip.id, NOW) == Occupied.UNKNOWN);
            f.sensor.values.add(reading(Occupied.FALSE, Seat.rear_center, f.trip.id, NOW));
            f.sensor.values.add(reading(Occupied.FALSE, Seat.rear_right, f.trip.id, NOW));
            check(presence(f.sensor, f.trip.id, NOW) == Occupied.FALSE); break;
        case "conflict":
            f.present(Seat.rear_left); f.sensor.values.add(reading(Occupied.FALSE, Seat.rear_left, f.trip.id, NOW));
            check(presence(f.sensor, f.trip.id, NOW) == Occupied.UNKNOWN); check(f.decision().kind.equals("driver"));
            f.sensor.values.clear(); f.present(Seat.rear_left); f.sensor.values.add(reading(Occupied.FALSE, null, f.trip.id, NOW));
            check(presence(f.sensor, f.trip.id, NOW) == Occupied.UNKNOWN); break;
        case "stale": case "future":
            f.sensor.values.add(reading(Occupied.TRUE, null, f.trip.id, scenario.equals("stale") ? NOW - MAX_AGE_MS : NOW + 1));
            check(presence(f.sensor, f.trip.id, NOW) == Occupied.UNKNOWN); f.greet(); check(f.audio.size() == 1); break;
        case "disconnect":
            f.present(null); check(f.decision().kind.equals("group")); f.sensor.values.clear();
            check(f.decision().kind.equals("driver")); f.greet(); check(f.audio.size() == 1); break;
        case "late":
            check(f.decision().kind.equals("driver")); f.now += SETTLE_MS - 1; f.present(null);
            f.now++; f.greet(); check(f.audio.size() == 1 && f.audio.get(0).contains("passengers")); break;
        case "too-late":
            f.now += SETTLE_MS; f.greet(); f.present(null); f.greet(); check(f.audio.size() == 1); break;
        case "reconnect":
            f.present(null); f.greet(); String previous = f.trip.id;
            f.trip.disconnect(100, 1); f.trip.connect(101, 1); f.greet(); check(previous.equals(f.trip.id)); check(f.audio.size() == 1); break;
        case "new-trip":
            f.present(null); f.greet(); f.trip.disconnect(100, 1); f.trip.connect(100 + VehicleTrip.GRACE_MS, 1);
            check(f.decision().kind.equals("driver")); f.greet(); check(f.audio.size() == 2); break;
        case "named":
            f.present(null); f.configured = true; f.confirm("owner_confirmation", NOW, f.trip.id, "alex", "sam");
            f.greet(); check(f.audio.equals(Collections.singletonList("Good afternoon, Alex and Sam! Lovely to have you along for the adventure."))); break;
        case "unconfigured": case "incorrect-identity": case "stale-identity": case "wrong-trip-identity": case "weight-identity":
            f.present(null); f.configured = !scenario.equals("unconfigured");
            f.confirm(scenario.equals("weight-identity") ? "weight" : "owner_confirmation",
                scenario.equals("stale-identity") ? NOW - MAX_AGE_MS : NOW,
                scenario.equals("wrong-trip-identity") ? "previous" : f.trip.id,
                scenario.equals("incorrect-identity") ? "missing" : "alex");
            f.greet(); check(f.audio.size() == 1 && f.audio.get(0).startsWith("Hello, passengers!")); break;
        case "generic-preference": case "silent-preference":
            f.present(null); f.confirm("owner_confirmation", NOW, f.trip.id, "alex");
            Decision decision = decide(f.sensor, f.trip.id, NOW, "afternoon",
                Arrays.asList(new Profile("alex", "Alex", scenario.equals("generic-preference") ? Preference.generic : Preference.silent)), true, f.identity, false);
            check(decision.kind.equals(scenario.equals("generic-preference") ? "group" : "silent")); break;
        case "silent-no-names": case "mixed-silent-no-names":
            f.present(null);
            f.profiles.set(0, new Profile("alex", "Alex", Preference.silent));
            f.confirm("owner_confirmation", NOW, f.trip.id,
                scenario.equals("mixed-silent-no-names") ? new String[]{"sam", "alex"} : new String[]{"alex"});
            check(!f.configured); check(f.decision().kind.equals("silent"));
            f.greet(); check(f.audio.isEmpty()); check(!f.trip.claimed); break;
        case "unconfirmed-silent": case "stale-silent-no-names":
            f.present(null); f.profiles.set(0, new Profile("alex", "Alex", Preference.silent));
            if (scenario.equals("stale-silent-no-names")) f.confirm("owner_confirmation", NOW - MAX_AGE_MS, f.trip.id, "alex");
            f.greet(); check(f.audio.size() == 1 && f.audio.get(0).startsWith("Hello, passengers!"));
            check(!f.audio.get(0).contains("Alex")); break;
        case "disabled":
            f.disabled = true; f.present(null); f.greet(); check(f.audio.isEmpty()); break;
        case "changed-before-audio":
            f.present(null); Decision prepared = f.decision(); f.sensor.values.clear(); f.deliver(prepared, true); check(f.audio.isEmpty());
            f.present(null); prepared = f.decision(); f.now += MAX_AGE_MS; f.deliver(prepared, true); check(f.audio.isEmpty()); break;
        case "no-route":
            f.present(null); f.deliver(f.decision(), false); check(f.audio.isEmpty()); check(!f.trip.claimed); break;
        case "invalid-input":
            for (double confidence : new double[]{Double.NaN, Double.POSITIVE_INFINITY, -1, 2}) {
                try { new Observation(Occupied.TRUE, null, Source.manual, confidence, NOW, f.trip.id); throw new AssertionError(); }
                catch (IllegalArgumentException expected) { }
            }
            f.present(null); f.configured = true; f.confirm("owner_confirmation", NOW, f.trip.id, "alex", "alex");
            check(f.decision().kind.equals("group")); break;
        case "provider-failure":
            check(presence(() -> { throw new IllegalStateException("disconnected"); }, f.trip.id, NOW) == Occupied.UNKNOWN);
            check(presence(null, f.trip.id, NOW) == Occupied.UNKNOWN); break;
        default: throw new AssertionError("Unknown scenario");
        }
        System.out.println(scenario + " passed (simulated)");
    }
}
