package io.github.f2illc.lunaos.directtlsprobe;
public class ConversationRecoveryTest {
    static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) throws Exception {
        for (String fault : new String[]{"none","ambiguous","status","audio","restart","security","outage","cancel","corrupt"}) {
            SyntheticTlsClient.reset(fault);
            try (VehicleConversationClient client = new VehicleConversationClient(new android.content.Context())) {
                if (fault.equals("cancel")) client.close();
                try {
                    VehicleConversationClient.Reply reply=client.ask("12345678-1234-4234-8234-123456789abc","Fictional question.","abcdefghijklmnopqrst");
                    check(!fault.equals("restart") && !fault.equals("security") && !fault.equals("outage") && !fault.equals("cancel") && !fault.equals("corrupt"));
                    check(java.util.Arrays.equals(reply.wave,SyntheticTlsClient.audio));
                    check(SyntheticTlsClient.largestWindow == 8);
                    check(reply.transferMs >= 0 && reply.readyMs >= 0 && reply.connectionMs >= 0);
                } catch (Exception expected) {
                    check(fault.equals("restart") || fault.equals("security") || fault.equals("outage") || fault.equals("cancel") || fault.equals("corrupt"));
                }
                check(SyntheticTlsClient.asks == (fault.equals("cancel") ? 0 : 1));
                check(SyntheticTlsClient.connections <= 4);
                if (fault.equals("security")) check(SyntheticTlsClient.connections == 1);
                if (fault.equals("ambiguous") || fault.equals("status") || fault.equals("audio") || fault.equals("restart")) check(SyntheticTlsClient.connections == 2);
                if (fault.equals("outage")) check(SyntheticTlsClient.connections == 4);
            }
        }
        System.out.println("Conversation recovery passed: lost ask, status/audio handoff, host restart, TLS failure, bounded outage, cancellation; no paid replay.");
    }
}
