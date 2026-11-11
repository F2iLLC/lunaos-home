package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Context;
import android.media.MediaPlayer;
import android.os.Handler;
import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import javax.net.ssl.*;

/** Synthetic loopback TLS fixture; no providers, device audio or private config. */
public final class QuestionReplyProbe {
    static final String TOKEN = "a".repeat(64);
    static volatile int status = 200;
    static volatile boolean hold;
    static volatile CountDownLatch arrived, release, served;
    static volatile Throwable serverFailure;
    static String endpoint;
    static Context context;
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    static void await(BooleanSupplier condition) throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(8);
        while (!condition.getAsBoolean() && System.nanoTime() < end) { Handler.pump(); Thread.sleep(5); }
        check(condition.getAsBoolean(), "timed out waiting for fixture event");
    }
    static void reset(int code, boolean delayed) {
        status = code; hold = delayed; MediaPlayer.last = null;
        arrived = new CountDownLatch(1); release = new CountDownLatch(1); served = new CountDownLatch(1);
    }
    static void settle() throws Exception {
        release.countDown(); await(() -> served.getCount() == 0);
        // Wait for the actual request worker to exit, then drain its queued callback.
        await(() -> Thread.getAllStackTraces().keySet().stream().noneMatch(t -> t.getName().equals("luna-question") && t.isAlive()));
        Handler.pump();
        if (serverFailure != null) throw new AssertionError(serverFailure);
    }
    static QuestionReply request(List<Boolean> results, int readMs, long deadlineMs) {
        return new QuestionReply(context, "What is two plus two?", results::add, endpoint, readMs, deadlineMs);
    }
    static void erased(MediaPlayer player) {
        byte[] bytes = new byte[(int) player.source.getSize()];
        check(player.source.readAt(0, bytes, 0, bytes.length) == bytes.length, "read media buffer");
        check(Arrays.equals(bytes, new byte[bytes.length]), "audio erased on close");
    }
    public static void main(String[] args) throws Exception {
        Path dir = Path.of(args[0]);
        KeyStore keys = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(dir.resolve("relay.p12"))) { keys.load(in, "fixture-only".toCharArray()); }
        String certificate = "-----BEGIN CERTIFICATE-----\n" + Base64.getMimeEncoder(64, new byte[]{10}).encodeToString(keys.getCertificate("relay").getEncoded()) + "\n-----END CERTIFICATE-----\n";
        Files.writeString(dir.resolve("question-relay.json"), "{\"token\":\"" + TOKEN + "\",\"certificate\":\"" + certificate.replace("\n", "\\n") + "\"}");
        context = new Context(dir.toFile());
        KeyManagerFactory managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        managers.init(keys, "fixture-only".toCharArray());
        SSLContext tls = SSLContext.getInstance("TLS"); tls.init(managers.getKeyManagers(), null, null);
        HttpsServer server = HttpsServer.create(new InetSocketAddress("localhost", 0), 0);
        server.setHttpsConfigurator(new HttpsConfigurator(tls));
        ExecutorService executor = Executors.newCachedThreadPool(); server.setExecutor(executor);
        server.createContext("/question", exchange -> {
            try {
                check(exchange.getRequestMethod().equals("POST"), "POST method");
                check(("Bearer " + TOKEN).equals(exchange.getRequestHeaders().getFirst("Authorization")), "scoped token");
                check("application/json".equals(exchange.getRequestHeaders().getFirst("Content-Type")), "JSON content type");
                check(QuestionPolicy.sessionId.equals(exchange.getRequestHeaders().getFirst("X-Home-Session")), "conversation isolation header");
                check(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8).equals("{\"question\":\"What is two plus two?\"}"), "question body");
                arrived.countDown();
                if (hold) check(release.await(8, TimeUnit.SECONDS), "fixture released");
                byte[] wave = new byte[44]; System.arraycopy(new byte[]{'R','I','F','F'}, 0, wave, 0, 4);
                exchange.getResponseHeaders().set("Content-Type", "audio/wav");
                exchange.getResponseHeaders().set("X-Home-Notebook-Animation", "scribble");
                exchange.getResponseHeaders().set("X-Home-Notebook-List", "list-synthetic");
                exchange.sendResponseHeaders(status, wave.length);
                exchange.getResponseBody().write(wave);
            } catch (IOException expectedDisconnect) {
                // Deadline/cancel cases deliberately disconnect the request.
                if (!hold) serverFailure = expectedDisconnect;
            } catch (Throwable failure) { serverFailure = failure; }
            finally { exchange.close(); served.countDown(); }
        });
        server.start(); endpoint = "https://localhost:" + server.getAddress().getPort() + "/question";
        try {
            List<Boolean> results = new ArrayList<>();
            reset(200, false); QuestionReply reply = request(results, 3000, 10000);
            await(() -> MediaPlayer.last != null); MediaPlayer player = MediaPlayer.last;
            check(results.isEmpty(), "network success alone is not playback completion");
            check(QuestionPolicy.notebookAnimation().equals("scribble"), "actual relay outcome reaches avatar state");
            check(QuestionPolicy.notebookListId.equals("list-synthetic"), "saved list ID reaches popup state");
            player.prepared.call(player); check(MediaPlayer.starts == 1, "prepared starts audio");
            player.completed.call(player); check(results.equals(List.of(true)), "successful playback completes true once");
            player.completed.call(player); player.error.call(player, 1, 1); reply.close();
            check(results.size() == 1 && MediaPlayer.releases == 1, "late callbacks do not repeat completion/release");
            erased(player); settle();

            results.clear(); reset(503, false); request(results, 3000, 10000);
            await(() -> !results.isEmpty()); check(results.equals(List.of(false)), "HTTP error completes false");
            check(MediaPlayer.last == null, "HTTP failure never plays"); settle();

            results.clear(); reset(200, true); request(results, 1000, 10000);
            await(() -> arrived.getCount() == 0); await(() -> !results.isEmpty());
            check(results.equals(List.of(false)), "socket read timeout completes false"); settle();
            check(results.size() == 1 && MediaPlayer.last == null, "timeout suppresses delayed response");

            results.clear(); reset(200, true); request(results, 6000, 2500);
            await(() -> arrived.getCount() == 0); await(() -> !results.isEmpty());
            check(results.equals(List.of(false)), "overall deadline completes false"); settle();
            check(results.size() == 1 && MediaPlayer.last == null, "deadline suppresses late response");

            results.clear(); reset(200, true); reply = request(results, 3000, 10000);
            await(() -> arrived.getCount() == 0); reply.close(); reply.close(); settle();
            check(results.isEmpty() && MediaPlayer.last == null, "close during request suppresses completion and playback");

            results.clear(); reset(200, false); reply = request(results, 3000, 10000);
            await(() -> MediaPlayer.last != null); player = MediaPlayer.last; int starts = MediaPlayer.starts;
            reply.close(); player.prepared.call(player); player.completed.call(player); player.error.call(player, 1, 1);
            check(results.isEmpty() && MediaPlayer.starts == starts, "close before prepared suppresses stale player callbacks");
            erased(player); settle();

            results.clear(); reset(200, false); request(results, 3000, 10000);
            await(() -> MediaPlayer.last != null); player = MediaPlayer.last; player.error.call(player, 1, 1);
            check(results.equals(List.of(false)), "player error completes false"); erased(player); settle();
            System.out.println("Question reply contract checks passed");
        } finally { release.countDown(); server.stop(0); executor.shutdownNow(); }
    }
}
