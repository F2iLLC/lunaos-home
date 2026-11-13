package io.github.f2illc.lunaos.home.voiceprobe;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.*;

/** Generic build-generated voice clips, never recordings of household speech. */
final class PromptPlayer {
    private MediaPlayer player;
    private boolean closed;
    private final Context context;
    private final String[] clips;
    private final String directory;
    private final Runnable completion;
    private final Runnable started;
    private int index;
    PromptPlayer(Context c, String text, Runnable done) { this(c, text, () -> {}, done); }
    PromptPlayer(Context c, String text, Runnable started, Runnable done) { context = c; clips = ReplyPlan.clips(text); directory = LunaVoice.directory(c); this.started = started; completion = done; }
    void start() { next(); }
    private void next() {
        if (closed) return;
        if (player != null) { player.release(); player = null; }
        if (index == clips.length) { close(); completion.run(); return; }
        try (AssetFileDescriptor file = context.getAssets().openFd(directory + "/" + clips[index++] + ".wav")) {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            player.setDataSource(file.getFileDescriptor(), file.getStartOffset(), file.getLength());
            player.setOnCompletionListener(p -> next());
            player.setOnErrorListener((p, what, extra) -> { close(); completion.run(); return true; });
            player.prepare(); player.start(); started.run();
        } catch (Exception failure) { close(); completion.run(); }
    }
    void close() { closed = true; if (player != null) { player.release(); player = null; } }
}
