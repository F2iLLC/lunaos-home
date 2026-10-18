package io.github.f2illc.lunaos.homekeyprobe;

import android.app.Instrumentation;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import java.io.File;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.Arrays;

/** Destructive only to the fixed synthetic Sam key on a dedicated test emulator. */
public final class HomeKeyProbe extends Instrumentation {
    private Bundle arguments;
    @Override public void onCreate(Bundle args) { super.onCreate(args); arguments = args; start(); }
    private static void require(boolean condition) { if (!condition) throw new IllegalStateException(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            require("ranchu".equals(Build.HARDWARE));
            require("io.github.f2illc.lunaos.home.preview.debug".equals(getTargetContext().getPackageName()));
            require((getTargetContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
            String operation = arguments.getString("operation");
            require("delete-synthetic-sam-key".equals(operation) || "verify-synthetic-sam-key-absent".equals(operation));
            File record = new File(getTargetContext().getNoBackupFilesDir(), "fictional-v1-SAM");
            require(record.isFile() && record.length() == 30);
            byte[] before = Files.readAllBytes(record.toPath());
            require(before[0] == 1);
            KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
            keys.load(null);
            if ("delete-synthetic-sam-key".equals(operation)) {
                require(keys.containsAlias("home.fictional.v1.SAM"));
                keys.deleteEntry("home.fictional.v1.SAM");
            }
            require(!keys.containsAlias("home.fictional.v1.SAM"));
            require(Arrays.equals(before, Files.readAllBytes(record.toPath())));
            result.putString("result", "PASS");
            result.putString("samKeyAbsent", "true");
            result.putString("ciphertextUnchanged", "true");
            finish(-1, result);
        } catch (Exception failure) {
            result.putString("result", "FAIL");
            finish(1, result);
        }
    }
}
