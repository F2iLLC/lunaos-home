package io.github.f2illc.lunaos.home.voiceprobe;
import android.content.Context;
import android.os.Handler;
/** Bounded bundled offline reply; capture resumes after completion or timeout. */
final class SpokenReply {
    private final Handler handler = new Handler();
    private final PromptPlayer player;
    private boolean done;
    private final Runnable completion;
    SpokenReply(Context context, String text, Runnable completion) {
        this.completion = completion;
        player = new PromptPlayer(context, text, () -> handler.post(this::finish));
        handler.postDelayed(this::finish, 15000);
        handler.post(() -> { if (!done) { QuestionPolicy.replyCaption = text; player.start(); } });
    }
    private void finish() { if (done) return; close(); completion.run(); }
    void close() {
        done = true; handler.removeCallbacksAndMessages(null); player.close();
    }
}
