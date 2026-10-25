package io.github.f2illc.lunaos.home.vehicle;

import android.content.Context;
import android.os.SystemClock;
import android.provider.Settings;
import java.util.Calendar;
import java.util.concurrent.*;
import io.github.f2illc.lunaos.directtlsprobe.VehicleTransport;

final class VehicleRuntime {
    static final ExecutorService network = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<Runnable>(4), new ThreadPoolExecutor.DiscardPolicy());
    static int boot(Context c) { return Settings.Global.getInt(c.getContentResolver(), Settings.Global.BOOT_COUNT, 0); }
    static String period() { int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY); return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"; }
    static synchronized VehicleState connected(Context c) {
        VehicleState s = new VehicleState(c); if (s.address.isEmpty()) return s;
        s.trip.connect(SystemClock.elapsedRealtime(), boot(c));
        s.passengers.connect(s.trip.id, System.currentTimeMillis(), boot(c));
        s.status = s.trip.claimed ? "Greeting already attempted this trip. Reconnects will stay quiet." : "Vehicle connected.";
        s.save(); return s;
    }
    static synchronized boolean claim(Context c, String trip, int greetingId) {
        VehicleState s = new VehicleState(c);
        if (!s.trip.id.equals(trip) || s.address.isEmpty() || s.passengers.silenced || !s.trip.claim()) return false;
        s.lastGreetingId = greetingId;
        return s.save();
    }
    static synchronized void status(Context c, String value) { VehicleState s = new VehicleState(c); s.status = value; s.save(); }
    static synchronized void audio(Context c, String value) { VehicleState s = new VehicleState(c); s.audio = value; s.save(); }
    static void notifyBackend(Context c, boolean connected, java.util.function.Consumer<String> result) {
        final String trip; final int seq; final String address;
        synchronized (VehicleRuntime.class) {
            VehicleState s = new VehicleState(c); if (s.trip.id.isEmpty() || s.address.isEmpty()) return;
            trip = s.trip.id; seq = ++s.trip.sequence; address = s.address; if (!s.save()) return;
        }
        network.execute(() -> {
            String text = "", outcome;
            try { text = VehicleTransport.send(c, trip, seq, connected, period()); outcome = "Home session acknowledged"; }
            catch (Exception unavailable) {
                String reason = unavailable instanceof java.net.SocketTimeoutException ? "network timeout"
                    : unavailable instanceof javax.net.ssl.SSLException ? "TLS verification failed"
                    : unavailable instanceof SecurityException ? "endpoint permission refused"
                    : unavailable instanceof java.io.FileNotFoundException ? "connection not configured" : "connection failed";
                outcome = "Home unavailable (" + reason + "); local greeting only";
            }
            synchronized (VehicleRuntime.class) {
                VehicleState s = new VehicleState(c);
                if (!s.address.equals(address) || !s.trip.id.equals(trip) || s.trip.sequence != seq) return;
                s.backend = outcome; s.save();
            }
            result.accept(text);
        });
    }
    static synchronized void disconnect(Context c) {
        VehicleState s = new VehicleState(c);
        s.trip.disconnect(SystemClock.elapsedRealtime(), boot(c));
        s.status = "Disconnected. Same trip resumes within two minutes."; s.save();
        notifyBackend(c, false, text -> {});
    }
}
