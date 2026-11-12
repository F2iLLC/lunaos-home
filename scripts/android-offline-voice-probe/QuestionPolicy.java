package io.github.f2illc.lunaos.home.voiceprobe;

/** Questions cannot repair or reinterpret incomplete timer commands. */
public final class QuestionPolicy {
    static String sessionId = java.util.UUID.randomUUID().toString();
    private static String notebookAnimation = "";
    private static long notebookUntil;
    static String notebookListId = "";
    static long notebookEvent;
    static String lastHeard = "";
    static String replyCaption = "";
    static boolean replyWantsFollowUp, isFollowUp;
    static boolean takeFollowUp() { boolean next = replyWantsFollowUp; replyWantsFollowUp = false; return next; }
    static String decodeCaption(String encoded) {
        if (encoded == null || encoded.length() > 2048) return "";
        try {
            String text = new String(java.util.Base64.getDecoder().decode(encoded), java.nio.charset.StandardCharsets.UTF_8);
            return text.length() <= 360 ? text : "";
        } catch (IllegalArgumentException invalid) { return ""; }
    }
    static void resetConversation() {
        sessionId = java.util.UUID.randomUUID().toString();
        notebookListId = ""; notebookEvent++; lastHeard = ""; replyCaption = ""; replyWantsFollowUp = false; isFollowUp = false;
        notebookAnimation = ""; notebookUntil = 0;
    }
    static void notebookFeedback(String animation, String listId) {
        notebookFeedback(animation);
        if (!notebookAnimation.isEmpty() && listId != null && listId.matches("[A-Za-z0-9_-]{1,80}")) notebookListId = listId;
    }
    static void notebookFeedback(String animation) {
        notebookListId = ""; notebookEvent++;
        notebookAnimation = ""; notebookUntil = 0;
        if (animation == null || !animation.matches("new-page|scribble|read|checkmark|cross-out|erase-rewrite|hover|puzzled")) return;
        notebookAnimation = animation; notebookUntil = System.currentTimeMillis() + 8000;
    }
    static String notebookAnimation() {
        return System.currentTimeMillis() < notebookUntil ? notebookAnimation : "";
    }
    private static String normalized(String text) {
        return text.toLowerCase(java.util.Locale.ROOT).trim().replaceAll("[.,!?]+$", "")
            .replaceAll("\\s+", " ").replaceFirst("^hey luna[, ]+", "");
    }
    static boolean timerAttempt(String text) {
        if (text == null) return false;
        String bare = normalized(text);
        if (bare.matches("(?:start|set up) (?:a |my |the )?.*list")) return false;
        return bare.matches("(?s).*\\b(timer|timers|alarm|alarms)\\b.*")
            || bare.matches("add(?: .*)?\\b(seconds?|minutes?|hours?)\\b.*")
            || bare.equals("add") || bare.matches("cancel(?: .*)?")
            || bare.matches("(?:set|start|stop|pause|resume|okay stop|luna stop|turn it off|shut it off)(?: .*)?")
            || bare.matches("(?:[0-9]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty)(?: [a-z]+)? (?:seconds?|minutes?|hours?)(?: please)?");
    }
    // Music is done on this device or not at all. A music phrase, a fragment of one, or a refused
    // one is never sent on as a question. A question that only mentions music still is.
    static boolean musicAttempt(String text) {
        if (text == null) return false;
        String bare = normalized(text);
        if (bare.endsWith(" please")) bare = bare.substring(0, bare.length() - 7).trim();
        return bare.matches("(?:play|skip|unpause|next|previous)(?: (?:the|this|that|some|my|a))?")
            || bare.matches("(?:the |some |my )?(?:music|spotify)")
            || bare.matches("(?:don't |do not )?(?:play|skip|unpause|pause|stop|resume)\\b.*\\b(?:music|songs?|tracks?|spotify)\\b.*")
            || bare.matches("(?:next|previous|last) (?:song|track)\\b.*")
            || bare.matches("go back\\b.*\\b(?:songs?|tracks?)\\b.*")
            || bare.matches("turn (?:off |on )?the music\\b.*");
    }
    public static boolean accepts(String text) {
        if (text == null || text.trim().isEmpty() || text.length() > 1000) return false;
        for (int i = 0; i < text.length(); i++) if (Character.isISOControl(text.charAt(i))) return false;
        String bare = normalized(text);
        return !bare.isEmpty() && !bare.equals("hey luna") && !bare.contains("[unk]") && !timerAttempt(text) && !musicAttempt(text);
    }
}
