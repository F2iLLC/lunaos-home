package io.github.f2illc.lunaos.home.vehicle;

import android.app.*;
import android.content.Intent;
import android.widget.*;
import java.util.*;

/** Parked, explicit owner controls. No passenger identity discovery or export. */
final class VehiclePassengerSetup {
    private static void button(Activity activity, LinearLayout layout, String label, Runnable action) {
        Button b = new Button(activity); b.setText(label); b.setOnClickListener(v -> action.run()); layout.addView(b);
    }
    static void add(Activity activity, LinearLayout layout) {
        TextView help = new TextView(activity);
        help.setText("\nPassengers · parked setup only\nNo automatic passenger sensor is connected. Your confirmation lasts two minutes and applies to one trip. Presence alone never identifies a child. Names stay on this phone. Late changes do not cause another greeting.");
        layout.addView(help);
        Switch mute = new Switch(activity); mute.setText("Silence all greetings");
        mute.setChecked(new VehicleState(activity).passengers.silenced); layout.addView(mute);
        mute.setOnCheckedChangeListener((view, checked) -> {
            synchronized (VehicleRuntime.class) {
                VehicleState s = new VehicleState(activity); s.passengers.silenced = checked; s.save();
            }
            if (checked) activity.stopService(new Intent(activity, VehicleAudioService.class));
        });
        button(activity, layout, "Child names and preferences", () -> profiles(activity));
        button(activity, layout, "Confirm rear passengers (names unknown)", () -> confirm(activity, VehiclePassengers.Occupied.TRUE, Collections.emptyList()));
        button(activity, layout, "Confirm children riding along", () -> children(activity));
        button(activity, layout, "Confirm rear seats empty", () -> confirm(activity, VehiclePassengers.Occupied.FALSE, Collections.emptyList()));
        button(activity, layout, "Clear passenger confirmation", () -> {
            synchronized (VehicleRuntime.class) {
                VehicleState s = new VehicleState(activity); s.passengers.clearEvidence(); s.status = "Passenger presence unknown."; s.save();
            }
        });
    }
    private static void profiles(Activity activity) {
        VehicleState original = new VehicleState(activity);
        LinearLayout form = new LinearLayout(activity); form.setOrientation(LinearLayout.VERTICAL);
        CheckBox consent = new CheckBox(activity); consent.setText("Speak confirmed children's names");
        consent.setChecked(original.passengers.allowNames); form.addView(consent);
        TextView help = new TextView(activity);
        help.setText("You can confirm riders with names turned off. Stay quiet preferences still apply to confirmed riders."); form.addView(help);
        EditText[] names = new EditText[6]; Spinner[] preferences = new Spinner[6];
        for (int i = 0; i < 6; i++) {
            names[i] = new EditText(activity); names[i].setSingleLine(true); names[i].setHint("Child name (optional)"); form.addView(names[i]);
            preferences[i] = new Spinner(activity);
            preferences[i].setAdapter(new ArrayAdapter<String>(activity, android.R.layout.simple_spinner_dropdown_item,
                new String[]{"Use confirmed name", "Generic greeting only", "Stay quiet when present"})); form.addView(preferences[i]);
            if (i < original.passengers.profiles.size()) {
                VehiclePassengers.Profile p = original.passengers.profiles.get(i);
                names[i].setText(p.name); preferences[i].setSelection(p.preference.ordinal());
            }
        }
        ScrollView scroll = new ScrollView(activity); scroll.addView(form);
        AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("Child greeting preferences").setView(scroll)
            .setNegativeButton("Cancel", null).setPositiveButton("Save", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            List<VehiclePassengers.Profile> saved = new ArrayList<>();
            for (int i = 0; i < 6; i++) {
                String name = names[i].getText().toString().trim(); if (name.isEmpty()) continue;
                if (!VehicleGreetings.validName(name)) { names[i].setError("Use 1 to 40 characters without control characters or braces."); return; }
                saved.add(new VehiclePassengers.Profile("child_" + i, name, VehiclePassengers.Preference.values()[preferences[i].getSelectedItemPosition()]));
            }
            synchronized (VehicleRuntime.class) {
                VehicleState s = new VehicleState(activity); s.passengers.profiles.clear(); s.passengers.profiles.addAll(saved);
                s.passengers.allowNames = consent.isChecked(); s.passengers.clearEvidence();
                s.status = "Preferences saved. Confirm passengers again before the next greeting.";
                if (!s.save()) return;
            }
            dialog.dismiss();
        })); dialog.show();
    }
    private static void children(Activity activity) {
        VehicleState s = new VehicleState(activity);
        if (s.passengers.profiles.isEmpty()) {
            VehicleRuntime.status(activity, "Save child names and preferences first."); return;
        }
        boolean[] selected = new boolean[s.passengers.profiles.size()];
        String[] names = s.passengers.profiles.stream().map(p -> p.name).toArray(String[]::new);
        new AlertDialog.Builder(activity).setTitle("Who have you confirmed is riding?")
            .setMultiChoiceItems(names, selected, (dialog, index, checked) -> selected[index] = checked)
            .setNegativeButton("Cancel", null).setPositiveButton("Confirm", (dialog, which) -> {
                List<String> ids = new ArrayList<>();
                for (int i = 0; i < selected.length; i++) if (selected[i]) ids.add(s.passengers.profiles.get(i).id);
                if (!ids.isEmpty()) confirm(activity, VehiclePassengers.Occupied.TRUE, ids);
            }).show();
    }
    private static void confirm(Activity activity, VehiclePassengers.Occupied occupied, List<String> ids) {
        new AlertDialog.Builder(activity).setTitle("Use this confirmation for…")
            .setMessage("Valid for two minutes. A trip that already greeted stays quiet. Reconnecting within two minutes is the same trip.")
            .setNegativeButton("Cancel", null)
            .setNeutralButton("Current trip", (dialog, which) -> save(activity, occupied, ids, false))
            .setPositiveButton("Next connection", (dialog, which) -> save(activity, occupied, ids, true)).show();
    }
    private static void save(Activity activity, VehiclePassengers.Occupied occupied, List<String> ids, boolean next) {
        synchronized (VehicleRuntime.class) {
            VehicleState s = new VehicleState(activity);
            if (next) s.passengers.confirmNext(occupied, ids, System.currentTimeMillis(), VehicleRuntime.boot(activity));
            else if (!s.trip.id.isEmpty() && s.trip.disconnectedAt < 0) s.passengers.confirm(occupied, ids, s.trip.id, System.currentTimeMillis(), VehicleRuntime.boot(activity));
            else { VehicleRuntime.status(activity, "No connected trip. Choose next connection instead."); return; }
            s.status = "Passenger confirmation saved for " + (next ? "the next connection." : "this trip."); s.save();
        }
    }
}
