package io.github.f2illc.lunaos.home.vehicle;

import android.app.*;
import android.bluetooth.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.os.*;
import android.speech.tts.*;
import java.io.File;
import java.io.IOException;
import java.util.Locale;

/** Short speech on the selected Bluetooth output, with a visible trip service. */
public final class VehicleAudioService extends Service {
    private static final String CHANNEL = "home-vehicle";
    private final Handler ui = new Handler(Looper.getMainLooper());
    private BluetoothAdapter adapter;
    private BluetoothA2dp profile;
    private String address, trip;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private TextToSpeech speech;
    private MediaPlayer player;
    private File wave, preparedWave;
    private boolean stopped, attempted, generating, detected, audible;
    private VehiclePlaybackGate playback = new VehiclePlaybackGate();
    private long deadline, routeDeadline;
    private int audioEpoch;
    private int greetingId;
    private String playbackVoice = "Android offline voice";
    private String greetingVoiceId, greetingVoicePack, greetingNickname;
    private long passengerReadyAt;
    private String preferred = "", greetingPeriod;
    private VehiclePassengers.Decision passengerDecision;
    private final BroadcastReceiver changes = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { check(); }
    };
    static Notification notification(Context c, String text) {
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Vehicle greetings", NotificationManager.IMPORTANCE_LOW));
        PendingIntent tap = PendingIntent.getActivity(c, 1, new Intent(c, VehicleSetupActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(c, CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("LunaOS · Vehicle").setContentText(text).setContentIntent(tap).setOnlyAlertOnce(true).build();
    }
    static void notifyTap(Context c) {
        try { c.getSystemService(NotificationManager.class).notify(701, notification(c, "Park, then tap to enable or retry the greeting.")); }
        catch (SecurityException denied) { }
    }
    @Override public void onCreate() {
        super.onCreate(); audio = getSystemService(AudioManager.class);
        adapter = getSystemService(BluetoothManager.class).getAdapter();
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        VehicleState state = new VehicleState(this);
        String selected = intent == null ? "" : intent.getStringExtra("address");
        if (selected == null || state.address.isEmpty() || !state.address.equalsIgnoreCase(selected)) { stopSelf(); return START_NOT_STICKY; }
        try {
            startForeground(700, notification(this, "Connected vehicle companion"), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            if (address != null) { check(); return START_NOT_STICKY; }
            address = selected; deadline = SystemClock.elapsedRealtime() + 30_000;
            IntentFilter filter = new IntentFilter(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(changes, filter, Context.RECEIVER_EXPORTED);
            else registerReceiver(changes, filter);
            adapter.getProfileProxy(this, new BluetoothProfile.ServiceListener() {
                @Override public void onServiceConnected(int kind, BluetoothProfile proxy) {
                    if (stopped) { adapter.closeProfileProxy(kind, proxy); return; }
                    profile = (BluetoothA2dp) proxy; check();
                }
                @Override public void onServiceDisconnected(int kind) { profile = null; end(); }
            }, BluetoothProfile.A2DP);
            ui.postDelayed(this::check, 1000);
        } catch (RuntimeException restricted) { VehicleRuntime.status(this, "Bluetooth or background access unavailable. Open setup while parked."); notifyTap(this); stopSelf(); }
        return START_NOT_STICKY;
    }
    private boolean connected() {
        if (profile == null || !VehicleReceiver.associated(this, address)) return false;
        try {
            for (BluetoothDevice device : profile.getConnectedDevices())
                if (address.equalsIgnoreCase(device.getAddress()) && device.getBondState() == BluetoothDevice.BOND_BONDED) return true;
        } catch (SecurityException revoked) { }
        return false;
    }
    private AudioDeviceInfo route() {
        for (AudioDeviceInfo device : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS))
            if (device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP && address.equalsIgnoreCase(device.getAddress())) return device;
        return null;
    }
    private void check() {
        if (stopped) return;
        VehicleState current = new VehicleState(this);
        if (!address.equalsIgnoreCase(current.address)) { stopSelf(); return; }
        if (!connected()) {
            if (detected) { end(); return; }
            if (SystemClock.elapsedRealtime() >= deadline) { VehicleRuntime.status(this, "No confirmed vehicle media connection. No greeting played."); notifyTap(this); stopSelf(); return; }
            ui.postDelayed(this::check, 1000); return;
        }
        if (!detected) {
            detected = true; VehicleState state = VehicleRuntime.connected(this); trip = state.trip.id;
            attempted = state.trip.claimed;
            passengerReadyAt = SystemClock.elapsedRealtime() + VehiclePassengers.SETTLE_MS;
            VehicleRuntime.notifyBackend(this, true, text -> ui.post(() -> { preferred = text; begin(preferred); }));
            ui.postDelayed(() -> begin(preferred), VehiclePassengers.SETTLE_MS);
            ui.postDelayed(this::heartbeat, 60_000);
        }
    }
    private void heartbeat() {
        if (stopped) return;
        if (!connected() || !address.equalsIgnoreCase(new VehicleState(this).address)) { end(); return; }
        VehicleRuntime.notifyBackend(this, true, text -> {});
        ui.postDelayed(this::heartbeat, 60_000);
    }
    private void begin(String text) {
        if (stopped || attempted || generating || !connected()) return;
        if (SystemClock.elapsedRealtime() < passengerReadyAt) return;
        if (SystemClock.elapsedRealtime() >= deadline) { unavailable(); return; }
        if (route() == null) { ui.postDelayed(() -> begin(text), 1000); return; }
        VehicleState settings = new VehicleState(this);
        greetingPeriod = VehicleRuntime.period();
        passengerDecision = settings.passengers.decide(trip, System.currentTimeMillis(), VehicleRuntime.boot(this), greetingPeriod);
        VehicleGreetings.Choice choice = VehiclePassengers.choose(greetingPeriod, settings.nickname, settings.lastGreetingId, text, passengerDecision);
        if (choice == null) { attempted = true; VehicleRuntime.audio(this, "Greetings silenced by your preferences."); return; }
        generating = true;
        final int generation = ++audioEpoch;
        VehicleRuntime.audio(this, "Preparing offline speech");
        greetingVoiceId = settings.voiceId; greetingVoicePack = settings.voicePack; greetingNickname = settings.nickname;
        final String greeting = choice.text; greetingId = choice.id;
        if (!settings.voiceId.isEmpty()) {
            playbackVoice = "Cached ElevenLabs voice";
            VehicleRuntime.audio(this, "Preparing cached ElevenLabs speech");
            try { preparedWave = File.createTempFile("vehicle-cached-", ".wav", getCacheDir()); }
            catch (IOException failed) { unavailable("Cached speech preparation unavailable"); return; }
            final File ready = preparedWave;
            new Thread(() -> {
                try {
                    byte[] bytes = VehicleVoiceCache.prepared(VehicleVoiceCache.directory(getNoBackupFilesDir(), settings.voicePack), settings.voiceId, greeting);
                    try (java.io.OutputStream out = new java.io.FileOutputStream(ready)) { out.write(bytes); }
                    ui.post(() -> {
                        VehicleState current = new VehicleState(this);
                        if (generation != audioEpoch || stopped) { ready.delete(); return; }
                        if (!settings.voiceId.equals(current.voiceId) || !settings.voicePack.equals(current.voicePack) || !settings.nickname.equals(current.nickname)) {
                            unavailable("Voice settings changed during preparation"); return;
                        }
                        play();
                    });
                } catch (Exception missing) {
                    ui.post(() -> { if (generation == audioEpoch) unavailable("Selected voice clip unavailable. Prepare its cache or select the Android voice while parked."); });
                }
            }, "vehicle-cached-speech").start();
            ui.postDelayed(() -> { if (generating && generation == audioEpoch) unavailable("Cached speech preparation timed out"); }, 15_000);
            return;
        }
        playbackVoice = "Android offline voice";
        speech = new TextToSpeech(this, status -> ui.post(() -> {
            if (stopped || generation != audioEpoch || speech == null) return;
            if (status != TextToSpeech.SUCCESS || speech.setLanguage(Locale.US) < 0) { unavailable("Offline English speech engine unavailable"); return; }
            wave = new File(getCacheDir(), "vehicle-greeting-" + generation + ".wav");
            preparedWave = new File(getCacheDir(), "vehicle-ready-" + generation + ".wav");
            final File source = wave, ready = preparedWave;
            speech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) {
                    try {
                        VehicleLeadIn.write(source, ready);
                        ui.post(() -> { if (generation == audioEpoch) play(); else { source.delete(); ready.delete(); } });
                    } catch (IOException failure) { ui.post(() -> { if (generation == audioEpoch) unavailable("Speech audio preparation failed"); }); }
                }
                @Override public void onError(String id) { ui.post(() -> { if (generation == audioEpoch) unavailable("Speech synthesis failed"); }); }
            });
            // Local installed engine only; no cloud TTS voice or microphone.
            android.speech.tts.Voice local = null;
            if (speech.getVoices() != null) for (android.speech.tts.Voice voice : speech.getVoices())
                if (!voice.isNetworkConnectionRequired() && voice.getLocale().equals(Locale.US)) { local = voice; break; }
            if (local == null || speech.setVoice(local) != TextToSpeech.SUCCESS ||
                speech.synthesizeToFile(greeting, new Bundle(), wave, trip) != TextToSpeech.SUCCESS) unavailable("Offline English voice unavailable");
        }));
        ui.postDelayed(() -> { if (generating && generation == audioEpoch) unavailable("Speech preparation timed out"); }, 15_000);
    }
    private void play() {
        if (stopped || !connected() || SystemClock.elapsedRealtime() >= deadline) { unavailable(); return; }
        AudioDeviceInfo output = route(); if (output == null) { unavailable(); return; }
        try {
            startForeground(700, notification(this, "Vehicle greeting"), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes).setOnAudioFocusChangeListener(change -> { if (change < 0) ui.post(() -> unavailable()); }).build();
            if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { unavailable("Android audio focus denied"); return; }
            player = new MediaPlayer(); player.setAudioAttributes(attributes); player.setDataSource(preparedWave.getPath());
            playback = new VehiclePlaybackGate();
            if (!player.setPreferredDevice(output)) { unavailable("Android refused the selected Bluetooth output"); return; }
            player.setVolume(0, 0); player.prepare();
            player.setOnCompletionListener(done -> {
                if (audible) {
                    VehicleRuntime.status(this, "Greeting playback completed on the selected Bluetooth output.");
                    VehicleRuntime.audio(this, playbackVoice + ": playback completed on selected Bluetooth output; confirm vehicle audibility.");
                    releaseAudio();
                } else unavailable();
            });
            player.setOnErrorListener((p, what, extra) -> { unavailable(); return true; });
            player.addOnRoutingChangedListener(routing -> verifyRoute(), ui);
            // Warm the route while muted. Some Bluetooth stacks report no route
            // immediately after start; do not consume the trip on that transient.
            routeDeadline = SystemClock.elapsedRealtime() + 2000;
            player.start(); ui.postDelayed(this::verifyRoute, 50);
        } catch (Exception unavailable) { unavailable(); }
    }
    private void verifyRoute() {
        if (player == null || stopped) return;
        AudioDeviceInfo actual = player.getRoutedDevice();
        boolean selected = actual != null && actual.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP && address.equalsIgnoreCase(actual.getAddress()) && connected();
        VehiclePlaybackGate.Decision decision = playback.observe(selected, SystemClock.elapsedRealtime() >= routeDeadline);
        if (decision == VehiclePlaybackGate.Decision.UNMUTE) {
            VehicleState settings = new VehicleState(this);
            if (!settings.voiceId.equals(greetingVoiceId) || !settings.voicePack.equals(greetingVoicePack) || !settings.nickname.equals(greetingNickname)) {
                unavailable("Greeting settings changed before playback"); return;
            }
            // Evidence may expire, disconnect or be corrected during TTS/route setup.
            if (!passengerDecision.same(settings.passengers.decide(trip, System.currentTimeMillis(), VehicleRuntime.boot(this), greetingPeriod))) {
                attempted = true; unavailable("Passenger information changed; greeting skipped. Retry while parked."); return;
            }
            // This decision uses the current route, after the asynchronous seek.
            if (!VehicleRuntime.claim(this, trip, greetingId)) { releaseAudio(); return; }
            attempted = true; audible = true; generating = false; playback.started();
            player.setVolume(1, 1);
            getSystemService(NotificationManager.class).cancel(701);
            VehicleRuntime.audio(this, playbackVoice + ": playing on selected Bluetooth output");
        } else if (decision == VehiclePlaybackGate.Decision.SEEK) {
            player.pause();
            player.setOnSeekCompleteListener(ready -> {
                if (stopped || player != ready) return;
                if (!connected()) { unavailable(); return; }
                playback.seekCompleted(); routeDeadline = SystemClock.elapsedRealtime() + 2000;
                ready.start(); // Still muted; a fresh route observation must allow sound.
                verifyRoute();
            });
            player.seekTo(0);
        } else if (decision == VehiclePlaybackGate.Decision.WAIT && !audible) {
            ui.postDelayed(this::verifyRoute, 50);
        } else if (decision == VehiclePlaybackGate.Decision.STOP) {
            VehicleRuntime.audio(this, "Selected Bluetooth output was not the active route"); unavailable();
        }
    }
    private void unavailable() {
        if (stopped) return;
        VehicleRuntime.status(this, "Greeting unavailable or interrupted. Check media audio while parked.");
        releaseAudio(); notifyTap(this);
    }
    private void unavailable(String reason) { VehicleRuntime.audio(this, reason); unavailable(); }
    private void releaseAudio() {
        audioEpoch++; generating = false; audible = false; playback.stop();
        if (player != null) { player.release(); player = null; }
        if (speech != null) { speech.shutdown(); speech = null; }
        if (focus != null) { audio.abandonAudioFocusRequest(focus); focus = null; }
        if (wave != null) { wave.delete(); wave = null; }
        if (preparedWave != null) { preparedWave.delete(); preparedWave = null; }
        if (!stopped) try { startForeground(700, notification(this, "Vehicle session active"), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE); } catch (RuntimeException ignored) { stopSelf(); }
    }
    private void end() { VehicleRuntime.disconnect(this); stopSelf(); }
    @Override public void onDestroy() {
        stopped = true; ui.removeCallbacksAndMessages(null); releaseAudio();
        try { unregisterReceiver(changes); } catch (IllegalArgumentException ignored) { }
        if (profile != null && adapter != null) adapter.closeProfileProxy(BluetoothProfile.A2DP, profile);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
