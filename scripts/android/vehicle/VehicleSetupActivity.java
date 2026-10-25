package io.github.f2illc.lunaos.home.vehicle;

import android.Manifest;
import android.app.*;
import android.bluetooth.*;
import android.companion.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.widget.*;

/** Attended setup and entry to a separately opted-in parked conversation. */
public final class VehicleSetupActivity extends Activity {
    private TextView status;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private String pendingAddress;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (Build.VERSION.SDK_INT < 31) { finish(); return; }
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); layout.setPadding(28, 48, 28, 28);
        ScrollView scroll = new ScrollView(this); scroll.addView(layout); setContentView(scroll);
        TextView title = new TextView(this); title.setText("LunaOS Home · Vehicle greetings"); title.setTextSize(24); layout.addView(title);
        TextView help = new TextView(this);
        help.setText("Set up while parked. Choose the vehicle you already paired in Android. Allow companion access for automatic greetings. Home receives neither the Bluetooth address nor names. No location or trip history is collected. Home receives an ephemeral session only if you separately enable its paired connection. When Home is unavailable, a local greeting uses the time of day. No appointments or vehicle condition are inferred.\n\nOptional ElevenLabs speech uses clips prepared separately with your chosen voice and greeting text (including the nickname). Preparation sends that text to the provider; playback is offline. No provider key is stored on this phone.\n\nThis is an opt-in development preview; Android or your vehicle audio system may prevent automatic audio. Wired Android Auto audio needs a separate attended check.");
        layout.addView(help); status = new TextView(this); layout.addView(status);
        VehicleState initial = new VehicleState(this);
        TextView nameLabel = new TextView(this); nameLabel.setText("Vehicle name (only on this phone)"); layout.addView(nameLabel);
        EditText name = new EditText(this); name.setSingleLine(true); name.setText(initial.name); layout.addView(name);
        TextView nicknameLabel = new TextView(this); nicknameLabel.setText("Name used in greetings"); layout.addView(nicknameLabel);
        EditText nickname = new EditText(this); nickname.setSingleLine(true); nickname.setText(initial.nickname); layout.addView(nickname);
        button(layout, "Save greeting names", () -> {
            String display = name.getText().toString().trim(), spoken = nickname.getText().toString().trim();
            if (!VehicleGreetings.validName(display) || !VehicleGreetings.validName(spoken)) {
                VehicleRuntime.status(this, "Use names of 1 to 40 characters without control characters or braces."); return;
            }
            synchronized (VehicleRuntime.class) {
                VehicleState state = new VehicleState(this); state.name = display; state.nickname = spoken;
                state.status = "Names saved on this phone. The next greeting will use your chosen name."; state.save();
            }
        });
        TextView voiceLabel = new TextView(this); voiceLabel.setText("ElevenLabs voice ID (blank uses Android offline voice)"); layout.addView(voiceLabel);
        EditText voice = new EditText(this); voice.setSingleLine(true); voice.setText(initial.voiceId); layout.addView(voice);
        button(layout, "Save greeting voice", () -> {
            String selected = voice.getText().toString().trim();
            if (!VehicleVoiceCache.validVoice(selected)) { VehicleRuntime.status(this, "Enter a voice ID of 20 to 64 letters/digits, or leave it blank."); return; }
            synchronized (VehicleRuntime.class) {
                VehicleState state = new VehicleState(this); state.voiceId = selected;
                state.status = selected.isEmpty() ? "Android offline voice selected." : "ElevenLabs voice selected. Its complete greeting cache must be installed separately for this nickname.";
                state.save();
            }
        });
        button(layout, "Choose your vehicle", this::choose);
        button(layout, "Allow Home connection", this::allowHome);
        button(layout, "Talk to Luna while parked", () -> {
            if (localNetworkRequired()) { allowHome(); return; }
            startActivity(new Intent(this, VehicleConversationActivity.class));
        });
        button(layout, "Try greeting while parked", () -> {
            VehicleState state = new VehicleState(this);
            stopService(new Intent(this, VehicleAudioService.class));
            VehicleReceiver.start(this, state.address, true);
        });
        button(layout, "Disable vehicle greetings", () -> {
            VehicleState state = new VehicleState(this);
            VehicleReceiver.disconnect(this, state.address);
            try {
                CompanionDeviceManager manager = getSystemService(CompanionDeviceManager.class);
                if (!state.address.isEmpty()) { manager.stopObservingDevicePresence(state.address); manager.disassociate(state.address); }
            } catch (Exception ignored) { }
            synchronized (VehicleRuntime.class) {
                state = new VehicleState(this); state.address = ""; state.trip = new VehicleTrip(); state.status = "Vehicle greetings disabled."; state.save();
            }
        });
        refresh();
    }
    private void button(LinearLayout layout, String text, Runnable action) {
        Button b = new Button(this); b.setText(text); b.setOnClickListener(v -> action.run()); layout.addView(b);
    }
    private void refresh() {
        VehicleState state = new VehicleState(this);
        String message = state.trip.ended(SystemClock.elapsedRealtime(), VehicleRuntime.boot(this)) ? "Session ended." : state.status;
        status.setText("\n" + message + "\nHome: " + state.backend + "\nVoice: " + (state.voiceId.isEmpty() ? "Android offline" : "ElevenLabs cached") + "\nAudio: " + state.audio + "\n");
        ui.postDelayed(this::refresh, 1000);
    }
    private void choose() {
        if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, 1); return;
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 2); return;
        }
        BluetoothAdapter adapter = getSystemService(BluetoothManager.class).getAdapter();
        if (adapter == null || !adapter.isEnabled()) { VehicleRuntime.status(this, "Turn on Bluetooth and pair your vehicle in Android first."); return; }
        java.util.List<BluetoothDevice> devices = new java.util.ArrayList<>(adapter.getBondedDevices());
        if (devices.isEmpty()) { VehicleRuntime.status(this, "Pair your vehicle in Android first."); return; }
        String[] labels = new String[devices.size()];
        for (int n = 0; n < devices.size(); n++) labels[n] = devices.get(n).getName() + " · " + devices.get(n).getAddress();
        new AlertDialog.Builder(this).setTitle("Which paired device is your vehicle?").setItems(labels, (dialog, which) -> associate(devices.get(which).getAddress())).show();
    }
    private boolean localNetworkRequired() {
        return Build.VERSION.SDK_INT >= 37 && getApplicationInfo().targetSdkVersion >= 37
            && checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") != PackageManager.PERMISSION_GRANTED;
    }
    private void allowHome() {
        if (localNetworkRequired()) requestPermissions(new String[]{"android.permission.ACCESS_LOCAL_NETWORK"}, 3);
        else VehicleRuntime.status(this, "Android allows the Home connection. The paired Home host must also be running.");
    }
    private void associate(String address) {
        if (!getPackageManager().hasSystemFeature(PackageManager.FEATURE_COMPANION_DEVICE_SETUP)) {
            VehicleRuntime.status(this, "This phone does not support Android companion setup."); return;
        }
        if (!new VehicleState(this).address.isEmpty()) { VehicleRuntime.status(this, "Disable the existing selection before choosing again."); return; }
        pendingAddress = address;
        CompanionDeviceManager manager = getSystemService(CompanionDeviceManager.class);
        if (manager.getAssociations().contains(address)) { enable(address); return; }
        AssociationRequest request = new AssociationRequest.Builder().addDeviceFilter(new BluetoothDeviceFilter.Builder().setAddress(address).build()).setSingleDevice(true).build();
        manager.associate(request, new CompanionDeviceManager.Callback() {
            @Override public void onDeviceFound(IntentSender chooser) {
                try { startIntentSenderForResult(chooser, 42, null, 0, 0, 0); }
                catch (IntentSender.SendIntentException failed) { VehicleRuntime.status(VehicleSetupActivity.this, "Android companion setup unavailable."); }
            }
            @Override public void onFailure(CharSequence error) { VehicleRuntime.status(VehicleSetupActivity.this, "Companion association was not completed."); }
        }, ui);
    }
    private void enable(String address) {
        try {
            CompanionDeviceManager manager = getSystemService(CompanionDeviceManager.class);
            if (!manager.getAssociations().contains(address)) throw new SecurityException();
            manager.startObservingDevicePresence(address);
            synchronized (VehicleRuntime.class) {
                VehicleState state = new VehicleState(this); state.address = address; state.status = "Automatic greetings enabled for the selected vehicle.";
                if (!state.save()) throw new IllegalStateException();
            }
            VehicleReceiver.start(this, address, true);
        } catch (Exception failed) { VehicleRuntime.status(this, "Companion access unavailable. Reopen setup while parked."); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 42 && result == RESULT_OK && pendingAddress != null) enable(pendingAddress);
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == 3) {
            VehicleRuntime.status(this, grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED
                ? "Home network access allowed. You can open Talk to Luna while parked."
                : "Home network access declined. Offline greetings remain available.");
            return;
        }
        if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) choose();
        else VehicleRuntime.status(this, "Permission declined. Automatic greetings remain unavailable.");
    }
    @Override public void onDestroy() { ui.removeCallbacksAndMessages(null); super.onDestroy(); }
}
