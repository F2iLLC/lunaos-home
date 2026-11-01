package io.github.f2illc.lunaos.home.voiceprobe;

public final class PendingTimerRequestTest {
    private static int checks;
    private static void equal(int expected, int actual) {
        checks++;
        if (expected != actual) throw new AssertionError("Request policy mismatch");
    }
    public static void main(String[] args) {
        PendingTimerRequest request = new PendingTimerRequest();
        equal(0, request.claim(0, true));
        request.offer(10, 100);
        equal(10, request.peek(101, true));
        equal(10, request.claim(102, true));
        equal(0, request.claim(103, true));
        request.offer(10, 100);
        equal(10, request.peek(60099, true));
        equal(0, request.claim(60100, true));
        request.offer(10, 100);
        equal(0, request.peek(101, false));
        equal(0, request.claim(102, true));
        request.offer(10, 100); request.clear();
        equal(0, request.claim(101, true));
        request.offer(10, 100); request.offer(20, 101);
        equal(20, request.claim(102, true));
        request.offer(0, 100); equal(0, request.claim(101, true));
        request.offer(3601, 100); equal(0, request.claim(101, true));
        request.offer(1, 100); equal(1, request.claim(101, true));
        request.offer(3600, 100); equal(3600, request.claim(101, true));
        equal(0, new PendingTimerRequest().peek(101, true));
        System.out.println("PendingTimerRequest: " + checks + " checks passed");
    }
}
