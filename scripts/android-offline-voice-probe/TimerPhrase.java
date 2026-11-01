package io.github.f2illc.lunaos.home.voiceprobe;

/** Deliberately narrow, complete-utterance parser. No transcript retention. */
public final class TimerPhrase {
    private TimerPhrase() {}
    static String number(int n) {
        String[] small = {"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
            "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"};
        String[] tens = {"", "", "twenty", "thirty", "forty", "fifty", "sixty"};
        return n < 20 ? small[n] : tens[n / 10] + (n % 10 == 0 ? "" : " " + small[n % 10]);
    }
    public static int seconds(String text) {
        if (text == null) return 0;
        for (int n = 1; n <= 60; n++) {
            String prefix = "hey luna set a timer for " + number(n);
            if (text.equals(prefix + (n == 1 ? " second" : " seconds"))) return n;
            if (text.equals(prefix + (n == 1 ? " minute" : " minutes"))) return n * 60;
        }
        return 0;
    }
    public static String grammar() {
        StringBuilder out = new StringBuilder("[\"[unk]\",\"hey luna\"");
        for (int n = 1; n <= 60; n++) {
            String prefix = ",\"hey luna set a timer for " + number(n);
            out.append(prefix).append(n == 1 ? " second\"" : " seconds\"");
            out.append(prefix).append(n == 1 ? " minute\"" : " minutes\"");
        }
        return out.append(']').toString();
    }
}
