package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Intent;
import android.os.Handler;
import android.os.SystemClock;

/** Executes the real service; the fake capture boundary never opens a microphone. */
public final class WakeServiceProbe {
    private static int checks;
    private static void check(boolean value) {
        if (!value) throw new AssertionError("Wake service case " + (checks + 1));
        checks++;
    }
    private static BackgroundWakeService enable() {
        ProbeCapture.blocked = false; ProbeCapture.busy = false;
        BackgroundWakeService service = new BackgroundWakeService();
        check(service.onStartCommand(new Intent(service, BackgroundWakeService.class)
            .setAction(BackgroundWakeService.START), 0, 1) == BackgroundWakeService.START_NOT_STICKY);
        Handler.advance(0);
        check(BackgroundWakeService.running && service.foreground && ProbeCapture.busy());
        return service;
    }
    private static void disable(BackgroundWakeService service) {
        service.onStartCommand(new Intent(service, BackgroundWakeService.class).setAction(BackgroundWakeService.STOP), 0, 2);
        service.onDestroy(); ProbeCapture.busy = false;
    }
    public static void main(String[] args) {
        BackgroundWakeService service = enable();
        ProbeCapture first = ProbeCapture.last;
        int starts = ProbeCapture.starts;
        Handler.advance(360000);
        check(BackgroundWakeService.running && ProbeCapture.last == first);
        check(service.power.last.isHeld() && service.power.last.acquisitions >= 2);
        service.onStartCommand(new Intent(service, BackgroundWakeService.class).setAction(BackgroundWakeService.START), 0, 3);
        check(ProbeCapture.starts == starts);

        // Watchdog timeouts cancel their worker, but do not revoke the user's enable action.
        first.finish("COMMAND_WINDOW_EXPIRED", 0, true);
        check(BackgroundWakeService.running && !ProbeCapture.busy());
        Handler.advance(750);
        check(ProbeCapture.starts == starts + 1 && ProbeCapture.busy());
        first.listener.finished("COMMAND_MATCH", "late", 60, SystemClock.now + 10000, false);
        check(BackgroundWakeService.pendingSeconds(service) == 0);
        ProbeCapture.last.finish("COMMAND_MATCH", 5, false);
        check(BackgroundWakeService.pendingSeconds(service) == 5);
        check(BackgroundWakeService.running && service.foreground && !ProbeCapture.busy());
        check(!service.power.last.isHeld());
        Handler.advance(59999);
        check(BackgroundWakeService.pendingSeconds(service) == 5);
        Handler.advance(101);
        check(BackgroundWakeService.pendingSeconds(service) == 0 && ProbeCapture.busy());
        ProbeCapture.last.finish("COMMAND_MATCH", 10, false);
        check(BackgroundWakeService.claim(service) == 10);
        check(BackgroundWakeService.claim(service) == 0);
        Handler.advance(100);
        check(BackgroundWakeService.running && ProbeCapture.busy());
        ProbeCapture.last.finish("COMMAND_MATCH", 20, false);
        BackgroundWakeService.discard(); Handler.advance(100);
        check(BackgroundWakeService.pendingSeconds(service) == 0 && ProbeCapture.busy());
        ProbeCapture.last.finish("COMMAND_WINDOW_EXPIRED", 0, true);
        starts = ProbeCapture.starts;
        disable(service); Handler.advance(2000);
        check(!BackgroundWakeService.running && !service.foreground && ProbeCapture.starts == starts);
        check(!service.power.last.isHeld());

        service = enable(); first = ProbeCapture.last;
        BackgroundWakeService.revoke(service);
        first.finish("COMMAND_MATCH", 5, false);
        check(BackgroundWakeService.pendingSeconds(service) == 0 && !BackgroundWakeService.running);
        service.onDestroy();

        service = enable(); first = ProbeCapture.last;
        ProbeCapture.blocked = true; Handler.advance(100);
        check(!BackgroundWakeService.running && first.stopped && !service.power.last.isHeld());
        ProbeCapture.blocked = false;
        first.finish("COMMAND_MATCH", 5, false); Handler.advance(1000);
        check(!BackgroundWakeService.running && BackgroundWakeService.pendingSeconds(service) == 0);
        service.onDestroy();

        service = enable(); ProbeCapture.last.finish("COMMAND_MATCH", 5, false);
        ProbeCapture.blocked = true; Handler.advance(100);
        check(!BackgroundWakeService.running && BackgroundWakeService.pendingSeconds(service) == 0);
        ProbeCapture.blocked = false; Handler.advance(1000);
        check(!BackgroundWakeService.running);
        service.onDestroy();

        service = enable(); starts = ProbeCapture.starts;
        ProbeCapture.last.finish("MODEL_LOAD_FAILED", 0, false); Handler.advance(1000);
        check(!BackgroundWakeService.running && ProbeCapture.starts == starts);
        service.onDestroy();
        service = new BackgroundWakeService(); starts = ProbeCapture.starts;
        service.onStartCommand(null, 0, 1); Handler.advance(1000);
        check(!BackgroundWakeService.running && ProbeCapture.starts == starts);
        service.onDestroy();
        System.out.println("Wake service lifecycle checks passed (" + checks + " cases).");
    }
}
