package io.github.f2illc.lunaos.directtlsprobe;

import android.content.Context;
import android.util.Base64;
import java.io.*;
import org.json.JSONObject;

/** Same enrolled TLS transport, separately enabled conversation permission. */
public final class VehicleConversationClient implements AutoCloseable {
    private SyntheticTlsClient client;
    private volatile boolean closed;
    public static final class Reply {
        public final String text, conversationId;
        public final byte[] wave;
        Reply(String text, String id, byte[] wave) { this.text = text; this.conversationId = id; this.wave = wave; }
    }
    public VehicleConversationClient(Context context) throws Exception {
        JSONObject config = FixtureConfig.read(context);
        if (!config.optBoolean("vehicleConversations", false)) throw new SecurityException("Conversation not configured");
        client = new SyntheticTlsClient(context, config);
        try { client.enableConversationTransfer(); if (!client.call(new JSONObject().put("op", "resume")).getBoolean("ok")) throw new SecurityException(); }
        catch (Exception error) { close(); throw error; }
    }
    private JSONObject call(JSONObject request) throws Exception {
        if (closed || Thread.currentThread().isInterrupted()) throw new IOException("Cancelled");
        JSONObject result = client.call(new JSONObject().put("op", "conversation").put("request", request));
        if (!result.getBoolean("ok")) throw new IOException("Conversation unavailable");
        return result.getJSONObject("value");
    }
    public void clear() throws Exception { call(new JSONObject().put("action", "clear")); }
    public void cancel(String requestId) throws Exception { call(new JSONObject().put("action", "cancel").put("requestId", requestId)); }
    public Reply ask(String requestId, String question, String voiceId) throws Exception {
        long deadline = android.os.SystemClock.elapsedRealtime() + 90_000;
        JSONObject state = call(new JSONObject().put("action", "ask").put("requestId", requestId).put("question", question)
            .put("voiceId", voiceId).put("parked", true).put("shareWithAssistant", true).put("speakWithProvider", true));
        while ("working".equals(state.optString("status"))) {
            if (android.os.SystemClock.elapsedRealtime() >= deadline) throw new IOException("Conversation timed out");
            Thread.sleep(500);
            state = call(new JSONObject().put("action", "status").put("requestId", requestId));
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
            JSONObject chunk = call(new JSONObject().put("action", "audio").put("requestId", requestId).put("offset", offset));
            String data = chunk.getString("data");
            if (data.length() > 5464 || !data.matches("[A-Za-z0-9+/]*={0,2}")) throw new IOException("Invalid audio chunk");
            byte[] decoded = Base64.decode(data, Base64.NO_WRAP);
            int count = Math.min(4096, size - offset);
            if (decoded.length != count || chunk.getInt("offset") != offset || chunk.getInt("next") != offset + count || chunk.getBoolean("done") != (offset + count == size)) throw new IOException("Audio chunk mismatch");
            bytes.write(decoded);
        }
        return new Reply(text, id, bytes.toByteArray());
    }
    @Override public void close() {
        closed = true;
        try { if (client != null) client.close(); } catch (IOException ignored) { }
    }
}
