package io.github.f2illc.lunaos.home.voiceprobe;

import java.util.Arrays;

/**
 * In-memory audio for one post-wake command window.
 *
 * Free-form decoding on a small device runs slower than real time. If the
 * recorder is read only between decode calls, the speech that arrives while a
 * call is running is lost and the decoder hears a chopped command. A capture
 * thread appends every sample here instead. The fast fixed-phrase recognizer
 * follows the audio live through {@link #poll}; if it does not hear a
 * supported timer command, the same audio is decoded once more, free-form,
 * through {@link #replay}.
 *
 * The buffer never outlives its command window: it holds at most that window's
 * worth of audio, refuses (and counts) anything beyond it, and is zeroed on
 * close. It is not used before the wake phrase, is never written to storage
 * and never leaves the device.
 */
final class CommandAudio {
    static final int CHUNK_FRAMES = 1600; // 100 ms at 16 kHz mono.
    private final short[] frames;
    private int written, read;
    private boolean sealed, closed;
    private long droppedFrames;

    CommandAudio(long windowMs) {
        frames = new short[(int) Math.max(CHUNK_FRAMES, windowMs * 16)];
    }

    /** Append the first {@code count} samples. Returns false once sealed or closed. */
    synchronized boolean offer(short[] samples, int count) {
        if (closed || sealed) return false;
        int available = Math.max(0, Math.min(count, samples.length));
        int kept = Math.min(available, frames.length - written);
        System.arraycopy(samples, 0, frames, written, kept);
        written += kept;
        droppedFrames += available - kept;
        return true;
    }

    /** Copy the next unread samples for live decoding. Returns the count, or 0 when caught up. */
    synchronized int poll(short[] target) {
        if (closed) return 0;
        int count = Math.min(target.length, written - read);
        System.arraycopy(frames, read, target, 0, count);
        read += count;
        return count;
    }

    /** Copy captured samples starting at {@code offset} for one more decoding pass. */
    synchronized int replay(int offset, short[] target) {
        if (closed || offset < 0 || offset >= written) return 0;
        int count = Math.min(target.length, written - offset);
        System.arraycopy(frames, offset, target, 0, count);
        return count;
    }

    /** Capture is over: keep what was heard for decoding, accept nothing more. */
    synchronized void seal() { sealed = true; }

    /** Zero everything and refuse further use. */
    synchronized void close() {
        closed = true;
        sealed = true;
        Arrays.fill(frames, (short) 0);
        written = read = 0;
    }

    synchronized boolean capturing() { return !sealed && !closed; }
    synchronized boolean closed() { return closed; }
    /** How many samples live decoding has taken so far. */
    synchronized int consumed() { return read; }
    synchronized long capturedMs() { return written / 16; }
    synchronized long pendingMs() { return (written - read) / 16; }
    synchronized long droppedMs() { return droppedFrames / 16; }
}
