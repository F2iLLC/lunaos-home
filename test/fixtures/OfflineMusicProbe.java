package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.view.KeyEvent;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.vosk.Recognizer;

/**
 * Runs the offline voice test app's real capture class, the one with the fixed-phrase
 * recognizer on the device, against a scripted speech library and a stand-in Android.
 * What the recognizers "hear" is synthetic. The stand-in clock moves only with captured audio.
 */
public final class OfflineMusicProbe {
    private static int checks;
    private static void check(boolean value, String label) {
        checks++;
        if (!value) throw new AssertionError(label);
    }
    private static final class Result {
        final CountDownLatch done = new CountDownLatch(1);
        volatile String code, text;
        volatile int seconds;
        volatile boolean canceled;
    }
    private static final String[] NONE = {};
    private static boolean ringing, questions, installed = true;
    /**
     * One listening session. `fixed` is what the fixed-phrase recognizer hears, in order; `free`
     * is what the free-form recognizer returns if the captured command is decoded again. With
     * stopWhenQuiet the owner stops listening three seconds of audio after the script runs dry.
     * Audio focus must have been taken exactly `focus` times and given back exactly as often.
     */
    private static Result listen(boolean persistent, boolean stopWhenQuiet, int focus, String[] fixed, String[] free) throws Exception {
        Context context = new Context();
        Context.reset();
        AudioRecord.paced = true;
        PackageManager.installed = installed;
        TimerAlarmService.ringing = ringing;
        QuestionReply.enabled = questions;
        Recognizer.script(fixed, free);
        Recognizer.recording = ProbeCapture::recording;
        Recognizer.grammars.clear();
        Result result = new Result();
        ProbeCapture.Listener listener = new ProbeCapture.Listener() {
            @Override public void visual(LunaFace.State state) { }
            @Override public void status(String text) { }
            @Override public void finished(String code, String text, int seconds, long deadline, boolean canceled) {
                result.code = code; result.text = text; result.seconds = seconds; result.canceled = canceled;
                result.done.countDown();
            }
        };
        // The wake service asks for persistent listening; the foreground test screen does not.
        ProbeCapture capture = persistent ? new ProbeCapture(context, true, true, true, false, listener)
            : new ProbeCapture(context, true, true, listener);
        if (stopWhenQuiet) {
            int[] quiet = {0};
            AudioRecord.onRead = () -> { if (Recognizer.phrases.isEmpty() && ++quiet[0] == 30) capture.stop(); };
        }
        check(capture.start(), "capture starts");
        check(result.done.await(60, TimeUnit.SECONDS), "capture finishes");
        for (int i = 0; i < 5000 && ProbeCapture.busy(); i++) Thread.sleep(1);
        check(!ProbeCapture.busy() && !ProbeCapture.recording(), "the worker and the microphone are released");
        check(result.canceled == stopWhenQuiet, stopWhenQuiet ? "stopped by its owner" : "ended by itself: " + result.code);
        check(AudioManager.focusRequests == focus, "audio focus taken " + focus + " time(s), was " + AudioManager.focusRequests);
        check(AudioManager.focusAbandons == focus, "audio focus given back " + focus + " time(s), was " + AudioManager.focusAbandons);
        for (String grammar : Recognizer.grammars) {
            check(grammar.startsWith("[\"[unk]\",\"hey luna\","), "one phrase list led by the wake phrase");
            check(grammar.contains("\"play music\"") == persistent && grammar.contains("\"previous track\"") == persistent,
                persistent ? "wake listening knows the music phrases" : "the foreground test keeps the timer-only list");
            check(grammar.contains("\"set a timer for ten seconds\""), "timer phrases are in the list");
        }
        return result;
    }
    private static void sentTo(int key, String label) {
        check(Context.broadcasts.size() == 2, label + ": one key press, down and up");
        int[] presses = {KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP};
        for (int i = 0; i < 2; i++) {
            Intent intent = Context.broadcasts.get(i);
            check(Intent.ACTION_MEDIA_BUTTON.equals(intent.action), label + ": a media button");
            check("com.spotify.music".equals(intent.target), label + ": addressed to Spotify only");
            KeyEvent event = (KeyEvent) intent.extras.get(Intent.EXTRA_KEY_EVENT);
            check(event != null && event.getKeyCode() == key && event.getAction() == presses[i], label + ": the right key");
        }
        check(Context.launches == 0, label + ": nothing is launched");
    }
    private static void nothingSent(String label) {
        check(Context.broadcasts.isEmpty() && Context.launches == 0, label + ": nothing is sent to any app");
    }
    private static boolean music(Result result) { return String.valueOf(result.code).startsWith("MUSIC"); }

