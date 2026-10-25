package io.github.f2illc.lunaos.home.vehicle;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.speech.*;
import android.widget.*;
import io.github.f2illc.lunaos.directtlsprobe.VehicleConversationClient;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Attended parked conversation; leaving the screen ends microphone and playback. */
public final class VehicleConversationActivity extends Activity {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile VehicleConversationClient client;
    private Future<?> pending;
    private BluetoothAdapter adapter;
    private BluetoothA2dp profile;
    private SpeechRecognizer recognizer;
    private VehicleReplyPlayer player;
    private File ready;
    private volatile File preparingFile;
    private CheckBox parked;
    private TextView status, transcript;
    private EditText question;
    private boolean visible, busy, destroyed;
    private int epoch;
    private String requestId;
    private String speakerName;
    private final BroadcastReceiver connectionChanges = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { if (busy && !connected()) cancel(); }
    };
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        speakerName = new VehicleState(this).nickname;
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); layout.setPadding(28, 48, 28, 28);
        ScrollView scroll = new ScrollView(this); scroll.addView(layout); setContentView(scroll);
        TextView title = new TextView(this); title.setText("Talk to " + speakerName + " · while parked"); title.setTextSize(24); layout.addView(title);
        TextView help = new TextView(this); help.setText("Your words and this short conversation go to your Home assistant. Answers go to ElevenLabs for speech. Their privacy and retention policies apply. The phone recognizes speech on-device; this preview saves no microphone recordings. Home keeps the last four exchanges in memory for up to 15 minutes. No calendar, location or vehicle controls are connected."); layout.addView(help);
        parked = new CheckBox(this); parked.setText("I'm parked and want to share this conversation with my assistant and ElevenLabs."); layout.addView(parked);
        parked.setOnCheckedChangeListener((button, checked) -> { if (!checked) cancel(); });
        status = new TextView(this); status.setText("Confirm above, then speak or type a question. Keep this screen open."); layout.addView(status);
        button(layout, "Speak to " + speakerName, this::listen);
        question = new EditText(this); question.setHint("Or type a question"); question.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(1000)}); layout.addView(question);
        button(layout, "Send question", () -> send(question.getText().toString().trim()));
        button(layout, "Stop", this::cancel);
        button(layout, "Clear shared conversation", () -> {
            cancel(); transcript.setText(""); question.setText("");
            worker.execute(() -> {
                try (VehicleConversationClient c = new VehicleConversationClient(this)) { c.clear(); ui.post(() -> status.setText("Conversation cleared at Home.")); }
                catch (Exception error) { ui.post(() -> status.setText("Couldn't reach Home to clear it. It will expire automatically.")); }
            });
        });
        transcript = new TextView(this); transcript.setTextIsSelectable(true); layout.addView(transcript);
        IntentFilter changes = new IntentFilter(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(connectionChanges, changes, Context.RECEIVER_EXPORTED);
        else registerReceiver(connectionChanges, changes);
        adapter = getSystemService(BluetoothManager.class).getAdapter();
        if (adapter != null) try {
            adapter.getProfileProxy(this, new BluetoothProfile.ServiceListener() {
                @Override public void onServiceConnected(int kind, BluetoothProfile proxy) {
                    if (destroyed) { adapter.closeProfileProxy(kind, proxy); return; }
                    profile = (BluetoothA2dp) proxy;
                }
                @Override public void onServiceDisconnected(int kind) { profile = null; cancel(); }
            }, BluetoothProfile.A2DP);
        } catch (SecurityException denied) { status.setText("Allow Nearby devices in vehicle setup first."); }
    }
    private void button(LinearLayout layout, String label, Runnable action) { Button b = new Button(this); b.setText(label); b.setOnClickListener(v -> action.run()); layout.addView(b); }
    private boolean connected() {
        if (!visible || !parked.isChecked() || profile == null) return false;
        VehicleState state = new VehicleState(this);
        if (state.address.isEmpty() || !VehicleReceiver.associated(this, state.address)) return false;
        try { for (BluetoothDevice device : profile.getConnectedDevices()) if (state.address.equalsIgnoreCase(device.getAddress()) && device.getBondState() == BluetoothDevice.BOND_BONDED) return true; }
        catch (SecurityException denied) { }
        return false;
    }
    private boolean begin() {
        if (busy) { status.setText("Finish or stop the current question first."); return false; }
        if (Build.VERSION.SDK_INT >= 37 && getApplicationInfo().targetSdkVersion >= 37
            && checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") != PackageManager.PERMISSION_GRANTED) {
            status.setText("Allow Home connection in vehicle setup first."); return false;
        }
        if (!connected()) { status.setText("Confirm you're parked and connect the selected vehicle's Bluetooth media audio."); return false; }
        return true;
    }
    private void listen() {
        if (!begin()) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 8); return; }
        if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) { status.setText("On-device speech recognition isn't available. You can type a question."); return; }
        busy = true; final int generation = ++epoch;
        try { recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this); }
        catch (RuntimeException unavailable) { busy = false; status.setText("On-device speech unavailable. Type your question instead."); return; }
        recognizer.setRecognitionListener(new RecognitionListener() {
            public void onReadyForSpeech(Bundle b) { status.setText("Listening…"); }
            public void onBeginningOfSpeech() { }
            public void onRmsChanged(float value) { }
            public void onBufferReceived(byte[] bytes) { }
            public void onEndOfSpeech() { status.setText("Recognizing your question…"); }
            public void onPartialResults(Bundle b) { }
            public void onEvent(int type, Bundle b) { }
            public void onError(int error) { if (generation == epoch) { stopRecognition(); busy = false; status.setText("Speech wasn't recognized. Try again or type your question."); } }
            public void onResults(Bundle b) {
                if (generation != epoch) return;
                ArrayList<String> lines = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                stopRecognition(); busy = false;
                if (lines == null || lines.isEmpty()) { status.setText("No speech recognized."); return; }
                question.setText(lines.get(0)); send(lines.get(0).trim());
            }
        });
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US").putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true).putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try { recognizer.startListening(intent); }
        catch (RuntimeException unavailable) { stopRecognition(); busy = false; status.setText("On-device speech unavailable. Type your question instead."); }
        ui.postDelayed(() -> { if (generation == epoch && recognizer != null) cancel(); }, 30_000);
    }
    private void send(String text) {
        if (!begin()) return;
        if (text.isEmpty() || text.length() > 1000) { status.setText("Use a question of 1 to 1,000 characters."); return; }
        VehicleState settings = new VehicleState(this);
        if (settings.voiceId.isEmpty()) { status.setText("Choose an ElevenLabs voice and configure Home conversation access first."); return; }
        busy = true; final int generation = ++epoch; requestId = UUID.randomUUID().toString(); final String id = requestId;
        status.setText("Asking " + speakerName + "… Brief network changes reconnect automatically. Keep Home and your private VPN online."); transcript.setText("You: " + text);
        pending = worker.submit(() -> {
            File file = null;
            try (VehicleConversationClient c = new VehicleConversationClient(this)) {
                client = c;
                if (Thread.currentThread().isInterrupted()) return;
                VehicleConversationClient.Reply reply = c.ask(id, text, settings.voiceId);
                file = File.createTempFile("vehicle-reply-", ".wav", getCacheDir());
                preparingFile = file;
                try (OutputStream out = new FileOutputStream(file)) { out.write(VehicleLeadIn.prepend(reply.wave, VehicleLeadIn.REPLY_MILLISECONDS)); }
                final File complete = file;
                ui.post(() -> {
                    if (generation != epoch || !connected() || !settings.voiceId.equals(new VehicleState(this).voiceId)) { complete.delete(); if (generation == epoch) { busy = false; status.setText("Reply stopped because the connection or settings changed."); } return; }
                    ready = complete; preparingFile = null; transcript.setText("You: " + text + "\n\n" + speakerName + ": " + reply.text + "\n\nHome conversation: " + reply.conversationId);
                    status.setText("Playing the reply…");
                    player = new VehicleReplyPlayer(this, settings.address, () -> generation == epoch && connected() && settings.address.equalsIgnoreCase(new VehicleState(this).address) && settings.voiceId.equals(new VehicleState(this).voiceId), message -> {
                        if (generation != epoch) return;
                        busy = false; status.setText(message); if (ready != null) { ready.delete(); ready = null; }
                    });
                    player.play(ready);
                });
            } catch (Exception unavailable) {
                if (file != null) file.delete();
                ui.post(() -> { if (generation == epoch) { busy = false; status.setText("Home couldn't complete this reply. Check cellular data, your private VPN and that Home is awake. The question wasn't automatically resent; it may already have reached Home. Once connected, send a new question. Cached greetings still work offline."); } });
            } finally { client = null; }
        });
    }
    private void stopRecognition() { if (recognizer != null) { recognizer.destroy(); recognizer = null; } }
    private void cancel() {
        epoch++; busy = false; stopRecognition();
        VehicleConversationClient c = client; if (c != null) c.close();
        if (pending != null) { pending.cancel(true); pending = null; }
        if (player != null) { player.close(); player = null; }
        if (ready != null) { ready.delete(); ready = null; }
        File preparing = preparingFile; if (preparing != null) { preparing.delete(); preparingFile = null; }
        String id = requestId; requestId = null;
        if (id != null && !worker.isShutdown()) worker.execute(() -> { try (VehicleConversationClient cancel = new VehicleConversationClient(this)) { cancel.cancel(id); } catch (Exception ignored) { } });
        if (status != null) status.setText("Stopped. Already shared text cannot be recalled from providers.");
    }
    @Override protected void onResume() { super.onResume(); visible = true; }
    @Override protected void onPause() { visible = false; cancel(); super.onPause(); }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == 8) status.setText(grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED ? "Microphone allowed. Tap Speak to " + speakerName + " when ready." : "Microphone declined. You can type a question.");
    }
    @Override protected void onDestroy() {
        destroyed = true; cancel(); ui.removeCallbacksAndMessages(null); worker.shutdown();
        try { unregisterReceiver(connectionChanges); } catch (IllegalArgumentException ignored) { }
        if (profile != null && adapter != null) adapter.closeProfileProxy(BluetoothProfile.A2DP, profile);
        super.onDestroy();
    }
}
