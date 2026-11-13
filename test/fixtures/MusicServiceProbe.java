package io.github.f2illc.lunaos.home.voiceprobe;

import android.content.Intent;
import android.os.Handler;

/**
 * Runs the real wake service, as Home packages it, with a capture that ends in the result
 * codes the capture classes really produce for a music phrase.
 */
public final class MusicServiceProbe {
    private static int checks;
    private static void check(boolean value, String label) {
        checks++;
        if (!value) throw new AssertionError(label);
    }
    private static BackgroundWakeService enable() {
        ProbeCapture.blocked = false; ProbeCapture.busy = false;
        BackgroundWakeService service = new BackgroundWakeService();
        service.onStartCommand(new Intent(service, BackgroundWakeService.class).setAction(BackgroundWakeService.START), 0, 1);
        Handler.advance(0);
        check(BackgroundWakeService.running && service.foreground && ProbeCapture.busy(), "listening is enabled");
        return service;
    }
    private static void disable(BackgroundWakeService service) {
        service.onStartCommand(new Intent(service, BackgroundWakeService.class).setAction(BackgroundWakeService.STOP), 0, 2);
        service.onDestroy(); ProbeCapture.busy = false;
    }
    private static boolean noTimers(BackgroundWakeService service) {
        TimerLedger ledger = NativeTimers.read(service);
        for (int id = 1; id <= TimerLedger.LIMIT; id++) if (ledger.deadlines[id] != 0) return false;
        return true;
    }
    /** Listening is still on, nothing was spoken, asked or timed, and the decoder's wake lock is let go. */
    private static void stillListening(BackgroundWakeService service, SpokenReply spoken, QuestionReply asked, String label) {
        check(BackgroundWakeService.running && service.foreground && !service.stopped, label + ": listening is still enabled");
        check(!service.power.last.isHeld(), label + ": the wake lock is released");
        check(noTimers(service) && service.alarms.schedules == 0, label + ": no timer is created");
        check(SpokenReply.last == spoken && QuestionReply.last == asked, label + ": nothing is spoken or asked");
        check(service.alarmStarts == 0, label + ": nothing is started");
    }

    public static void main(String[] args) {
        String asked = "Asked Spotify to play.";
        String missing = "Spotify is not installed on this device. Nothing was sent.";
        String suffix = " Wake-word listening remains enabled.";

        // Spotify was asked: say so, and listen again a quarter of a second later.
        BackgroundWakeService service = enable();
        SpokenReply spoken = SpokenReply.last; QuestionReply question = QuestionReply.last;
        ProbeCapture first = ProbeCapture.last;
        int starts = ProbeCapture.starts;
        first.finish("MUSIC_COMMAND", asked, -51, false);
        stillListening(service, spoken, question, "sent");
        check(BackgroundWakeService.latest.equals(asked + suffix), "sent: the status says Spotify was asked");
        check(BackgroundWakeService.visual == LunaFace.State.RESPONSE, "sent: the response face");
        check(QuestionPolicy.replyCaption.isEmpty(), "sent: no caption is needed");
        Handler.advance(249);
        check(ProbeCapture.starts == starts && !ProbeCapture.busy(), "sent: not listening again before 250 ms");
        Handler.advance(1);
        check(ProbeCapture.starts == starts + 1 && ProbeCapture.busy() && ProbeCapture.last != first, "sent: listening is re-armed");
        check(!ProbeCapture.last.followUp, "sent: back to waiting for the wake phrase");

        // Nothing was sent: the reason stays up long enough to read, in the status and as a caption
        // on the Home screen, with the retry face, and listening re-arms after two and a half seconds.
        for (int round = 0; round < 2; round++) {
            ProbeCapture current = ProbeCapture.last;
            starts = ProbeCapture.starts;
            current.finish("MUSIC_NOT_SENT", missing, -51, false);
            stillListening(service, spoken, question, "not sent");
            check(BackgroundWakeService.latest.equals(missing + suffix), "not sent: the status says why");
            check(BackgroundWakeService.visual == LunaFace.State.RETRY, "not sent: the retry face");
            check(QuestionPolicy.replyCaption.equals(missing), "not sent: the caption Home shows says why");
            Handler.advance(2499);
            check(ProbeCapture.starts == starts && !ProbeCapture.busy(), "not sent: the status is left up for 2500 ms");
            check(BackgroundWakeService.latest.equals(missing + suffix) && QuestionPolicy.replyCaption.equals(missing), "not sent: still showing");
            Handler.advance(1);
            check(ProbeCapture.starts == starts + 1 && ProbeCapture.busy(), "not sent: listening is re-armed");
            check(QuestionPolicy.replyCaption.equals(missing), "not sent: the caption outlasts the re-arm");
            // Waiting for the wake phrase leaves it up. The next thing Luna hears takes it down, so a
            // second failure with the same words shows again.
            ProbeCapture.last.listener.visual(LunaFace.State.WAITING);
            check(QuestionPolicy.replyCaption.equals(missing), "not sent: waiting leaves the caption");
            ProbeCapture.last.listener.visual(round == 0 ? LunaFace.State.AWAKE : LunaFace.State.REVIEW);
            check(QuestionPolicy.replyCaption.isEmpty(), "not sent: cleared when Luna next hears something");
        }
        // Only its own notice is cleared: a reply caption is left for Home to time out.
        QuestionPolicy.replyCaption = "Timer one. Five minutes.";
        ProbeCapture.last.listener.visual(LunaFace.State.AWAKE);
        ProbeCapture.last.listener.visual(LunaFace.State.REVIEW);
        check(QuestionPolicy.replyCaption.equals("Timer one. Five minutes."), "a reply caption is not touched");
        QuestionPolicy.replyCaption = "";

        // A music result after listening was disabled does nothing.
        ProbeCapture stale = ProbeCapture.last;
        starts = ProbeCapture.starts;
        disable(service);
        String off = BackgroundWakeService.latest;
        stale.finish("MUSIC_NOT_SENT", missing, -51, false);
        stale.finish("MUSIC_COMMAND", asked, -51, false);
        Handler.advance(5000);
        check(!BackgroundWakeService.running && ProbeCapture.starts == starts, "disabled: no re-arm");
        check(BackgroundWakeService.latest.equals(off) && QuestionPolicy.replyCaption.isEmpty(), "disabled: nothing shown");

        // Timers still work in the same service, and a code it does not know still ends listening.
        service = enable();
        ProbeCapture.last.finish("COMMAND_MATCH", "COMMAND_MATCH", 60, false);
        check(!noTimers(service) && BackgroundWakeService.running, "a timer command still creates a timer");
        disable(service);
        service = enable();
        starts = ProbeCapture.starts;
        ProbeCapture.last.finish("MUSIC_SOMETHING_ELSE", asked, -51, false);
        Handler.advance(5000);
        check(!BackgroundWakeService.running && ProbeCapture.starts == starts, "an unknown result code ends listening");
        check(QuestionPolicy.replyCaption.isEmpty(), "an unknown result code shows no caption");
        service.onDestroy();
        service = enable();
        starts = ProbeCapture.starts;
        ProbeCapture.last.finish("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED", 0, false);
        Handler.advance(5000);
        check(!BackgroundWakeService.running && ProbeCapture.starts == starts, "a failed capture ends listening");
        service.onDestroy();

        System.out.println("Music service checks passed (" + checks + " cases).");
    }
}
