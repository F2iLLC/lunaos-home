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
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** Test-only delayed/lost acknowledgement around the real authenticated Android store. */
public final class HomeStoreProbe extends Instrumentation {
    private Bundle arguments;
    private Class<?> vault;
    @Override public void onCreate(Bundle args) { super.onCreate(args); arguments = args; start(); }
    private static void require(boolean condition) { if (!condition) throw new IllegalStateException(); }
    private Object field(Object instance, String name) {
        try { Field f = vault.getDeclaredField(name); f.setAccessible(true); return f.get(instance); }
        catch (ReflectiveOperationException failure) { throw new IllegalStateException(failure); }
    }
    private Object mainField(Object instance, String name) {
        AtomicReference<Object> value = new AtomicReference<>();
        runOnMainSync(() -> value.set(field(instance, name))); return value.get();
    }
    private Button button(Activity activity, String name) { return (Button) field(activity, name); }
    private Button endButton(View view) {
        if (view instanceof Button && "End access".equals(((Button) view).getText().toString())) return (Button) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) { Button found = endButton(group.getChildAt(i)); if (found != null) return found; }
        }
        return null;
    }
    @Override public void onStart() {
        CountDownLatch release = new CountDownLatch(1);
        Activity activity = null;
        Object service = null;
        Object store = null;
        Field storeField = null;
        Bundle result = new Bundle();
        try {
            require("ranchu".equals(Build.HARDWARE));
            require("io.github.f2illc.lunaos.home.preview.debug".equals(getTargetContext().getPackageName()));
            require((getTargetContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
            String operation = arguments.getString("operation");
            require("read-return-after-end".equals(operation) || "commit-return-after-end".equals(operation) || "commit-lost-ack".equals(operation));
            boolean writing = !"read-return-after-end".equals(operation);
            boolean lost = "commit-lost-ack".equals(operation);
            File record = new File(getTargetContext().getNoBackupFilesDir(), "fictional-v1-ALEX");
            require(record.isFile() && record.length() == 30);
            byte[] before = Files.readAllBytes(record.toPath());
            vault = Class.forName("io.github.f2illc.lunaos.home.preview.VaultActivity", true, getTargetContext().getClassLoader());
            activity = startActivitySync(new Intent().setClassName(getTargetContext(), vault.getName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            Activity current = activity;
            runOnMainSync(() -> {
                require(field(current, "grant") == null);
                if (writing) ((RadioGroup) field(current, "modes")).getChildAt(1).performClick();
                button(current, "verify").performClick();
            });
            Bundle ready = new Bundle(); ready.putString("phase", "complete Android verification and approve selected Alex scope"); sendStatus(1, ready);
            long deadline = SystemClock.elapsedRealtime() + 120_000;
            while (mainField(current, "grant") == null && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
            require(mainField(current, "grant") != null);
            runOnMainSync(() -> {
                RadioGroup members = (RadioGroup) field(current, "members");
                RadioGroup modes = (RadioGroup) field(current, "modes");
                require(members.getCheckedRadioButtonId() == members.getChildAt(0).getId());
                require(modes.getCheckedRadioButtonId() == modes.getChildAt(writing ? 1 : 0).getId());
                require(button(current, writing ? "tuesday" : "read").isEnabled());
            });
            service = mainField(null, "service");
            storeField = service.getClass().getDeclaredField("store"); storeField.setAccessible(true);
            store = storeField.get(service);
            Object realStore = store;
            CountDownLatch reached = new CountDownLatch(1);
            AtomicInteger calls = new AtomicInteger();
            Class<?> contract = Class.forName("io.github.f2illc.lunaos.home.preview.VaultService$Store", true, getTargetContext().getClassLoader());
            Object delayed = Proxy.newProxyInstance(contract.getClassLoader(), new Class<?>[] {contract}, (proxy, method, args) -> {
                Object value;
                try { value = method.invoke(realStore, args); }
                catch (InvocationTargetException failure) { throw failure.getCause(); }
                if (method.getName().equals(writing ? "write" : "read")) {
                    calls.incrementAndGet(); reached.countDown();
                    require(release.await(30, TimeUnit.SECONDS));
                    if (lost) throw new IOException("Synthetic lost acknowledgement after actual commit");
                }
                return value;
            });
            // Only this disposable instrumentation process changes the adapter reference.
            // The original service, grant, clock, lock predicate and native store remain in use.
            storeField.set(service, delayed);
            require(storeField.get(service) == delayed);
            runOnMainSync(() -> button(current, writing ? "tuesday" : "read").performClick());
            require(reached.await(10, TimeUnit.SECONDS));
            require(Boolean.TRUE.equals(mainField(current, "pendingWork")));
            require(calls.get() == 1);
            byte[] completed = Files.readAllBytes(record.toPath());
            require(writing != Arrays.equals(before, completed));
            if (!lost) runOnMainSync(() -> { Button end = endButton(current.getWindow().getDecorView()); require(end != null); end.performClick(); });
            release.countDown();
            ((ExecutorService) field(null, "WORK")).submit(() -> {}).get(10, TimeUnit.SECONDS);
            runOnMainSync(() -> {
                require(field(current, "grant") == null);
                require(((TextView) field(current, "record")).getText().length() == 0);
                for (String name : new String[] {"approve", "read", "monday", "tuesday"}) require(!button(current, name).isEnabled());
                String message = ((TextView) field(current, "status")).getText().toString();
                if (lost) require(message.contains("Save outcome UNKNOWN"));
                else if (writing) require(message.contains("Save applied; access ended"));
            });
            require(calls.get() == 1 && Arrays.equals(completed, Files.readAllBytes(record.toPath())));
            result.putString("result", "PASS"); result.putString("operation", operation);
            result.putString("realStoreCompleted", "true"); result.putString("accessAndContentCleared", "true");
            result.putString("oneStoreCall", "true"); result.putString("noReplayDuringCheck", "true");
        } catch (Exception failure) {
            result.putString("result", "FAIL"); result.putString("failureType", failure.getClass().getSimpleName());
        } finally {
            release.countDown();
            if (storeField != null && service != null && store != null) try { storeField.set(service, store); } catch (Exception failure) { result.putString("result", "FAIL"); }
            if (activity != null) { Activity current = activity; runOnMainSync(current::finish); }
        }
        finish("PASS".equals(result.getString("result")) ? -1 : 1, result);
    }
}
