package io.github.f2illc.lunaos.home.preview;

import android.app.Activity;
import android.app.KeyguardManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Bundle;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.WindowManager;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class VaultActivity extends Activity {
    private static VaultActivity owner;
    private static VaultService service;
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private VaultService.Grant grant;
    private CancellationSignal authentication;
    private LinearLayout layout;
    private TextView status;
    private TextView record;
    private RadioGroup members;
    private RadioGroup modes;
    private Button verify;
    private Button approve;
    private Button read;
    private Button monday;
    private Button tuesday;
    private boolean resumed;
    private boolean busy;
    private boolean pendingWork;
    private long verifiedUntil;
    private long generation;
    private long operation;
    private final Runnable timer = new Runnable() {
        public void run() {
            if (verifiedUntil != 0 && SystemClock.elapsedRealtime() >= verifiedUntil)
                close("Verification expired. Verify again before approving.");
            if (grant != null) {
                try {
                    service.check(grant, grant.member, VaultService.Action.READ);
                    if (getSystemService(KeyguardManager.class).isDeviceLocked()) close("Closed: device locked");
                } catch (SecurityException expired) { close("Closed: expired. Verify and approve again."); }
            }
            if (resumed) handler.postDelayed(this, 250);
        }
    };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (!BuildConfig.DEBUG || Build.VERSION.SDK_INT < 30 || owner != null) { finish(); return; }
        owner = this;
        if (service == null) {
            KeyguardManager keyguard = getSystemService(KeyguardManager.class);
            service = new VaultService(new VaultStore(this), SystemClock::elapsedRealtime,
                () -> keyguard != null && !keyguard.isDeviceLocked());
        }
        service.end();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        ScrollView scroll = new ScrollView(this);
        layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(16), dp(16), dp(16), dp(16));
        scroll.addView(layout);
        setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets occupied = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            view.setPadding(occupied.left, occupied.top, occupied.right, occupied.bottom);
            return insets;
        });
        text("Fictional phone vault experiment — debug only\nAlex/Sam fixtures only. No assistant, pairing, recovery or real household input. Family member selection is record scope, not a separate identity. After an interrupted save, approve read-only and inspect the record before deciding to save again.");
        text("Select one fictional member");
        members = choices("Alex Example", "Sam Example");
        text("Select access mode");
        modes = choices("Read-only: selected record", "Setup: create/edit selected record, never delete");
        status = text("Closed. Device credentials and a separate approval are required. Grants last 60 seconds.");
        status.setAccessibilityLiveRegion(android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE);
        record = text("");
        record.setSaveEnabled(false);
        verify = button("1. Verify with Android", this::verify);
        approve = button("2. Approve selected scope for 60 seconds", this::approve);
        read = button("Read selected fictional record", () -> work(false, 0));
        monday = button("Save fictional visit: Monday", () -> work(true, 0));
        tuesday = button("Save fictional visit: Tuesday", () -> work(true, 1));
        button("End access", () -> close("Closed by you. In-flight committed writes cannot be undone."));
        button("Back to Home", this::finish);
        members.setOnCheckedChangeListener((group, checked) -> close("Selection changed. Verify again."));
        modes.setOnCheckedChangeListener((group, checked) -> close("Mode changed. Verify again."));
        controls();
    }
    private TextView text(String value) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(18); layout.addView(view); return view;
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private Button button(String title, Runnable action) {
        Button button = new Button(this); button.setText(title); button.setMinHeight(dp(56));
        button.setOnClickListener(view -> action.run()); layout.addView(button); return button;
    }
    private RadioGroup choices(String first, String second) {
        RadioGroup group = new RadioGroup(this);
        for (String title : new String[] { first, second }) {
            RadioButton button = new RadioButton(this); button.setId(android.view.View.generateViewId());
            button.setText(title); button.setMinHeight(dp(56)); group.addView(button);
        }
        group.check(group.getChildAt(0).getId()); layout.addView(group); return group;
    }
    private boolean second(RadioGroup group) { return group.getCheckedRadioButtonId() == group.getChildAt(1).getId(); }
    private void controls() {
        if (verify == null) return;
        verify.setEnabled(!busy && resumed);
        approve.setEnabled(!busy && resumed && verifiedUntil > SystemClock.elapsedRealtime());
        read.setEnabled(!busy && grant != null);
        monday.setEnabled(!busy && grant != null && grant.mode == VaultService.Mode.SETUP);
        tuesday.setEnabled(monday.isEnabled());
        for (RadioGroup group : new RadioGroup[] { members, modes })
            for (int index = 0; index < group.getChildCount(); index++) group.getChildAt(index).setEnabled(!busy && grant == null);
    }
    private void verify() {
        close("Waiting for trusted Android verification; no scope approved yet.");
        KeyguardManager keyguard = getSystemService(KeyguardManager.class);
        BiometricManager biometrics = getSystemService(BiometricManager.class);
        if (keyguard == null || biometrics == null || !keyguard.isDeviceSecure() ||
            biometrics.canAuthenticate(BiometricManager.Authenticators.DEVICE_CREDENTIAL) != BiometricManager.BIOMETRIC_SUCCESS) {
            status.setText("Unavailable: Android API30+ and enrolled device credentials are required."); return;
        }
        long token = generation;
        authentication = new CancellationSignal(); busy = true; controls();
        try {
            new BiometricPrompt.Builder(this).setTitle("Verify fictional Home access")
            .setAllowedAuthenticators(BiometricManager.Authenticators.DEVICE_CREDENTIAL).build()
            .authenticate(authentication, getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    if (token != generation || !resumed || isDestroyed() || owner != VaultActivity.this) return;
                    if (result.getAuthenticationType() != BiometricPrompt.AUTHENTICATION_RESULT_TYPE_DEVICE_CREDENTIAL) {
                        close("Device credential verification required."); return;
                    }
                    authentication = null; busy = false; verifiedUntil = SystemClock.elapsedRealtime() + 30_000;
                    status.setText("Verified only. Review member and mode, then explicitly approve. No editing granted yet."); controls();
                }
                @Override public void onAuthenticationError(int code, CharSequence message) {
                    if (token == generation) close("Verification cancelled or unavailable. No access granted.");
                }
            });
        } catch (RuntimeException unavailable) { close("Trusted Android verification unavailable. No access granted."); }
    }
    private void approve() {
        if (!resumed || verifiedUntil <= SystemClock.elapsedRealtime() ||
            getSystemService(KeyguardManager.class).isDeviceLocked()) { close("Verification expired or device locked"); return; }
        verifiedUntil = 0;
        try {
            grant = service.approve(second(members) ? VaultService.Member.SAM : VaultService.Member.ALEX,
                second(modes) ? VaultService.Mode.SETUP : VaultService.Mode.READ_ONLY);
            status.setText("Approved selected scope for 60 seconds. Missing records require Setup and an explicit Save.");
        } catch (SecurityException denied) { close("Closed: uncertain write. Restart and review; no automatic retry."); }
        controls();
    }
    private void work(boolean writing, int variant) {
        if (busy || grant == null || !resumed) return;
        VaultService.Grant selected = grant;
        long token = generation;
        long identifier = ++operation;
        pendingWork = true; busy = true; record.setText(""); controls();
        WORK.execute(() -> {
            String value = null;
            String outcome;
            boolean failed = false;
            try {
                if (writing) {
                    VaultService.Result saved = service.save(selected, selected.member, variant, identifier);
                    if (saved == VaultService.Result.UNKNOWN)
                        outcome = "Save outcome UNKNOWN. Restart, verify and approve read-only to inspect before deciding on another save. No automatic retry.";
                    else outcome = saved == VaultService.Result.APPLIED ? "Save applied. No automatic retry." : "Save applied; access ended. No automatic retry.";
                }
                else { value = VaultService.fixture(selected.member, service.read(selected, selected.member)); outcome = "Read complete; access remains time-limited."; }
            } catch (Exception failure) {
                failed = true;
                outcome = "Closed/error: unavailable, denied or invalid store. Nothing reset; verify and review before another operation.";
            }
            String content = value;
            String message = outcome;
            boolean closeOnError = failed;
            handler.post(() -> {
                if (isDestroyed() || owner != this) return;
                pendingWork = false;
                if (token != generation || !resumed) {
                    busy = false;
                    if (writing) status.setText(message + " Access ended; record content suppressed.");
                    controls();
                    return;
                }
                busy = false;
                if (closeOnError) { close(message); return; }
                try {
                    service.check(selected, selected.member, VaultService.Action.READ);
                    if (getSystemService(KeyguardManager.class).isDeviceLocked()) throw new SecurityException();
                    if (content != null) record.setText(content);
                    status.setText(message);
                } catch (SecurityException ended) { close(message + " Access ended."); }
                controls();
            });
        });
    }
    private void close(String message) {
        generation++; verifiedUntil = 0; grant = null; busy = pendingWork;
        if (owner == this && service != null) service.end();
        if (authentication != null) { authentication.cancel(); authentication = null; }
        if (record != null) record.setText("");
        if (status != null) status.setText(message);
        controls();
    }
    @Override protected void onResume() {
        super.onResume(); resumed = true; controls();
        if (owner == this) handler.post(timer);
    }
    @Override protected void onPause() {
        resumed = false; close("Closed: backgrounded. Fresh verification and approval required.");
        handler.removeCallbacks(timer); super.onPause();
    }
    @Override protected void onDestroy() {
        close("Closed"); handler.removeCallbacksAndMessages(null);
        if (owner == this) owner = null;
        super.onDestroy();
    }
}
