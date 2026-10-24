package io.github.f2illc.lunaos.home.vehicle;

import android.content.Context;
import android.media.*;
import android.os.*;
import java.io.File;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** Foreground-only replies reuse the greeting's tested route/seek gate. */
final class VehicleReplyPlayer implements AutoCloseable {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final AudioManager audio;
    private final String address;
    private final BooleanSupplier allowed;
    private final Consumer<String> finished;
    private final VehiclePlaybackGate gate = new VehiclePlaybackGate();
    private MediaPlayer player;
    private AudioFocusRequest focus;
    private long deadline, preparationDeadline;
    private boolean closed, audible;
    VehicleReplyPlayer(Context context, String address, BooleanSupplier allowed, Consumer<String> finished) {
        audio = context.getSystemService(AudioManager.class); this.address = address; this.allowed = allowed; this.finished = finished;
    }
    void play(File wave) {
        try {
            if (!allowed.getAsBoolean()) { end("Keep the conversation open while parked and connected."); return; }
            AudioDeviceInfo output = null;
            for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS))
                if (selected(device)) { output = device; break; }
            if (output == null) { end("Connect the selected vehicle's Bluetooth media audio."); return; }
            AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(change -> { if (change < 0) end("Reply stopped because audio focus changed."); }, ui).build();
            if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { end("Audio is busy. The reply is shown here."); return; }
            player = new MediaPlayer(); player.setAudioAttributes(attributes); player.setDataSource(wave.getPath());
            if (!player.setPreferredDevice(output)) { end("Selected Bluetooth audio unavailable."); return; }
            player.setVolume(0, 0); player.prepare();
            player.setOnCompletionListener(p -> end(audible ? "Reply playback completed on the selected vehicle output." : "Reply audio unavailable."));
            player.setOnErrorListener((p, what, extra) -> { end("Reply audio unavailable."); return true; });
            player.addOnRoutingChangedListener(routing -> verify(), ui);
            deadline = SystemClock.elapsedRealtime() + 2000; preparationDeadline = SystemClock.elapsedRealtime() + 8000;
            player.start(); ui.postDelayed(this::verify, 50);
        } catch (Exception error) { end("Reply audio unavailable. The text is shown here."); }
    }
    private boolean selected(AudioDeviceInfo device) { return device != null && device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP && address.equalsIgnoreCase(device.getAddress()); }
    private void verify() {
        if (closed || player == null) return;
        if (!audible && SystemClock.elapsedRealtime() >= preparationDeadline) { end("Reply audio preparation timed out."); return; }
        if (!allowed.getAsBoolean()) { end("Reply stopped. Keep the phone open while parked and connected."); return; }
        VehiclePlaybackGate.Decision decision = gate.observe(selected(player.getRoutedDevice()), SystemClock.elapsedRealtime() >= deadline);
        if (decision == VehiclePlaybackGate.Decision.SEEK) {
            player.pause();
            player.setOnSeekCompleteListener(ready -> {
                if (closed || player != ready) return;
                gate.seekCompleted(); deadline = SystemClock.elapsedRealtime() + 2000;
                ready.start(); verify();
            });
            player.seekTo(0);
        } else if (decision == VehiclePlaybackGate.Decision.UNMUTE) { gate.started(); audible = true; player.setVolume(1, 1); }
        else if (decision == VehiclePlaybackGate.Decision.STOP) { end("Reply stopped because the selected output changed."); return; }
        if (!closed) ui.postDelayed(this::verify, 50);
    }
    private void end(String message) { if (closed) return; close(); finished.accept(message); }
    @Override public void close() {
        if (closed) return;
        closed = true; gate.stop(); ui.removeCallbacksAndMessages(null);
        if (player != null) { player.release(); player = null; }
        if (focus != null) { audio.abandonAudioFocusRequest(focus); focus = null; }
    }
}
