package io.github.f2illc.lunaos.directtlsprobe;
import android.content.Context;
import org.json.JSONObject;
import java.io.IOException;
final class SyntheticTlsClient {
    static String fault;
    static int connections, asks, reads, closes, largestWindow;
    static boolean fired;
    private boolean broken;
    static final byte[] audio = new byte[70000];
    static { for (int i=0;i<audio.length;i++) audio[i]=(byte)(i * 13); }
    static void reset(String value) { fault=value; connections=asks=reads=closes=largestWindow=0; fired=false; }
    SyntheticTlsClient(Context context, JSONObject config) throws IOException { connections++; }
    void enableConversationTransfer() {}
    JSONObject[] audioWindow(String requestId, int offset, int size, int window) throws Exception {
        if (window < 1 || window > 8) throw new AssertionError();
        largestWindow=Math.max(largestWindow,window);
        int count=Math.min(window,(size-offset+4095)/4096);
        JSONObject[] result=new JSONObject[count];
        for(int i=0;i<count;i++) result[i]=call(new JSONObject().put("op","conversation").put("request",
            new JSONObject().put("action","audio").put("requestId",requestId).put("offset",offset+i*4096)));
        if ("corrupt".equals(fault)) result[0].getJSONObject("value").put("offset",4096);
        return result;
    }
    JSONObject call(JSONObject body) throws Exception {
        if (broken) throw new IOException("socket lost");
        if ("resume".equals(body.getString("op"))) return new JSONObject().put("ok", true);
        JSONObject request = body.getJSONObject("request"); String action = request.getString("action");
        if ("ask".equals(action)) {
            asks++;
            if ("security".equals(fault)) throw new javax.net.ssl.SSLHandshakeException("untrusted");
            if ("ambiguous".equals(fault) || "restart".equals(fault)) { broken=true; throw new IOException("response lost"); }
        } else {
            reads++;
            if ("restart".equals(fault)) return new JSONObject().put("ok", false);
            if ("outage".equals(fault)) throw new IOException("offline");
            if ("status".equals(fault) && !fired) { fired=true; broken=true; throw new IOException("handoff"); }
        }
        JSONObject value;
        if ("audio".equals(action)) {
            int offset=request.getInt("offset");
            if ("audio".equals(fault) && offset == 4096 && !fired) { fired=true; broken=true; throw new IOException("chunk lost"); }
            int next=Math.min(offset+4096,audio.length);
            value=new JSONObject().put("offset",offset).put("next",next).put("done",next==audio.length)
                .put("data",java.util.Base64.getEncoder().encodeToString(java.util.Arrays.copyOfRange(audio,offset,next)));
        } else if ("ask".equals(action)) value=new JSONObject().put("status","working");
        else value=new JSONObject().put("status","ready").put("answer","Fictional reply.")
            .put("conversationId","12345678-1234-4234-8234-123456789abc").put("audioBytes",audio.length);
        return new JSONObject().put("ok",true).put("value",value);
    }
    void close() throws IOException { closes++; }
}
