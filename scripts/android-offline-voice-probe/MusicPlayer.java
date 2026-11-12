package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.KeyEvent;

/**
 * The Android side of music by voice. It presses a media button for the Spotify
 * app on this device and nothing else: no Spotify account, token or network call
 * here, and no other app is ever addressed. MusicControl decides what is sent.
 */
final class MusicPlayer {
    private static AudioFocusRequest held;
    private MusicPlayer() {}

    /** Needs the Spotify entry under queries in the manifest; without it Spotify always looks missing. */
    static boolean installed(Context context) {
        try { return context.getPackageManager().getApplicationInfo(MusicControl.SPOTIFY, 0).enabled; }
        catch (Exception missing) { return false; }
    }
    /**
     * Sends the media key for one music action to Spotify, or sends nothing.
     * The returned status says which. A sent key is a request: Spotify does not
     * report back, so the status never claims that anything is playing.
     */
    static String send(Context context, int action) {
        MusicControl.Plan plan = MusicControl.plan(action, installed(context));
        if (!plan.sends()) {
            Log.i("HomeVoiceProbe", "MUSIC_COMMAND_NOT_SENT");
            return plan.status;
        }
        try {
            long now = SystemClock.uptimeMillis();
            for (int press : new int[] {KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP}) {
                // Addressed by package, so only Spotify can receive it.
                context.sendBroadcast(new Intent(Intent.ACTION_MEDIA_BUTTON).setPackage(plan.target)
                    .addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
                    .putExtra(Intent.EXTRA_KEY_EVENT, new KeyEvent(now, now, press, plan.key, 0)));
            }
            Log.i("HomeVoiceProbe", "MUSIC_COMMAND_SENT");
            return plan.status;
        } catch (RuntimeException failure) {
            Log.i("HomeVoiceProbe", "MUSIC_COMMAND_UNDELIVERED");
            return MusicControl.undelivered();
        }
    }
    /** Luna is awake for a command: ask other media to go quiet so the command can be heard. */
    static synchronized void hold(Context context) {
        if (held != null) return;
        try {
            AudioFocusRequest wanted = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setOnAudioFocusChangeListener(change -> { }, new Handler(Looper.getMainLooper())).build();
            AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (audio.requestAudioFocus(wanted) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) held = wanted;
        } catch (RuntimeException unavailable) {
            Log.i("HomeVoiceProbe", "AUDIO_FOCUS_UNAVAILABLE");
        }
    }
    /** Listening for the command has ended, however it ended. Safe to call when nothing is held. */
    static synchronized void release(Context context) {
        if (held == null) return;
        try { ((AudioManager) context.getSystemService(Context.AUDIO_SERVICE)).abandonAudioFocusRequest(held); }
        catch (RuntimeException ignored) { }
        finally { held = null; }
    }
}
