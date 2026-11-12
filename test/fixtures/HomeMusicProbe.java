package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.view.KeyEvent;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Runs the capture class Home really packages, the one that has speech recognized on the
 * enrolled Mac, against a scripted recognizer and a stand-in Android. Everything the Mac
 * "heard" here is synthetic.
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
    /** One listening session: what the Mac returns for each utterance, in order. */
    private static Result listen(boolean spotifyInstalled, boolean ringing, String... heard) throws Exception {
        Context context = new Context();
        Context.reset();
        PackageManager.installed = spotifyInstalled;
        TimerAlarmService.ringing = ringing;
        QuestionReply.script(heard);
        Result result = new Result();
        ProbeCapture capture = new ProbeCapture(context, true, true, true, false, new ProbeCapture.Listener() {
            @Override public void visual(LunaFace.State state) { }
            @Override public void status(String text) { }
            @Override public void finished(String code, String text, int seconds, long deadline, boolean canceled) {
                result.code = code; result.text = text; result.seconds = seconds; result.canceled = canceled;
                result.done.countDown();
            }
        });
        check(capture.start(), "capture starts");
        // A session that never wakes keeps listening. Once the script has run dry, stop it as the owner would.
        long limit = System.currentTimeMillis() + 20000;
        while (result.done.getCount() > 0 && QuestionReply.unscripted() < 2 && System.currentTimeMillis() < limit) Thread.sleep(2);
        if (result.done.getCount() > 0) capture.stop();
        check(result.done.await(20, TimeUnit.SECONDS), "capture finishes");
        for (int i = 0; i < 2000 && ProbeCapture.busy(); i++) Thread.sleep(1);
        check(!ProbeCapture.busy(), "the worker is released");
        check(AudioManager.focusAbandons >= AudioManager.focusRequests, "audio focus is never left held");
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

    public static void main(String[] args) throws Exception {
        // After the wake phrase, a Mac-recognized music phrase becomes a music result and a key for Spotify.
        String[][] spoken = {{"play music", "126"}, {"Pause the music.", "127"}, {"next song", "87"}, {"previous track", "88"}};
        int[] actions = {MusicCommand.PLAY, MusicCommand.PAUSE, MusicCommand.NEXT, MusicCommand.PREVIOUS};
        for (int i = 0; i < spoken.length; i++) {
            Result separate = listen(true, false, "Hey Luna.", spoken[i][0]);
            check("MUSIC_COMMAND".equals(separate.code) && separate.seconds == actions[i] && !separate.canceled, "music result: " + spoken[i][0]);
            check(separate.text.equals(MusicControl.plan(actions[i], true).status), "status says Spotify was asked: " + spoken[i][0]);
            sentTo(Integer.parseInt(spoken[i][1]), spoken[i][0]);
            Result oneBreath = listen(true, false, "Hey Luna, " + spoken[i][0]);
            check("MUSIC_COMMAND".equals(oneBreath.code) && oneBreath.seconds == actions[i], "one breath: " + spoken[i][0]);
            sentTo(Integer.parseInt(spoken[i][1]), "one breath " + spoken[i][0]);
        }

        // Spotify missing: a music result that says so, and nothing sent anywhere.
        for (int i = 0; i < spoken.length; i++) {
            Result missing = listen(false, false, "hey luna", spoken[i][0]);
            check("MUSIC_NOT_SENT".equals(missing.code) && missing.seconds == actions[i], "not sent: " + spoken[i][0]);
            check(missing.text.equals(MusicControl.plan(actions[i], false).status) && missing.text.contains("not installed"),
                "status says Spotify is missing: " + spoken[i][0]);
            nothingSent("Spotify missing, " + spoken[i][0]);
        }

        // Without the wake phrase a music phrase does nothing, however often it is said.
        for (boolean ringing : new boolean[] {false, true}) {
            Result asleep = listen(true, ringing, "play music", "pause the music", "skip", "previous song");
            check(asleep.canceled && !String.valueOf(asleep.code).startsWith("MUSIC"), "no music result without the wake phrase");
            check(!MusicCommand.valid(asleep.seconds) && !TimerCommand.valid(asleep.seconds), "no action without the wake phrase");
            nothingSent("no wake phrase" + (ringing ? " while ringing" : ""));
            check(PackageManager.lookups == 0, "Spotify is not even looked for");
        }
        // While a timer rings only the stop words work without it, as before.
        Result alarm = listen(true, true, "stop the music", "stop");
        check("COMMAND_MATCH".equals(alarm.code) && alarm.seconds == TimerCommand.STOP, "a ringing alarm is still stopped by voice");
        nothingSent("stopping an alarm");

        // Timers, questions and refusals after the wake phrase are unaffected.
        Result timer = listen(true, false, "hey luna", "set a timer for five seconds");
        check("COMMAND_MATCH".equals(timer.code) && timer.seconds == 5, "a timer is still a timer");
        nothingSent("a timer");
        Result pause = listen(true, false, "hey luna pause");
        check("COMMAND_MATCH".equals(pause.code) && pause.seconds == TimerCommand.pause(0), "bare pause is still the timer's");
        nothingSent("bare pause");
        Result stop = listen(true, false, "hey luna", "stop");
        check("COMMAND_MATCH".equals(stop.code) && stop.seconds == TimerCommand.STOP, "bare stop is still the timer's");
        nothingSent("bare stop");
        Result question = listen(true, false, "hey luna", "why is the sky blue");
        check("QUESTION_FINAL".equals(question.code) && "why is the sky blue".equals(question.text), "a question is still a question");
        nothingSent("a question");
        for (String refused : new String[] {"play music tomorrow", "don't play music", "next song twice", "play song", "play"}) {
            Result result = listen(true, false, "hey luna", refused);
            check(!String.valueOf(result.code).startsWith("MUSIC") && !"QUESTION_FINAL".equals(result.code)
                && !"COMMAND_MATCH".equals(result.code), "refused, and not passed on: " + refused);
            nothingSent("refused " + refused);
        }

        System.out.println("Home music checks passed (" + checks + " cases).");
    }
}
