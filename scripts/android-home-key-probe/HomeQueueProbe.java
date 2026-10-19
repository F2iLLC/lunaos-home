package io.github.f2illc.lunaos.homekeyprobe;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.RadioGroup;
import android.widget.TextView;
import java.io.File;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Holds the real Activity work queue; never creates grants or substitutes storage/authentication. */
public final class HomeQueueProbe extends Instrumentation {
    private Bundle arguments;
    private Class<?> vault;
    @Override public void onCreate(Bundle args) { super.onCreate(args); arguments = args; start(); }
    private static void require(boolean condition) { if (!condition) throw new IllegalStateException(); }
    private Object field(Object instance, String name) {
        try {
            Field field = vault.getDeclaredField(name);
            field.setAccessible(true);
            return field.get(instance);
        } catch (ReflectiveOperationException failure) { throw new IllegalStateException(failure); }
    }
    private Object mainField(Object instance, String name) {
        AtomicReference<Object> value = new AtomicReference<>();
        runOnMainSync(() -> value.set(field(instance, name)));
        return value.get();
    }
    private Button button(Activity activity, String name) { return (Button) field(activity, name); }
    private Button endButton(View view) {
        if (view instanceof Button && "End access".equals(((Button) view).getText().toString())) return (Button) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index++) {
                Button found = endButton(group.getChildAt(index));
                if (found != null) return found;
            }
        }
        return null;
    }
    private void closed(Activity activity) {
        require(field(activity, "grant") == null);
        require(((TextView) field(activity, "record")).getText().length() == 0);
        for (String name : new String[] {"approve", "read", "monday", "tuesday"}) require(!button(activity, name).isEnabled());
    }
    @Override public void onStart() {
        CountDownLatch release = new CountDownLatch(1);
        Activity activity = null;
        Bundle result = new Bundle();
        try {
            require("ranchu".equals(Build.HARDWARE));
            require("io.github.f2illc.lunaos.home.preview.debug".equals(getTargetContext().getPackageName()));
            require((getTargetContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
            String operation = arguments.getString("operation");
            require("held-read-end".equals(operation) || "held-write-end".equals(operation) || "held-read-recreate".equals(operation));
            boolean writing = "held-write-end".equals(operation);
            File record = new File(getTargetContext().getNoBackupFilesDir(), "fictional-v1-ALEX");
            require(record.isFile() && record.length() == 30);
            byte[] before = Files.readAllBytes(record.toPath());
            vault = Class.forName("io.github.f2illc.lunaos.home.preview.VaultActivity", true, getTargetContext().getClassLoader());
            activity = startActivitySync(new Intent().setClassName(getTargetContext(), vault.getName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            Activity original = activity;
            runOnMainSync(() -> {
                closed(original);
                if (writing) ((RadioGroup) field(original, "modes")).getChildAt(1).performClick();
                require(button(original, "verify").isEnabled());
                button(original, "verify").performClick();
            });
            Bundle ready = new Bundle(); ready.putString("phase", "complete Android verification and approve selected Alex scope"); sendStatus(1, ready);
            long deadline = SystemClock.elapsedRealtime() + 120_000;
            while (mainField(original, "grant") == null && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
            require(mainField(original, "grant") != null);
            runOnMainSync(() -> {
                RadioGroup members = (RadioGroup) field(original, "members");
                RadioGroup modes = (RadioGroup) field(original, "modes");
                require(members.getCheckedRadioButtonId() == members.getChildAt(0).getId());
                require(modes.getCheckedRadioButtonId() == modes.getChildAt(writing ? 1 : 0).getId());
                require(button(original, writing ? "tuesday" : "read").isEnabled());
            });
            ExecutorService work = (ExecutorService) field(null, "WORK");
            CountDownLatch held = new CountDownLatch(1);
            work.execute(() -> { held.countDown(); try { require(release.await(30, TimeUnit.SECONDS)); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); } });
            require(held.await(5, TimeUnit.SECONDS));
            runOnMainSync(() -> {
                button(original, writing ? "tuesday" : "read").performClick();
                require(Boolean.TRUE.equals(field(original, "pendingWork")));
                require(Boolean.TRUE.equals(field(original, "busy")));
                if ("held-read-recreate".equals(operation)) original.recreate();
                else { Button end = endButton(original.getWindow().getDecorView()); require(end != null); end.performClick(); closed(original); }
            });
            if ("held-read-recreate".equals(operation)) {
                deadline = SystemClock.elapsedRealtime() + 10_000;
                do {
                    Activity candidate = (Activity) mainField(null, "owner");
                    if (candidate != null && candidate != original && Boolean.TRUE.equals(mainField(candidate, "resumed"))) { activity = candidate; break; }
                    SystemClock.sleep(100);
                } while (SystemClock.elapsedRealtime() < deadline);
                require(activity != original);
            }
            release.countDown();
            work.submit(() -> {}).get(10, TimeUnit.SECONDS);
            Activity current = activity;
            runOnMainSync(() -> closed(current));
            require(Arrays.equals(before, Files.readAllBytes(record.toPath())));
            result.putString("result", "PASS");
            result.putString("operation", operation);
            result.putString("queuedWorkObserved", "true");
            result.putString("accessAndContentCleared", "true");
            result.putString("ciphertextUnchanged", "true");
        } catch (Exception failure) {
            result.putString("result", "FAIL");
            result.putString("failureType", failure.getClass().getSimpleName());
        } finally {
            release.countDown();
            if (activity != null) { Activity current = activity; runOnMainSync(current::finish); }
        }
        finish("PASS".equals(result.getString("result")) ? -1 : 1, result);
    }
}
