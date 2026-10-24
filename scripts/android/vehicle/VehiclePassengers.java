package io.github.f2illc.lunaos.home.vehicle;

import java.util.*;

/** Local, read-only evidence contract. No vehicle bus, identity inference or I/O. */
public final class VehiclePassengers {
    public static final long MAX_AGE_MS = 120_000;
    public static final long SETTLE_MS = 2500;
    public enum Occupied { TRUE, FALSE, UNKNOWN }
    public enum Source { supported_vehicle, independent_sensor, manual }
    public enum Seat { rear_left, rear_center, rear_right }
    public enum Preference { named, generic, silent }

    public static final class Observation {
        public final Occupied occupied;
        // null means the entire rear row, never an unspecified front seat.
        public final Seat seat_position;
        public final Source source;
        public final Double confidence;
        // UTC epoch milliseconds supplied by the adapter, not receipt time.
        public final long observed_at;
        public final String trip;
        public Observation(Occupied occupied, Seat seat, Source source, Double confidence, long observedAt, String trip) {
            if (occupied == null || source == null || trip == null || trip.isEmpty() || observedAt < 0 ||
                (confidence != null && (!Double.isFinite(confidence) || confidence < 0 || confidence > 1)))
                throw new IllegalArgumentException("Invalid passenger observation");
            this.occupied = occupied; seat_position = seat; this.source = source;
            this.confidence = confidence; observed_at = observedAt; this.trip = trip;
        }
    }
    /** Adapters must return their current snapshot; disconnect clears old readings.
     * Registration/trust and documented sensor thresholds belong to the adapter.
     * A source label is provenance, not authentication. No physical adapter ships here. */
    public interface Provider { List<Observation> snapshot(); }

    public static boolean fresh(long observedAt, long now) {
        return observedAt >= 0 && observedAt <= now && now - observedAt < MAX_AGE_MS;
    }
    public static Occupied presence(Provider provider, String trip, long now) {
        List<Observation> readings;
        try { readings = provider == null ? null : provider.snapshot(); }
        catch (RuntimeException disconnected) { return Occupied.UNKNOWN; }
        if (readings == null || readings.size() > 32) return Occupied.UNKNOWN;
        // Index 0 is the whole rear row. Only fully covered negatives mean empty.
        int[] states = new int[4];
        for (Observation r : readings) {
            if (r == null || !r.trip.equals(trip) || !fresh(r.observed_at, now)) continue;
            int index = r.seat_position == null ? 0 : r.seat_position.ordinal() + 1;
            states[index] |= r.occupied == Occupied.TRUE ? 1 : r.occupied == Occupied.FALSE ? 2 : 4;
        }
        for (int state : states) if (state == 3 || (state & 4) != 0 && (state & 3) != 0) return Occupied.UNKNOWN;
        boolean anyPresent = states[1] == 1 || states[2] == 1 || states[3] == 1;
        boolean allEmpty = states[1] == 2 && states[2] == 2 && states[3] == 2;
        if (states[0] == 2 && anyPresent || states[0] == 1 && allEmpty) return Occupied.UNKNOWN;
        if (states[0] == 1 || anyPresent) return Occupied.TRUE;
        if (states[0] == 2 || allEmpty) return Occupied.FALSE;
        return Occupied.UNKNOWN;
    }
    public static final class Profile {
        public final String id, name;
        public final Preference preference;
        public Profile(String id, String name, Preference preference) {
            if (id == null || !id.matches("[a-z0-9_-]{1,32}") || !VehicleGreetings.validName(name) || preference == null)
                throw new IllegalArgumentException("Invalid child profile");
            this.id = id; this.name = name.trim(); this.preference = preference;
        }
    }
    public static final class Identity {
        public final List<String> profileIds;
        public final String trip, mechanism;
        public final long observed_at;
        public Identity(List<String> ids, String trip, String mechanism, long observedAt) {
            profileIds = Collections.unmodifiableList(new ArrayList<>(ids));
            this.trip = trip; this.mechanism = mechanism; observed_at = observedAt;
        }
    }
    public static final class Decision {
        public final String kind, text;
        Decision(String kind, String text) { this.kind = kind; this.text = text; }
        public boolean same(Decision other) { return other != null && kind.equals(other.kind) && Objects.equals(text, other.text); }
    }
    public static Decision decide(Provider provider, String trip, long now, String period,
                                  List<Profile> profiles, boolean ownerConfirmationEnabled,
                                  Identity identity, boolean silenced) {
        if (silenced) return new Decision("silent", null);
        if (presence(provider, trip, now) != Occupied.TRUE) return new Decision("driver", null);
        Decision generic = new Decision("group", "Hello, passengers! Lovely to have you along for the adventure.");
        if (!ownerConfirmationEnabled || identity == null || !"owner_confirmation".equals(identity.mechanism) ||
            !trip.equals(identity.trip) || !fresh(identity.observed_at, now) || identity.profileIds.isEmpty() ||
            identity.profileIds.size() > 6 || profiles == null || profiles.size() > 6) return generic;
        Map<String, Profile> byId = new HashMap<>();
        for (Profile p : profiles) if (p == null || byId.put(p.id, p) != null) return generic;
        Set<String> seen = new HashSet<>(); List<String> names = new ArrayList<>();
        boolean genericRequested = false, silentRequested = false;
        for (String id : identity.profileIds) {
            Profile p = byId.get(id);
            if (p == null || !seen.add(id)) return generic;
            if (p.preference == Preference.silent) silentRequested = true;
            if (p.preference == Preference.generic) genericRequested = true;
            names.add(p.name);
        }
        if (silentRequested) return new Decision("silent", null);
        if (genericRequested) return generic;
        if (!Arrays.asList("morning", "afternoon", "evening").contains(period)) throw new IllegalArgumentException("Invalid period");
        String joined = names.size() == 1 ? names.get(0) : String.join(", ", names.subList(0, names.size() - 1)) + " and " + names.get(names.size() - 1);
        return new Decision("named", "Good " + period + ", " + joined + "! Lovely to have you along for the adventure.");
    }
    private VehiclePassengers() { }
}
