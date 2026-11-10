package io.github.f2illc.lunaos.home.voiceprobe;

import java.util.ArrayDeque;
import java.util.Arrays;

/**
 * Bounded in-memory audio for one post-wake command window.
 *
 * Free-form decoding on a small device can run slower than real time. If the
 * recorder is read only between decode calls, the speech that arrives while a
 * call is running is lost and the decoder hears a chopped command. A capture
 * thread offers every chunk here instead and the decoder polls at its own pace.
 *
 * The queue never outlives its command window: it holds at most that window's
 * worth of audio, overwrites the oldest chunk when full, zeroes every chunk it
 * drops or hands over, and is cleared on close. It is not used before the wake
 * phrase, is never written to storage and never leaves the device.
 */
final class CommandAudio {
    static final int CHUNK_FRAMES = 1600; // 100 ms at 16 kHz mono.
    private final ArrayDeque<short[]> chunks = new ArrayDeque<>();
    private final int capacity;
    private boolean closed;
    private long droppedFrames, queuedFrames, maxQueuedFrames;

    CommandAudio(long windowMs) {
        capacity = (int) Math.max(1, windowMs * 16 / CHUNK_FRAMES);
    }

    /** Queue a copy of the first {@code count} samples. Returns false once closed. */
    synchronized boolean offer(short[] samples, int count) {
        if (closed) return false;
        if (count <= 0) return true;
        while (chunks.size() >= capacity) discard(chunks.poll(), true);
        chunks.add(Arrays.copyOf(samples, Math.min(count, samples.length)));
        queuedFrames += Math.min(count, samples.length);
        maxQueuedFrames = Math.max(maxQueuedFrames, queuedFrames);
        return true;
    }

    /** Move the oldest chunk into {@code target}. Returns its length, or 0 when empty. */
    synchronized int poll(short[] target) {
        short[] next = chunks.poll();
        if (next == null) return 0;
        int count = Math.min(next.length, target.length);
        System.arraycopy(next, 0, target, 0, count);
        discard(next, false);
        return count;
    }

    private void discard(short[] chunk, boolean dropped) {
        if (chunk == null) return;
        queuedFrames -= chunk.length;
        if (dropped) droppedFrames += chunk.length;
        Arrays.fill(chunk, (short) 0);
    }

    /** Clear everything and refuse further audio. */
    synchronized void close() {
        closed = true;
        while (!chunks.isEmpty()) discard(chunks.poll(), false);
    }

    synchronized boolean closed() { return closed; }
    synchronized long queuedMs() { return queuedFrames / 16; }
    synchronized long maxQueuedMs() { return maxQueuedFrames / 16; }
    synchronized long droppedMs() { return droppedFrames / 16; }
}
