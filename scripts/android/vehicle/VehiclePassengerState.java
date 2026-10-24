package io.github.f2illc.lunaos.home.vehicle;

import java.util.*;
import org.json.*;

/** Owner configuration and short-lived manual evidence in VehicleState's private file. */
final class VehiclePassengerState implements VehiclePassengers.Provider {
    boolean silenced, ownerConfirmationEnabled;
    final List<VehiclePassengers.Profile> profiles = new ArrayList<>();
    private VehiclePassengers.Observation observation;
    private VehiclePassengers.Identity identity;
    private int evidenceBoot = -1;
    private static final String NEXT = "next_connection";

    public List<VehiclePassengers.Observation> snapshot() {
        return observation == null ? Collections.emptyList() : Collections.singletonList(observation);
    }
    void clearEvidence() { observation = null; identity = null; evidenceBoot = -1; }
    void confirm(VehiclePassengers.Occupied occupied, List<String> ids, String trip, long now, int boot) {
        observation = new VehiclePassengers.Observation(occupied, null, VehiclePassengers.Source.manual, null, now, trip);
        identity = ids.isEmpty() ? null : new VehiclePassengers.Identity(ids, trip, "owner_confirmation", now);
        evidenceBoot = boot;
    }
    void confirmNext(VehiclePassengers.Occupied occupied, List<String> ids, long now, int boot) { confirm(occupied, ids, NEXT, now, boot); }
    void connect(String trip, long now, int boot) {
        if (observation == null) return;
        if (evidenceBoot != boot || !VehiclePassengers.fresh(observation.observed_at, now)) { clearEvidence(); return; }
        if (NEXT.equals(observation.trip)) {
            confirm(observation.occupied, identity == null ? Collections.emptyList() : identity.profileIds, trip, observation.observed_at, boot);
        } else if (!trip.equals(observation.trip)) clearEvidence();
    }
    VehiclePassengers.Decision decide(String trip, long now, int boot, String period) {
        return VehiclePassengers.decide(evidenceBoot == boot ? this : null, trip, now, period, profiles,
            ownerConfirmationEnabled, evidenceBoot == boot ? identity : null, silenced);
    }
    JSONObject json() throws JSONException {
        JSONArray children = new JSONArray();
        for (VehiclePassengers.Profile p : profiles) children.put(new JSONObject().put("id", p.id).put("name", p.name).put("preference", p.preference.name()));
        JSONObject data = new JSONObject().put("silenced", silenced).put("ownerConfirmationEnabled", ownerConfirmationEnabled).put("profiles", children);
        if (observation != null) data.put("manual", new JSONObject().put("occupied", observation.occupied.name())
            .put("observed_at", observation.observed_at).put("trip", observation.trip).put("boot", evidenceBoot)
            .put("confirmedProfiles", new JSONArray(identity == null ? Collections.emptyList() : identity.profileIds)));
        return data;
    }
    static VehiclePassengerState read(JSONObject data) throws JSONException {
        VehiclePassengerState state = new VehiclePassengerState();
        if (data == null) return state;
        state.silenced = data.getBoolean("silenced"); state.ownerConfirmationEnabled = data.getBoolean("ownerConfirmationEnabled");
        JSONArray children = data.getJSONArray("profiles");
        if (children.length() > 6) throw new JSONException("Too many profiles");
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < children.length(); i++) {
            JSONObject p = children.getJSONObject(i);
            if (!ids.add(p.getString("id"))) throw new JSONException("Duplicate profile");
            state.profiles.add(new VehiclePassengers.Profile(p.getString("id"), p.getString("name"), VehiclePassengers.Preference.valueOf(p.getString("preference"))));
        }
        JSONObject manual = data.optJSONObject("manual");
        if (manual != null) {
            JSONArray selected = manual.getJSONArray("confirmedProfiles"); List<String> confirmed = new ArrayList<>();
            if (selected.length() > 6) throw new JSONException("Too many confirmations");
            for (int i = 0; i < selected.length(); i++) confirmed.add(selected.getString(i));
            state.confirm(VehiclePassengers.Occupied.valueOf(manual.getString("occupied")), confirmed,
                manual.getString("trip"), manual.getLong("observed_at"), manual.getInt("boot"));
        }
        return state;
    }
}