    public static void main(String[] args) throws Exception {
        java.io.File files = java.nio.file.Files.createTempDirectory("offline-music-probe").toFile();
        check(new java.io.File(files, "model").mkdir() && new java.io.File(files, "model-ready").createNewFile(), "synthetic model marker");
        Context.files = files;
        try {
            run();
        } finally {
            new java.io.File(files, "model-ready").delete(); new java.io.File(files, "model").delete(); files.delete();
        }
        System.out.println("Offline music checks passed (" + checks + " cases).");
    }
    private static void run() throws Exception {
        // Wake listening: after the wake phrase, a music phrase from the one fixed-phrase
        // recognizer becomes a music result and a key for Spotify.
        String[][] spoken = {{"play music", "126"}, {"pause the music", "127"}, {"next song", "87"}, {"previous track", "88"}};
        int[] actions = {MusicCommand.PLAY, MusicCommand.PAUSE, MusicCommand.NEXT, MusicCommand.PREVIOUS};
        for (int i = 0; i < spoken.length; i++) {
            Result sent = listen(true, false, 1, new String[] {"hey luna", spoken[i][0]}, NONE);
            if (i == 0) check(Recognizer.grammars.size() == 1, "one fixed-phrase recognizer is built");
            else check(Recognizer.grammars.isEmpty(), "and it is kept, not built again");
            check("MUSIC_COMMAND".equals(sent.code) && sent.seconds == actions[i], "music result: " + spoken[i][0]);
            check(sent.text.equals(MusicControl.plan(actions[i], true).status), "status says Spotify was asked: " + spoken[i][0]);
            sentTo(Integer.parseInt(spoken[i][1]), spoken[i][0]);
            check(Recognizer.abandonsAtDecode == -1, "a fixed phrase needs no second decode");
        }
        installed = false;
        for (int i = 0; i < spoken.length; i++) {
            Result missing = listen(true, false, 1, new String[] {"hey luna", spoken[i][0]}, NONE);
            check("MUSIC_NOT_SENT".equals(missing.code) && missing.seconds == actions[i], "not sent: " + spoken[i][0]);
            check(missing.text.equals(MusicControl.plan(actions[i], false).status), "status says Spotify is missing: " + spoken[i][0]);
            nothingSent("Spotify missing, " + spoken[i][0]);
        }
        installed = true;

        // Without the wake phrase nothing happens, and a session that never wakes never takes focus.
        for (boolean alarm : new boolean[] {false, true}) {
            ringing = alarm;
            Result asleep = listen(true, true, 0, new String[] {"play music", "pause the music", "skip", "previous song"}, NONE);
            check(!music(asleep) && !MusicCommand.valid(asleep.seconds) && !TimerCommand.valid(asleep.seconds), "nothing without the wake phrase");
            nothingSent("no wake phrase" + (alarm ? " while ringing" : ""));
            check(PackageManager.lookups == 0, "Spotify is not even looked for");
        }
        Result alarm = listen(true, false, 0, new String[] {"stop the music", "stop"}, NONE);
        check("COMMAND_MATCH".equals(alarm.code) && alarm.seconds == TimerCommand.STOP, "a ringing alarm is still stopped by voice");
        nothingSent("stopping an alarm");
        ringing = false;

        // Timers are unaffected, and every way out of an awake session gives focus back exactly once.
        Result timer = listen(true, false, 1, new String[] {"hey luna", "set a timer for five seconds"}, NONE);
        check("COMMAND_MATCH".equals(timer.code) && timer.seconds == 5, "a timer is still a timer");
        nothingSent("a timer");
        Result pause = listen(true, false, 1, new String[] {"hey luna", "pause"}, NONE);
        check("COMMAND_MATCH".equals(pause.code) && pause.seconds == TimerCommand.pause(0), "bare pause is still the timer's");
        nothingSent("bare pause");
        Result expired = listen(true, false, 1, new String[] {"hey luna"}, NONE);
        check("COMMAND_WINDOW_EXPIRED".equals(expired.code), "an unanswered wake times out");
        nothingSent("a timeout");
        Result refused = listen(true, false, 1, new String[] {"hey luna", "play song", "next song twice"}, NONE);
        check("COMMAND_WINDOW_EXPIRED".equals(refused.code), "wording outside the list is not acted on");
        nothingSent("refused wording");
        Result stopped = listen(true, true, 1, new String[] {"hey luna"}, NONE);
        check(!music(stopped), "stopping while awake is not a command");
        nothingSent("stopped while awake");

        // With online answers on, speech the fixed phrases did not match is decoded once more,
        // free-form, after the microphone stops. Focus is given back when the microphone stops,
        // not held through that decode. A music phrase found there is still acted on locally.
        questions = true;
        Result decoded = listen(true, false, 1, new String[] {"hey luna", "[unk]"}, new String[] {"play music"});
        check("MUSIC_COMMAND".equals(decoded.code) && decoded.seconds == MusicCommand.PLAY, "music found by the second decode");
        sentTo(126, "second decode");
        check(Recognizer.abandonsAtDecode == 1 && !Recognizer.recordingAtDecode, "focus is given back when the microphone stops, before decoding");
        Result question = listen(true, false, 1, new String[] {"hey luna", "[unk]"}, new String[] {"why is the sky blue"});
        check("QUESTION_FINAL".equals(question.code) && "why is the sky blue".equals(question.text), "a question is still a question");
        check(Recognizer.abandonsAtDecode == 1 && !Recognizer.recordingAtDecode, "focus is not held while a question is decoded");
        nothingSent("a question");
        Result fragment = listen(true, false, 1, new String[] {"hey luna", "[unk]"}, new String[] {"play the"});
        check(!music(fragment) && !"QUESTION_FINAL".equals(fragment.code) && !"COMMAND_MATCH".equals(fragment.code), "a fragment goes nowhere");
        nothingSent("a fragment");
        Result direct = listen(true, false, 1, new String[] {"hey luna", "skip"}, new String[] {"why is the sky blue"});
        check("MUSIC_COMMAND".equals(direct.code) && direct.seconds == MusicCommand.NEXT, "with answers on, a fixed music phrase is still music");
        check(Recognizer.abandonsAtDecode == -1, "and is never decoded a second time or asked");
        sentTo(87, "answers on");
        questions = false;

        // The foreground test screen is as it was: timer phrases only, no music, no audio focus.
        Result foreground = listen(false, false, 0, new String[] {"hey luna", "play music"}, NONE);
        check(!music(foreground) && "COMMAND_WINDOW_EXPIRED".equals(foreground.code), "the foreground test does not act on music");
        check(Recognizer.grammars.size() == 1, "it builds its own timer-only recognizer");
        nothingSent("foreground test");
        check(PackageManager.lookups == 0, "foreground test does not look for Spotify");
        Result foregroundTimer = listen(false, false, 0, new String[] {"hey luna", "set a timer for five seconds"}, NONE);
        check("COMMAND_MATCH".equals(foregroundTimer.code) && foregroundTimer.seconds == 5, "the foreground test still hears timers");

        // An engine failure after waking still gives focus back.
        Result failed = listen(true, false, 1, new String[] {"hey luna", "!fail"}, NONE);
        check(String.valueOf(failed.code).endsWith("_FAILED"), "an engine failure ends the session");
        nothingSent("engine failure");
    }
}
