package io.github.f2illc.lunaos.home.voiceprobe;

import java.util.concurrent.atomic.AtomicLong;

/** JVM checks for the post-wake audio queue. Synthetic samples only. */
public final class CommandAudioTest {
    private static int checks;
    private static void check(boolean condition, String name) {
        if (!condition) throw new AssertionError(name);
        checks++;
    }
    private static short[] chunk(int value) {
        short[] samples = new short[CommandAudio.CHUNK_FRAMES];
        java.util.Arrays.fill(samples, (short) value);
        return samples;
    }

    public static void main(String[] args) throws Exception {
        // Order is preserved and nothing is lost while the reader is slow.
        CommandAudio audio = new CommandAudio(15000);
        short[] target = new short[CommandAudio.CHUNK_FRAMES];
        check(audio.poll(target) == 0, "an empty queue yields nothing");
        for (int i = 1; i <= 30; i++) check(audio.offer(chunk(i), CommandAudio.CHUNK_FRAMES), "offer " + i);
        check(audio.queuedMs() == 3000 && audio.maxQueuedMs() == 3000, "three seconds waited for a slow decoder");
        for (int i = 1; i <= 30; i++) {
            check(audio.poll(target) == CommandAudio.CHUNK_FRAMES, "poll " + i);
            check(target[0] == i && target[CommandAudio.CHUNK_FRAMES - 1] == i, "chunk " + i + " arrives in order");
        }
        check(audio.poll(target) == 0 && audio.queuedMs() == 0 && audio.droppedMs() == 0, "drained without loss");

        // A short read keeps only the samples that were read.
        short[] partial = chunk(7);
        check(audio.offer(partial, 400) && audio.queuedMs() == 25, "partial chunk queued");
        java.util.Arrays.fill(target, (short) 0);
        check(audio.poll(target) == 400 && target[399] == 7 && target[400] == 0, "partial chunk length preserved");
        check(audio.offer(partial, 0) && audio.queuedMs() == 0, "an empty read queues nothing");

        // The queue is bounded by its window: the oldest audio is overwritten.
        CommandAudio bounded = new CommandAudio(1000);
        for (int i = 1; i <= 25; i++) bounded.offer(chunk(i), CommandAudio.CHUNK_FRAMES);
        check(bounded.queuedMs() == 1000 && bounded.maxQueuedMs() == 1000, "never more than the window");
        check(bounded.droppedMs() == 1500, "overflow is counted, not hidden");
        check(bounded.poll(target) == CommandAudio.CHUNK_FRAMES && target[0] == 16, "the newest window survives");

        // Handing a chunk over does not leave a second copy in the queue, and
        // the caller's buffer is copied, not kept.
        CommandAudio copied = new CommandAudio(1000);
        short[] source = chunk(9);
        copied.offer(source, CommandAudio.CHUNK_FRAMES);
        java.util.Arrays.fill(source, (short) 0);
        check(copied.poll(target) == CommandAudio.CHUNK_FRAMES && target[0] == 9, "queued audio is an independent copy");

        // Close clears pending audio and refuses more.
        bounded.close();
        check(bounded.closed() && bounded.queuedMs() == 0 && bounded.poll(target) == 0, "close clears the queue");
        check(!bounded.offer(chunk(1), CommandAudio.CHUNK_FRAMES) && bounded.queuedMs() == 0, "closed queue refuses audio");

        // A producer faster than the consumer loses nothing within the window.
        CommandAudio shared = new CommandAudio(15000);
        AtomicLong consumed = new AtomicLong();
        Thread producer = new Thread(() -> {
            for (int i = 0; i < 100; i++) shared.offer(chunk(i % 100 + 1), CommandAudio.CHUNK_FRAMES);
        });
        Thread consumer = new Thread(() -> {
            short[] buffer = new short[CommandAudio.CHUNK_FRAMES];
            long deadline = System.nanoTime() + 5_000_000_000L;
            int expected = 1;
            while (consumed.get() < 100 && System.nanoTime() < deadline) {
                int count = shared.poll(buffer);
                if (count == 0) { Thread.yield(); continue; }
                if (buffer[0] != expected) throw new AssertionError("out of order");
                expected = expected % 100 + 1;
                consumed.incrementAndGet();
            }
        });
        producer.start(); consumer.start(); producer.join(); consumer.join();
        check(consumed.get() == 100 && shared.droppedMs() == 0, "concurrent capture and decode lose nothing");

        System.out.println(checks + " command audio checks passed");
    }
}
