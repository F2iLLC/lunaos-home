package io.github.f2illc.lunaos.home.voiceprobe;

import java.util.ArrayList;
import java.util.List;

/** Maps only our fixed structured results to bundled generic prompts. */
final class ReplyPlan {
    // "Setting a timer for" + hours + minutes + seconds, then the timer's
    // number when it is not the only one that could be meant.
    private static String[] started(int id, int seconds) {
        List<String> clips = new ArrayList<>();
        clips.add("setting-timer");
        int hours = seconds / 3600, minutes = seconds % 3600 / 60, rest = seconds % 60;
        if (hours > 0) clips.add("hour-" + hours);
        if (minutes > 0) clips.add("minute-" + minutes);
        if (rest > 0) clips.add("second-" + rest);
        if (id > 1) clips.add("timer-" + id);
        return clips.toArray(new String[0]);
    }
    static String[] clips(String result) {
        // The silence is the confirmation.
        if (result.equals("Alarm stopped.")) return new String[0];
        for (int id = 1; id <= 8; id++) {
            String prefix = "Timer " + TimerPhrase.number(id);
            if (result.equals(prefix + " canceled.")) return new String[] {"cancel-" + id};
            if (result.equals(prefix + " paused.")) return new String[] {"timer-" + id, "paused"};
            if (result.equals(prefix + " resumed.")) return new String[] {"timer-" + id, "resumed"};
            String start = prefix + " started for ", end = " seconds.";
            if (result.startsWith(start) && result.endsWith(end)) {
                String amount = result.substring(start.length(), result.length() - end.length());
                if (amount.matches("[1-9][0-9]{0,4}") && Integer.parseInt(amount) <= 86400)
                    return started(id, Integer.parseInt(amount));
            }
            for (int n = 1; n <= 60; n++) for (int scale : new int[] {1, 60})
                if (result.equals(prefix + " extended by " + n * scale + " seconds."))
                    return new String[] {"timer-" + id, "extended-" + n + (scale == 60 ? "-minute" : "-second")};
        }
        if (result.startsWith("More than one timer is active.")) return new String[] {"ambiguous"};
        if (result.equals("Eight timers are already active. Cancel one first.")) return new String[] {"full"};
        if (result.equals("That timer is not active.")) return new String[] {"inactive"};
        if (result.equals("A timer cannot exceed twenty four hours. Nothing changed.")) return new String[] {"limit"};
        if (result.equals("Timer change failed or is uncertain. Check the timer list before retrying.")) return new String[] {"failed"};
        return new String[] {"unsupported"};
    }
}
