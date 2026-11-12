package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Context;
import java.io.InputStream;

/** Saved Home voice choice. Only complete build-validated packs are selectable. */
final class LunaVoice {
    private static final String PREFERENCES = "home-voice", KEY = "selected";
    static String directory(String id) {
        if ("original".equals(id)) return "replies";
        if ("lori".equals(id)) return "replies-lori";
        throw new IllegalArgumentException("Unknown Home voice");
    }
    static boolean available(Context context, String id) {
        try (InputStream marker = context.getAssets().open(directory(id) + "/pack.json")) { return true; }
        catch (Exception unavailable) { return false; }
    }
    static String selected(Context context) {
        String saved = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(KEY, "");
        if (available(context, saved)) return saved;
        return available(context, "lori") ? "lori" : "original";
    }
    static String directory(Context context) { return directory(selected(context)); }
    static void select(Context context, String id) {
        if (!available(context, id)) throw new IllegalArgumentException("Voice pack unavailable");
        if (!context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(KEY, id).commit())
            throw new IllegalStateException("Could not save Home voice");
    }
}
