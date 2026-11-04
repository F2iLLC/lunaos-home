package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Context;

/** Home stays offline until its authenticated hosted LunaOS service is integrated. */
final class QuestionReply implements AutoCloseable {
    interface Completion { void done(boolean played); }
    static boolean enabled(Context context) { return false; }
    QuestionReply(Context context, String question, Completion completion) { }
    @Override public void close() { }
}
