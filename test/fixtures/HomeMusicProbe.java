package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.view.KeyEvent;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Runs the capture class Home really packages, the one that has speech recognized on the
 * enrolled Mac, against a scripted recognizer and a stand-in Android. Everything the Mac
 * "heard" here is synthetic. The stand-in clock moves only with captured audio, so nothing
 * here depends on how fast the machine runs.
 */
public final class HomeMusicProbe {
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
    /**
     * One listening session: what the Mac returns for each utterance, in order. When stopWhenQuiet
     * is set the owner stops listening three seconds of audio after the script has run dry;
     * otherwise the session runs until it ends by itself. Audio focus must have been taken
     * exactly `focus` times and given back exactly as often.
     */
    private static Result listen(boolean spotifyInstalled, boolean ringing, boolean stopWhenQuiet, int focus, String... heard) throws Exception {
        Context context = new Context();
        Context.reset();
        PackageManager.installed = spotifyInstalled;
        TimerAlarmService.ringing = ringing;
        QuestionReply.script(heard);
        AudioRecord.voiced = QuestionReply::pending;
        Result result = new Result();
        ProbeCapture capture = new ProbeCapture(context, true, true, true, false, new ProbeCapture.Listener() {
            @Override public void visual(LunaFace.State state) { }
            @Override public void status(String text) { }
            @Override public void finished(String code, String text, int seconds, long deadline, boolean canceled) {
                result.code = code; result.text = text; result.seconds = seconds; result.canceled = canceled;
                result.done.countDown();
            }
        });
        if (stopWhenQuiet) {
            int[] quiet = {0};
            AudioRecord.onRead = () -> { if (!QuestionReply.pending() && ++quiet[0] == 30) capture.stop(); };
        }
        check(capture.start(), "capture starts");
        check(result.done.await(60, TimeUnit.SECONDS), "capture finishes");
        for (int i = 0; i < 5000 && ProbeCapture.busy(); i++) Thread.sleep(1);
        check(!ProbeCapture.busy() && !ProbeCapture.recording(), "the worker and the microphone are released");
        check(result.canceled == stopWhenQuiet, stopWhenQuiet ? "stopped by its owner" : "ended by itself");
        check(AudioManager.focusRequests == focus, "audio focus taken " + focus + " time(s), was " + AudioManager.focusRequests);
        check(AudioManager.focusAbandons == focus, "audio focus given back " + focus + " time(s), was " + AudioManager.focusAbandons);
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
        QuestionReply.enabled = true;
        // After the wake phrase, a Mac-recognized music phrase becomes a music result and a key for Spotify.
        // Said on its own, the wake phrase leaves Luna awake as she starts to listen again, and only
        // then does she ask other media to go quiet. In one breath she is not yet known to be awake.
        String[][] spoken = {{"play music", "126"}, {"Pause the music.", "127"}, {"next song", "87"}, {"previous track", "88"}};
        int[] actions = {MusicCommand.PLAY, MusicCommand.PAUSE, MusicCommand.NEXT, MusicCommand.PREVIOUS};
        for (int i = 0; i < spoken.length; i++) {
            Result separate = listen(true, false, false, 1, "Hey Luna.", spoken[i][0]);
            check("MUSIC_COMMAND".equals(separate.code) && separate.seconds == actions[i], "music result: " + spoken[i][0]);
            check(separate.text.equals(MusicControl.plan(actions[i], true).status), "status says Spotify was asked: " + spoken[i][0]);
            sentTo(Integer.parseInt(spoken[i][1]), spoken[i][0]);
            Result oneBreath = listen(true, false, false, 0, "Hey Luna, " + spoken[i][0]);
            check("MUSIC_COMMAND".equals(oneBreath.code) && oneBreath.seconds == actions[i], "one breath: " + spoken[i][0]);
            sentTo(Integer.parseInt(spoken[i][1]), "one breath " + spoken[i][0]);
        }

        // Spotify missing: a music result that says so, and nothing sent anywhere.
        for (int i = 0; i < spoken.length; i++) {
            Result missing = listen(false, false, false, 1, "hey luna", spoken[i][0]);
            check("MUSIC_NOT_SENT".equals(missing.code) && missing.seconds == actions[i], "not sent: " + spoken[i][0]);
            check(missing.text.equals(MusicControl.plan(actions[i], false).status) && missing.text.contains("not installed"),
                "status says Spotify is missing: " + spoken[i][0]);
            nothingSent("Spotify missing, " + spoken[i][0]);
        }

        // Without the wake phrase a music phrase does nothing, however often it is said,
        // and a session that never wakes never takes audio focus.
        for (boolean ringing : new boolean[] {false, true}) {
            Result asleep = listen(true, ringing, true, 0, "play music", "pause the music", "skip", "previous song");
            check(!music(asleep), "no music result without the wake phrase");
            check(!MusicCommand.valid(asleep.seconds) && !TimerCommand.valid(asleep.seconds), "no action without the wake phrase");
            nothingSent("no wake phrase" + (ringing ? " while ringing" : ""));
            check(PackageManager.lookups == 0, "Spotify is not even looked for");
        }
        // While a timer rings only the stop words work without it, as before.
        Result alarm = listen(true, true, false, 0, "stop the music", "stop");
        check("COMMAND_MATCH".equals(alarm.code) && alarm.seconds == TimerCommand.STOP, "a ringing alarm is still stopped by voice");
        nothingSent("stopping an alarm");

        // Every other way out of an awake session gives audio focus back exactly once.
        Result expired = listen(true, false, false, 1, "hey luna");
        check("COMMAND_WINDOW_EXPIRED".equals(expired.code), "an unanswered wake times out");
        nothingSent("a timeout");
        Result stopped = listen(true, false, true, 1, "hey luna");
        check(!music(stopped), "stopping while awake is not a command");
        nothingSent("stopped while awake");
        Result unreachable = listen(true, false, false, 1, "hey luna", "!unavailable");
        check("HOST_UNAVAILABLE".equals(unreachable.code), "an unreachable Mac ends listening");
        nothingSent("an unreachable Mac");
        Result unreachableAsleep = listen(true, false, false, 0, "!unavailable");
        check("HOST_UNAVAILABLE".equals(unreachableAsleep.code), "an unreachable Mac before the wake phrase");

        // Timers and questions after the wake phrase are unaffected.
        Result timer = listen(true, false, false, 1, "hey luna", "set a timer for five seconds");
        check("COMMAND_MATCH".equals(timer.code) && timer.seconds == 5, "a timer is still a timer");
        nothingSent("a timer");
        Result pause = listen(true, false, false, 0, "hey luna pause");
        check("COMMAND_MATCH".equals(pause.code) && pause.seconds == TimerCommand.pause(0), "bare pause is still the timer's");
        nothingSent("bare pause");
        Result stop = listen(true, false, false, 1, "hey luna", "stop");
        check("COMMAND_MATCH".equals(stop.code) && stop.seconds == TimerCommand.STOP, "bare stop is still the timer's");
        nothingSent("bare stop");
        for (String asked : new String[] {"why is the sky blue", "play a song about dragons", "what is music", "the music",
            "next song on the practice list"}) {
            Result question = listen(true, false, false, 1, "hey luna", asked);
            check("QUESTION_FINAL".equals(question.code) && asked.equals(question.text), "still a question: " + asked);
            nothingSent("a question");
        }
        // Wording outside the list is never repaired into a music action or a timer.
        for (String refused : new String[] {"play music tomorrow", "don't play music", "stop the music in five minutes",
            "play music and set a timer for five minutes", "next song twice", "play song"}) {
            Result result = listen(true, false, false, 1, "hey luna", refused);
            check(!music(result) && !"COMMAND_MATCH".equals(result.code), "no music action and no timer: " + refused);
            nothingSent("refused " + refused);
        }
        // A music phrase or a listed fragment is never handed on as a question.
        for (String kept : new String[] {"play", "play the", "music", "skip the", "pause the"}) {
            Result result = listen(true, false, false, 1, "hey luna", kept);
            check(!music(result) && !"QUESTION_FINAL".equals(result.code) && !"COMMAND_MATCH".equals(result.code), "a fragment goes nowhere: " + kept);
            nothingSent("fragment " + kept);
        }

        System.out.println("Home music checks passed (" + checks + " cases).");
    }
}
