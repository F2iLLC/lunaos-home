package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaDataSource;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.util.Arrays;
import javax.net.ssl.*;
import org.json.JSONObject;

/** Opt-in text-only relay; TLS trust and device token are provisioned outside the APK. */
final class QuestionReply implements AutoCloseable {
    static final String PREFERENCES = "online-questions", ENABLED = "enabled";
    static boolean enabled(Context context) {
        try {
            if (!context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean(ENABLED, false)) return false;
            JSONObject config = readConfig(context);
            endpoint(config);
            return true;
        } catch (Exception ignored) { return false; }
    }
    static boolean configured(Context context) {
        try {
            JSONObject config = readConfig(context); endpoint(config);
            String token = config.getString("token");
            String certificate = config.getString("certificate");
            if (!token.matches("[a-f0-9]{64}")) return false;
            CertificateFactory.getInstance("X.509").generateCertificate(
                new ByteArrayInputStream(certificate.getBytes(StandardCharsets.US_ASCII)));
            return true;
        } catch (Exception ignored) { return false; }
    }
    private final Handler main = new Handler(Looper.getMainLooper());
    interface Completion { void done(boolean played); }
    private final Completion completion;
    private volatile boolean closed;
    private HttpsURLConnection connection;
    private MediaPlayer player;
    private byte[] audio;
    private boolean played;
    QuestionReply(Context context, String question, Completion completion) {
        this.completion = completion;
        main.postDelayed(this::finish, 90000);
        new Thread(() -> request(context.getApplicationContext(), question), "luna-question").start();
    }
    private void request(Context context, String question) {
        byte[] wave = null;
        try {
            if (!enabled(context) || !QuestionPolicy.accepts(question) || closed || ProbeCapture.blocked(context)) throw new IOException();
            JSONObject config = readConfig(context);
            String token = config.getString("token");
            if (!token.matches("[a-f0-9]{64}")) throw new IOException();
            KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType()); store.load(null);
            store.setCertificateEntry("relay", CertificateFactory.getInstance("X.509").generateCertificate(
                new ByteArrayInputStream(config.getString("certificate").getBytes(StandardCharsets.US_ASCII))));
            TrustManagerFactory trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); trust.init(store);
            SSLContext tls = SSLContext.getInstance("TLS"); tls.init(null, trust.getTrustManagers(), null);
            HttpsURLConnection next = (HttpsURLConnection) new java.net.URL(endpoint(config)).openConnection();
            synchronized (this) { if (closed) throw new IOException(); connection = next; }
            next.setSSLSocketFactory(tls.getSocketFactory()); // Default hostname verification remains enabled.
            next.setInstanceFollowRedirects(false); next.setConnectTimeout(5000); next.setReadTimeout(60000);
            next.setRequestMethod("POST"); next.setDoOutput(true);
            next.setRequestProperty("Authorization", "Bearer " + token);
            next.setRequestProperty("Content-Type", "application/json");
            byte[] body = new JSONObject().put("question", question).toString().getBytes(StandardCharsets.UTF_8);
            next.setFixedLengthStreamingMode(body.length);
            try (OutputStream out = next.getOutputStream()) { if (closed) throw new IOException(); out.write(body); }
            finally { Arrays.fill(body, (byte) 0); }
            if (closed || next.getResponseCode() != 200 || !"audio/wav".equals(next.getContentType())) throw new IOException();
            try (InputStream in = next.getInputStream()) { wave = readBounded(in, 2 * 1024 * 1024); }
            if (wave.length < 44 || wave[0] != 'R' || wave[1] != 'I' || wave[2] != 'F' || wave[3] != 'F') throw new IOException();
            final byte[] result = wave; wave = null;
            main.post(() -> play(context, result));
        } catch (Exception failure) {
            android.util.Log.i("HomeVoiceProbe", "QUESTION_REPLY_UNAVAILABLE"); main.post(this::finish);
        } finally {
            if (wave != null) Arrays.fill(wave, (byte) 0);
            synchronized (this) { if (connection != null) connection.disconnect(); connection = null; }
        }
    }
    private static JSONObject readConfig(Context context) throws Exception {
        File file = new File(context.getFilesDir(), "question-relay.json");
        if (!file.isFile() || file.length() > 16384) throw new IOException();
        try (InputStream input = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
            try {
                while ((count = input.read(buffer)) != -1) {
                    if (out.size() + count > 16384) throw new IOException();
                    out.write(buffer, 0, count);
                }
                return new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
            } finally { Arrays.fill(buffer, (byte) 0); }
        }
    }
    private static String endpoint(JSONObject config) throws Exception {
        String value = config.getString("endpoint");
        java.net.URL url = new java.net.URL(value);
        if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null || url.getQuery() != null
            || url.getRef() != null || !"/question".equals(url.getPath()) || url.getPort() != 18743
            || url.getHost().isEmpty()) throw new IOException();
        return value;
    }
    private byte[] readBounded(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int n;
        try {
            while ((n = input.read(buffer)) != -1) {
                if (closed || out.size() + n > limit) throw new IOException();
                out.write(buffer, 0, n);
            }
            return out.toByteArray();
        } finally { Arrays.fill(buffer, (byte) 0); }
    }
    private void play(Context context, byte[] wave) {
        if (closed || !BackgroundWakeService.running || ProbeCapture.blocked(context)) { Arrays.fill(wave, (byte) 0); finish(); return; }
        audio = wave;
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            player.setDataSource(new MediaDataSource() {
                public int readAt(long position, byte[] buffer, int offset, int size) {
                    if (position < 0 || position >= wave.length) return -1;
                    int count = Math.min(size, wave.length - (int) position);
                    System.arraycopy(wave, (int) position, buffer, offset, count); return count;
                }
                public long getSize() { return wave.length; }
                public void close() { }
            });
            player.setOnPreparedListener(p -> { if (!closed && BackgroundWakeService.running && !ProbeCapture.blocked(context)) p.start(); else finish(); });
            player.setOnCompletionListener(p -> { played = true; finish(); });
            player.setOnErrorListener((p, what, extra) -> { finish(); return true; });
            player.prepareAsync();
        } catch (Exception failure) { finish(); }
    }
    private void finish() { if (closed) return; close(); completion.done(played); }
    @Override public synchronized void close() {
        if (closed) return;
        closed = true; main.removeCallbacksAndMessages(null);
        if (connection != null) connection.disconnect(); connection = null;
        if (player != null) player.release(); player = null;
        if (audio != null) Arrays.fill(audio, (byte) 0); audio = null;
    }
}
