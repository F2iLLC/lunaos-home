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
        this(context, question, completion, false);
    }
    private QuestionReply(Context context, String question, Completion completion, boolean confirmation) {
        this.confirmation = confirmation;
        this.completion = completion;
        main.postDelayed(this::finish, 90000);
        new Thread(() -> request(context.getApplicationContext(), question), confirmation ? "luna-confirmation" : "luna-question").start();
    }
    private final boolean confirmation;
    static void confirmEnabled(Context context) {
        new QuestionReply(context, null, played -> {}, true);
    }
    private void request(Context context, String question) {
        byte[] wave = null;
        String stage = "preflight";
        try {
            if (!enabled(context) || (!confirmation && !QuestionPolicy.accepts(question)) || closed || ProbeCapture.blocked(context)) throw new IOException();
            stage = "configuration";
            JSONObject config = readConfig(context);
            String token = config.getString("token");
            if (!token.matches("[a-f0-9]{64}")) throw new IOException();
            stage = "tls_setup";
            KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType()); store.load(null);
            store.setCertificateEntry("relay", CertificateFactory.getInstance("X.509").generateCertificate(
                new ByteArrayInputStream(config.getString("certificate").getBytes(StandardCharsets.US_ASCII))));
            TrustManagerFactory trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); trust.init(store);
            // The local relay supports TLS 1.2; pin the protocol for compatibility with Fire OS TLS stacks.
            SSLContext tls = SSLContext.getInstance("TLSv1.2"); tls.init(null, trust.getTrustManagers(), null);
            String path = confirmation ? "/confirmation" : "/question";
            stage = "connect";
            HttpsURLConnection next = (HttpsURLConnection) new java.net.URL(endpoint(config).replace("/question", path)).openConnection();
            synchronized (this) { if (closed) throw new IOException(); connection = next; }
            next.setSSLSocketFactory(tls.getSocketFactory()); // Default hostname verification remains enabled.
            next.setInstanceFollowRedirects(false); next.setConnectTimeout(5000); next.setReadTimeout(60000);
            next.setRequestMethod("POST"); next.setDoOutput(true);
            next.setRequestProperty("Authorization", "Bearer " + token);
            next.setRequestProperty("Content-Type", "application/json");
            next.setRequestProperty("X-Home-Session", QuestionPolicy.sessionId);
            stage = "request_body";
            byte[] body = (confirmation ? new JSONObject().put("event", "qwen_answers_enabled")
                : new JSONObject().put("question", question)).toString().getBytes(StandardCharsets.UTF_8);
            next.setFixedLengthStreamingMode(body.length);
            stage = "request_stream";
            OutputStream stream = next.getOutputStream();
            stage = "request_write";
            try (OutputStream out = stream) { if (closed) throw new IOException(); out.write(body); }
            finally { Arrays.fill(body, (byte) 0); }
            stage = "response_status";
            if (closed || next.getResponseCode() != 200 || !"audio/wav".equals(next.getContentType())) throw new IOException();
            stage = "response_audio";
            try (InputStream in = next.getInputStream()) { wave = readBounded(in, 2 * 1024 * 1024); }
            if (wave.length < 44 || wave[0] != 'R' || wave[1] != 'I' || wave[2] != 'F' || wave[3] != 'F') throw new IOException();
            final byte[] result = wave; wave = null;
            final String animation = next.getHeaderField("X-Home-Notebook-Animation");
            android.util.Log.i("HomeVoiceProbe", "QUESTION_REPLY_AUDIO_RECEIVED");
            stage = "playback_handoff";
            main.post(() -> {
                if (!closed && BackgroundWakeService.running && !ProbeCapture.blocked(context))
                    QuestionPolicy.notebookFeedback(animation);
                play(context, result);
            });
        } catch (Exception failure) {
            // Stage labels only: never log exception text, request data, or credentials.
            Throwable cause = failure.getCause();
            String causeType = cause == null ? "none" : cause.getClass().getSimpleName();
            Throwable root = cause == null ? null : cause.getCause();
            String rootType = root == null ? "none" : root.getClass().getSimpleName();
            String detail = "other";
            String diagnostic = (cause == null ? "" : cause.getMessage()) + " " + failure.getMessage();
            String normalized = diagnostic.toUpperCase(java.util.Locale.ROOT).replace('-', '_').replace(' ', '_');
            for (String marker : new String[] {"CERTIFICATE_VERIFY_FAILED", "NO_TRUST_ANCHOR", "WRONG_VERSION_NUMBER",
                "PROTOCOL_VERSION", "NO_SHARED_CIPHER", "HANDSHAKE_FAILURE", "UNEXPECTED_MESSAGE",
                "UNEXPECTED_EOF", "CONNECTION_RESET", "BAD_CERTIFICATE"}) {
                if (normalized.contains(marker)) { detail = marker.toLowerCase(java.util.Locale.ROOT); break; }
            }
            if ("other".equals(detail) && (normalized.contains("CERTIFICATE") || normalized.contains("CERTPATH"))) detail = "certificate";
            android.util.Log.i("HomeVoiceProbe", "QUESTION_REPLY_UNAVAILABLE_" + stage + "_"
                + failure.getClass().getSimpleName() + "_" + causeType + "_" + rootType + "_" + detail); main.post(this::finish);
        } finally {
            if (wave != null) Arrays.fill(wave, (byte) 0);
            synchronized (this) { if (connection != null) connection.disconnect(); connection = null; }
        }
    }
    // Called on a worker thread by the native notebook page. Same enrolled
    // endpoint, certificate and token as speech; no arbitrary URL from the UI.
    static JSONObject notebook(Context context, String body, String session) throws Exception {
        if (!configured(context) || body.length() > 8192 || !session.matches("[a-f0-9-]{32,64}")) throw new IOException();
        JSONObject config = readConfig(context);
        KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType()); store.load(null);
        store.setCertificateEntry("relay", CertificateFactory.getInstance("X.509").generateCertificate(
            new ByteArrayInputStream(config.getString("certificate").getBytes(StandardCharsets.US_ASCII))));
        TrustManagerFactory trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); trust.init(store);
        SSLContext tls = SSLContext.getInstance("TLSv1.2"); tls.init(null, trust.getTrustManagers(), null);
        HttpsURLConnection connection = (HttpsURLConnection) new java.net.URL(endpoint(config).replace("/question", "/notebook")).openConnection();
        try {
            connection.setSSLSocketFactory(tls.getSocketFactory()); connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(5000); connection.setReadTimeout(15000);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + config.getString("token"));
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("X-Home-Session", session);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            finally { Arrays.fill(bytes, (byte) 0); }
            if (connection.getResponseCode() != 200 || !"application/json".equals(connection.getContentType())) throw new IOException();
            try (InputStream input = connection.getInputStream()) {
                ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > 512 * 1024) throw new IOException();
                    output.write(buffer, 0, count);
                }
                return new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally { connection.disconnect(); }
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
        if (closed || (confirmation && !enabled(context)) || (!confirmation && !BackgroundWakeService.running)
            || ProbeCapture.blocked(context)) { Arrays.fill(wave, (byte) 0); finish(); return; }
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
            player.setOnPreparedListener(p -> { if (!closed && (confirmation ? enabled(context) : BackgroundWakeService.running)
                && !ProbeCapture.blocked(context)) { android.util.Log.i("HomeVoiceProbe", "QUESTION_REPLY_PLAYBACK_STARTED"); p.start(); } else finish(); });
            player.setOnCompletionListener(p -> { played = true; android.util.Log.i("HomeVoiceProbe", "QUESTION_REPLY_PLAYBACK_COMPLETED"); finish(); });
            player.setOnErrorListener((p, what, extra) -> { android.util.Log.i("HomeVoiceProbe", "QUESTION_REPLY_PLAYBACK_ERROR"); finish(); return true; });
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
