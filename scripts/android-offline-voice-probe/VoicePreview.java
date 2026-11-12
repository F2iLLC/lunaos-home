package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import java.util.function.Consumer;

/** UI-thread-only, bounded offline sample. Never invokes timer or microphone controls. */
final class VoicePreview {
    private static VoicePreview current;
    private final Handler handler = new Handler();
    private final MediaPlayer player = new MediaPlayer();
    private final Consumer<Boolean> completion;
    private boolean finished;

    private VoicePreview(Consumer<Boolean> completion) { this.completion = completion; }

    static void play(Context context, String voice, Consumer<Boolean> completion) {
        if (!LunaVoice.available(context, voice)) throw new IllegalArgumentException("Voice pack unavailable");
        if (current != null) current.finish(false);
        VoicePreview preview = new VoicePreview(completion);
        current = preview;
        preview.start(context, voice);
    }

    private void start(Context context, String voice) {
        handler.postDelayed(() -> finish(false), 10000);
        try (AssetFileDescriptor file = context.getAssets().openFd(LunaVoice.directory(voice) + "/started-5-minute.wav")) {
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            player.setDataSource(file.getFileDescriptor(), file.getStartOffset(), file.getLength());
            player.setOnCompletionListener(p -> finish(true));
            player.setOnErrorListener((p, what, extra) -> { finish(false); return true; });
            player.setOnPreparedListener(p -> {
                if (!finished) {
                    try { p.start(); } catch (Exception failure) { finish(false); }
                }
            });
            player.prepareAsync();
        } catch (Exception failure) { finish(false); }
    }

    private void finish(boolean played) {
        if (finished) return;
        finished = true;
        handler.removeCallbacksAndMessages(null);
        player.release();
        if (current == this) current = null;
        completion.accept(played);
    }
}
