package io.github.f2illc.lunaos.home.voiceprobe;

import java.util.concurrent.atomic.AtomicLong;

/** JVM checks for the post-wake command audio. Synthetic samples only. */
public final class CommandAudioTest {
    private static int checks;
    private static void check(boolean condition, String name) {
        if (!condition) throw new AssertionError(name);
        checks++;
    }
    private static short[] filled(int length, int value) {
        short[] samples = new short[length];
        java.util.Arrays.fill(samples, (short) value);
        return samples;
    }

    public static void main(String[] args) throws Exception {
        short[] target = new short[CommandAudio.CHUNK_FRAMES];

        // Small reads from the recorder are coalesced and nothing is lost
        // while the reader is slow.
        CommandAudio audio = new CommandAudio(15000);
        check(audio.poll(target) == 0, "nothing to decode before capture");
        for (int i = 1; i <= 300; i++) check(audio.offer(filled(160, i), 160), "offer " + i);
        check(audio.capturedMs() == 3000 && audio.pendingMs() == 3000, "three seconds waited for a slow decoder");
        for (int chunk = 0; chunk < 30; chunk++) {
            check(audio.poll(target) == CommandAudio.CHUNK_FRAMES, "a full chunk from small reads");
            check(target[0] == chunk * 10 + 1 && target[CommandAudio.CHUNK_FRAMES - 1] == chunk * 10 + 10, "samples arrive in order");
        }
        check(audio.poll(target) == 0 && audio.pendingMs() == 0 && audio.droppedMs() == 0, "caught up without loss");

        // A short read keeps only the samples that were read.
        check(audio.offer(filled(CommandAudio.CHUNK_FRAMES, 7), 400), "partial read");
        java.util.Arrays.fill(target, (short) 0);
        check(audio.poll(target) == 400 && target[399] == 7 && target[400] == 0, "partial read length preserved");
        check(audio.offer(target, 0) && audio.pendingMs() == 0, "an empty read adds nothing");

        // The same audio can be decoded once more from the start, in full.
        check(audio.capturedMs() == 3025, "everything captured is retained for the window");
        int offset = 0, count, total = 0;
        short first = 0, last = 0;
        while ((count = audio.replay(offset, target)) > 0) {
            if (offset == 0) first = target[0];
            last = target[count - 1];
            offset += count; total += count;
        }
        check(total == 3025 * 16 && first == 1 && last == 7, "replay returns the complete command");
        check(audio.replay(-1, target) == 0 && audio.replay(total, target) == 0, "replay stays inside the capture");

        // The buffer is bounded by its window; overflow is counted, not hidden,
        // and the start of the command is what survives.
        CommandAudio bounded = new CommandAudio(1000);
        for (int i = 1; i <= 25; i++) bounded.offer(filled(CommandAudio.CHUNK_FRAMES, i), CommandAudio.CHUNK_FRAMES);
        check(bounded.capturedMs() == 1000, "never more than the window");
        check(bounded.droppedMs() == 1500, "overflow is counted");
        check(bounded.poll(target) == CommandAudio.CHUNK_FRAMES && target[0] == 1, "the start of the command is kept");

        // The caller's buffer is copied, not kept.
        CommandAudio copied = new CommandAudio(1000);
        short[] source = filled(CommandAudio.CHUNK_FRAMES, 9);
        copied.offer(source, CommandAudio.CHUNK_FRAMES);
        java.util.Arrays.fill(source, (short) 0);
        check(copied.poll(target) == CommandAudio.CHUNK_FRAMES && target[0] == 9, "captured audio is an independent copy");

        // Sealing ends capture but keeps the audio for decoding.
        check(copied.capturing(), "capturing until sealed");
        copied.seal();
        check(!copied.capturing() && !copied.offer(filled(10, 1), 10), "a sealed capture accepts nothing more");
        check(copied.replay(0, target) == CommandAudio.CHUNK_FRAMES && target[0] == 9, "sealed audio is still decodable");

        // Close clears the audio and refuses every use.
        copied.close();
        check(copied.closed() && copied.capturedMs() == 0 && copied.pendingMs() == 0, "close clears the capture");
        check(copied.poll(target) == 0 && copied.replay(0, target) == 0, "nothing is readable after close");
        check(!copied.offer(filled(10, 1), 10) && copied.capturedMs() == 0, "a closed capture accepts nothing");

        // A capture thread faster than the decoder loses nothing within the window.
        CommandAudio shared = new CommandAudio(15000);
        AtomicLong decoded = new AtomicLong();
        Thread producer = new Thread(() -> {
            for (int i = 0; i < 1000; i++) shared.offer(filled(160, i % 100 + 1), 160);
        });
        Thread consumer = new Thread(() -> {
            short[] buffer = new short[CommandAudio.CHUNK_FRAMES];
            long deadline = System.nanoTime() + 5_000_000_000L;
            while (decoded.get() < 160_000 && System.nanoTime() < deadline) {
                int read = shared.poll(buffer);
                if (read == 0) { Thread.yield(); continue; }
                for (int i = 0; i < read; i++) {
                    long position = decoded.get() + i;
                    if (buffer[i] != (position / 160) % 100 + 1) throw new AssertionError("out of order");
                }
                decoded.addAndGet(read);
            }
        });
        producer.start(); consumer.start(); producer.join(); consumer.join();
        check(decoded.get() == 160_000 && shared.droppedMs() == 0, "concurrent capture and decode lose nothing");

        // A wake session lets bounded local decoding finish after capture ends,
        // but never revives an exchange that is already over.
        WakeSession wake = new WakeSession(0, true);
        check(wake.acceptFinal("hey luna", 1000) == WakeSession.WAKE && wake.deadline() == 1000 + WakeSession.COMMAND_MS, "command window opens at the wake phrase");
        wake.decodeUntil(40000);
        check(wake.deadline() == 40000 && !wake.expired(30000), "decoding may outlast the capture window");
        check(wake.acceptQuestion("why is the sky blue", 30000), "a question decoded after capture is accepted");
        wake.decodeUntil(90000);
        check(wake.expired(30001), "a finished exchange stays finished");
        WakeSession asleep = new WakeSession(0, true);
        asleep.decodeUntil(40000);
        check(asleep.deadline() == Long.MAX_VALUE && !asleep.awaitingCommand(), "no decoding window before the wake phrase");
        WakeSession limited = new WakeSession(0);
        limited.acceptFinal("hey luna", WakeSession.WAIT_MS - 1000);
        limited.decodeUntil(WakeSession.WAIT_MS + 60000);
        check(limited.deadline() == WakeSession.WAIT_MS, "decoding never passes the overall listening limit");

        System.out.println(checks + " command audio checks passed");
    }
}
