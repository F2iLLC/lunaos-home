package io.github.f2illc.lunaos.directtlsprobe;

import android.content.Context;
import android.util.Base64;
import java.io.*;
import org.json.JSONObject;

/** Same enrolled TLS transport, separately enabled conversation permission. */
public final class VehicleConversationClient implements AutoCloseable {
    private volatile SyntheticTlsClient client;
    private final Context context;
    private final JSONObject config;
    private volatile boolean closed;
    private long deadline;
    private int reconnects;
    public static final class Reply {
        public final String text, conversationId;
        public final byte[] wave;
        Reply(String text, String id, byte[] wave) { this.text = text; this.conversationId = id; this.wave = wave; }
    }
    public VehicleConversationClient(Context context) throws Exception {
        this.context = context.getApplicationContext();
        config = FixtureConfig.read(context);
        if (!config.optBoolean("vehicleConversations", false)) throw new SecurityException("Conversation not configured");
        connect();
    }
    private void connect() throws Exception {
        checkActive();
        // New sockets follow Android's default network, including the owner's VPN.
        // Never bind to Wi-Fi or cellular directly, which could bypass the VPN.
        SyntheticTlsClient next = new SyntheticTlsClient(context, config);
        synchronized (this) {
            if (closed || Thread.currentThread().isInterrupted()) { next.close(); throw new IOException("Cancelled"); }
            client = next;
        }
        try { next.enableConversationTransfer(); if (!next.call(new JSONObject().put("op", "resume")).getBoolean("ok")) throw new SecurityException(); }
        catch (Exception error) { next.close(); throw error; }
    }
    private void checkActive() throws IOException {
        if (closed || Thread.currentThread().isInterrupted()) throw new IOException("Cancelled");
        if (deadline != 0 && android.os.SystemClock.elapsedRealtime() >= deadline) throw new IOException("Conversation timed out");
    }
    private JSONObject call(JSONObject request) throws Exception {
        checkActive();
        JSONObject result = client.call(new JSONObject().put("op", "conversation").put("request", request));
        // Application denial is final, never a reason to retry or start another paid turn.
        if (!result.getBoolean("ok")) throw new SecurityException("Conversation unavailable");
        return result.getJSONObject("value");
    }
    private void reconnect() throws Exception {
        checkActive();
        if (++reconnects > 3) throw new IOException("Home unreachable");
        client.close();
        Thread.sleep(1000L * reconnects);
        connect();
    }
    private JSONObject read(JSONObject request) throws Exception {
        // Only status and audio reads may be retried. In particular, an ambiguous
        // ask is NEVER resubmitted, even after host restart or session expiry.
        for (;;) {
            try { return call(request); }
            catch (javax.net.ssl.SSLException security) { throw security; }
            catch (IOException outage) {
                for (;;) {
                    try { reconnect(); break; }
                    catch (javax.net.ssl.SSLException security) { throw security; }
                    catch (IOException unavailable) { checkActive(); if (reconnects >= 3) throw unavailable; }
                }
            }
        }
    }
    public void clear() throws Exception { call(new JSONObject().put("action", "clear")); }
    public void cancel(String requestId) throws Exception { call(new JSONObject().put("action", "cancel").put("requestId", requestId)); }
    public Reply ask(String requestId, String question, String voiceId) throws Exception {
        deadline = android.os.SystemClock.elapsedRealtime() + 90_000;
        reconnects = 0;
        JSONObject status = new JSONObject().put("action", "status").put("requestId", requestId);
        JSONObject state;
        try {
            state = call(new JSONObject().put("action", "ask").put("requestId", requestId).put("question", question)
                .put("voiceId", voiceId).put("parked", true).put("shareWithAssistant", true).put("speakWithProvider", true));
        } catch (javax.net.ssl.SSLException security) { throw security; }
        catch (IOException ambiguous) { state = read(status); }
        while ("working".equals(state.optString("status"))) {
            if (android.os.SystemClock.elapsedRealtime() >= deadline) throw new IOException("Conversation timed out");
            Thread.sleep(500);
            state = read(status);
        }
        if (!"ready".equals(state.optString("status"))) throw new IOException("Conversation unavailable");
        String text = state.getString("answer"), id = state.getString("conversationId");
        java.util.UUID.fromString(id);
        int size = state.getInt("audioBytes");
        if (text.isEmpty() || text.length() > 360 || size < 44 || size > 2 * 1024 * 1024) throw new IOException("Invalid reply");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        while (bytes.size() < size) {
            if (android.os.SystemClock.elapsedRealtime() >= deadline) throw new IOException("Audio timed out");
            int offset = bytes.size();
            JSONObject chunk = read(new JSONObject().put("action", "audio").put("requestId", requestId).put("offset", offset));
            String data = chunk.getString("data");
            if (data.length() > 5464 || !data.matches("[A-Za-z0-9+/]*={0,2}")) throw new IOException("Invalid audio chunk");
            byte[] decoded = Base64.decode(data, Base64.NO_WRAP);
            int count = Math.min(4096, size - offset);
            if (decoded.length != count || chunk.getInt("offset") != offset || chunk.getInt("next") != offset + count || chunk.getBoolean("done") != (offset + count == size)) throw new IOException("Audio chunk mismatch");
            bytes.write(decoded);
        }
        checkActive();
        return new Reply(text, id, bytes.toByteArray());
    }
    @Override public synchronized void close() {
        closed = true;
        try { if (client != null) client.close(); } catch (IOException ignored) { }
    }
}
