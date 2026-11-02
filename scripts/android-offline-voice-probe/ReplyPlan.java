package io.github.f2illc.lunaos.home.voiceprobe;

/** Maps only our fixed structured results to bundled generic prompts. */
final class ReplyPlan {
    static String[] clips(String result) {
        for (int id = 1; id <= 8; id++) {
            String prefix = "Timer " + TimerPhrase.number(id);
            if (result.equals(prefix + " canceled.")) return new String[] {"timer-" + id, "canceled"};
            for (String action : new String[] {" started for ", " extended by "}) {
                for (int n = 1; n <= 60; n++) for (int scale : new int[] {1, 60})
                    if (result.equals(prefix + action + n * scale + " seconds."))
                        return new String[] {"timer-" + id, action.startsWith(" started") ? "started" : "extended", "number-" + n,
                            scale == 60 ? n == 1 ? "minute" : "minutes" : n == 1 ? "second" : "seconds"};
            }
        }
        if (result.startsWith("More than one timer is active.")) return new String[] {"ambiguous"};
        if (result.equals("Eight timers are already active. Cancel one first.")) return new String[] {"full"};
        if (result.equals("That timer is not active.")) return new String[] {"inactive"};
        if (result.equals("A timer cannot exceed twenty four hours. Nothing changed.")) return new String[] {"limit"};
        if (result.equals("Timer change failed or is uncertain. Check the timer list before retrying.")) return new String[] {"failed"};
        return new String[] {"unsupported"};
    }
}
