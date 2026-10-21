package io.github.f2illc.lunaos.directtlsprobe;

import android.app.Activity;
import android.os.*;
import android.widget.*;
import java.io.*;
import java.util.concurrent.*;
import org.json.JSONObject;

/** Visible fictional approval flow only. Native transport identity is separate from OS vault unlock. */
public final class PairingActivity extends Activity {
    private JSONObject config;
    private TextView status, contents;
    private Button approveHost, connect, approveRead, read, end;
    private boolean identityApproved, scopeApproved, busy;
    private String pendingGrant, displayedHost, displayedPeer;
    private volatile long generation;
    private volatile SyntheticTlsClient activeClient;
    private final Object clientLock = new Object();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ThreadPoolExecutor worker = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<Runnable>(1), new ThreadPoolExecutor.AbortPolicy());

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        try { if (!"ranchu".equals(Build.HARDWARE) && !FixtureConfig.approvedPhysicalTarget(this)) { finish(); return; } }
        catch (Exception error) { finish(); return; }
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        try { config = FixtureConfig.read(this); displayedHost = config.getString("hostFingerprint"); displayedPeer = NativeIdentity.fingerprint(); } catch (Exception error) { finish(); return; }
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); layout.setPadding(24, 24, 24, 24);
        scroll.addView(layout); setContentView(scroll);
        label(layout, "Fictional device connection");
        label(layout, "Test only. No family data. This device keeps its connection key in Android Keystore. This does not unlock a vault or replace Android verification.");
        label(layout, "Test computer identity: " + config.optString("hostFingerprint"));
        label(layout, "Android identity: " + displayedPeer);
        label(layout, "Selected information: Alex / Library visit. Read only, up to 60 seconds. The host separately approves this fixed test scope.");
        status = label(layout, "Review the test computer identity."); contents = label(layout, "No record shown.");
        approveHost = button(layout, "Approve fictional computer", () -> { identityApproved = true; status.setText("Computer approved for this screen. Connect when ready."); render(); });
        connect = button(layout, "Connect to test computer", this::connect);
        approveRead = button(layout, "Allow selected read", () -> {
            scopeApproved = true; status.setText("Selected read allowed. Nothing read yet."); render();
        });
        read = button(layout, "Read Alex's record", this::readRecord);
        end = button(layout, "End connection", () -> closeAccess("Connection ended. Reading needs fresh approval."));
        render();
    }
    private TextView label(LinearLayout layout, String text) {
        TextView view = new TextView(this); view.setText(text); view.setTextSize(17); view.setPadding(0, 8, 0, 8); layout.addView(view); return view;
    }
    private Button button(LinearLayout layout, String text, Runnable action) {
        Button button = new Button(this); button.setText(text); button.setAllCaps(false); button.setOnClickListener(v -> action.run()); layout.addView(button); return button;
    }
    private void render() {
        approveHost.setEnabled(!identityApproved && !busy);
        connect.setEnabled(identityApproved && !busy && activeClient == null);
        approveRead.setEnabled(!busy && pendingGrant != null && !scopeApproved);
        read.setEnabled(!busy && scopeApproved && pendingGrant != null && activeClient != null);
        end.setEnabled(busy || activeClient != null || pendingGrant != null);
    }
    private void closeAccess(String message) {
        generation++; ui.removeCallbacksAndMessages(null);
        SyntheticTlsClient old;
        synchronized (clientLock) { old = activeClient; activeClient = null; }
        // Conscrypt close can write a TLS close-notify. Keep that off the UI thread,
        // independently of the worker which may currently be blocked in a read.
        if (old != null) new Thread(() -> { try { old.close(); } catch (IOException ignored) { } }, "fictional-tls-close").start();
        pendingGrant = null; scopeApproved = false; busy = false;
        if (contents != null) { contents.setText("No record shown."); status.setText(message); render(); }
    }
    private void schedule(Runnable task) {
        try { worker.execute(task); } catch (RejectedExecutionException full) { closeAccess("Previous work is ending. Try connecting again shortly."); }
    }
    private void watchDisplayedRecord(long token, SyntheticTlsClient client) {
        ui.postDelayed(() -> {
            if (generation != token || activeClient != client || busy) return;
            schedule(() -> {
                try {
                    if (generation != token) return;
                    client.requirePresence();
                    runOnUiThread(() -> {
                        if (generation == token && activeClient == client && !busy) watchDisplayedRecord(token, client);
                    });
                } catch (Exception lost) {
                    runOnUiThread(() -> {
                        if (generation == token) closeAccess("Connection lost. Record hidden; fresh approval required.");
                    });
                }
            });
        }, 1000);
    }
    private void connect() {
        if (!identityApproved || busy || activeClient != null) return;
        busy = true; contents.setText("No record shown."); status.setText("Connecting to the approved test computer..."); render();
        final long token = generation;
        schedule(() -> {
            SyntheticTlsClient client = null;
            try {
                if (generation != token) return;
                config = FixtureConfig.read(this);
                if (!displayedHost.equals(config.getString("hostFingerprint")) || !displayedPeer.equals(NativeIdentity.fingerprint())) throw new IOException("Identity changed; review again");
                client = new SyntheticTlsClient(this, config);
                synchronized (clientLock) {
                    if (generation != token) { client.close(); return; }
                    activeClient = client;
                }
                // Authenticated resume carries no grants. It also recovers admission
                // after cold restart or a lost pairing response, without replaying writes.
                JSONObject result = client.call(new JSONObject().put("op", "resume"));
                if (!result.getBoolean("ok") && "DENIED".equals(result.optString("code"))) {
                    client.close();
                    if (generation != token) return;
                    client = new SyntheticTlsClient(this, config);
                    synchronized (clientLock) {
                        if (generation != token) { client.close(); return; }
                        activeClient = client;
                    }
                    result = client.call(new JSONObject().put("op", "pair").put("offer", config.getString("offer")));
                }
                if (!result.getBoolean("ok")) throw new IOException();
                runOnUiThread(() -> { if (generation == token) status.setText("Computer connected. Waiting for host approval..."); });
                String grant = client.approval();
                runOnUiThread(() -> {
                    if (generation != token) return;
                    pendingGrant = grant; scopeApproved = false; busy = false;
                    status.setText("Connected. Review and allow the selected read."); render();
                    ui.postDelayed(() -> { if (generation == token) closeAccess("Test access expired. Connect and approve again."); }, 60_000);
                });
            } catch (Exception error) {
                if (client != null) try { client.close(); } catch (IOException ignored) { }
                runOnUiThread(() -> { if (generation == token) closeAccess("Connection or approval unavailable. No access remains."); });
            }
        });
    }
    private void readRecord() {
        if (busy || !scopeApproved || activeClient == null || pendingGrant == null) return;
        busy = true; contents.setText("No record shown."); status.setText("Reading selected fictional record..."); render();
        final long token = generation; final SyntheticTlsClient client = activeClient; final String grant = pendingGrant;
        schedule(() -> {
            try {
                if (generation != token) return;
                JSONObject record = client.readRecord(grant);
                final String display = record.getString("label") + ": " + record.getString("value");
                runOnUiThread(() -> {
                    if (generation != token) return;
                    busy = false; contents.setText(display); status.setText("Fictional record read. No changes allowed."); render();
                    watchDisplayedRecord(token, client);
                });
            } catch (Exception error) {
                runOnUiThread(() -> { if (generation == token) closeAccess("Read unavailable. No access remains."); });
            }
        });
    }
    @Override protected void onPause() { identityApproved = false; closeAccess("Access closed while away. Review the computer again."); super.onPause(); }
    @Override protected void onDestroy() { closeAccess("Access closed."); worker.shutdownNow(); super.onDestroy(); }
}
