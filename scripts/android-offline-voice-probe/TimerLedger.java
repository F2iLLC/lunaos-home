package io.github.f2illc.lunaos.home.voiceprobe;

/** Pure timer identity/deadline policy. Elapsed time is valid for one boot only. */
final class TimerLedger {
    static final int LIMIT = 8;
    final long[] deadlines = new long[LIMIT + 1], revisions = new long[LIMIT + 1];
    long revision;
    int select(int target) {
        if (target > 0) return target <= LIMIT && deadlines[target] > 0 ? target : 0;
        int found = 0;
        for (int i = 1; i <= LIMIT; i++) if (deadlines[i] > 0) {
            if (found != 0) return -1;
            found = i;
        }
        return found;
    }
    int free() { for (int i = 1; i <= LIMIT; i++) if (deadlines[i] == 0) return i; return 0; }
    void set(int id, long deadline) { deadlines[id] = deadline; revisions[id] = ++revision; }
    boolean due(int id, long token, long now) {
        return id > 0 && id <= LIMIT && deadlines[id] > 0 && revisions[id] == token && now >= deadlines[id];
    }
    String encode(int boot) {
        StringBuilder out = new StringBuilder(boot + ":" + revision);
        for (int i = 1; i <= LIMIT; i++) out.append(':').append(deadlines[i]).append(',').append(revisions[i]);
        return out.toString();
    }
    static TimerLedger decode(String value, int boot) {
        TimerLedger ledger = new TimerLedger();
        if (boot < 0 || value == null) return ledger;
        try {
            String[] parts = value.split(":");
            if (parts.length != LIMIT + 2 || Integer.parseInt(parts[0]) != boot) return ledger;
            ledger.revision = Long.parseLong(parts[1]);
            if (ledger.revision < 0) return new TimerLedger();
            for (int i = 1; i <= LIMIT; i++) {
                String[] row = parts[i + 1].split(",");
                ledger.deadlines[i] = Long.parseLong(row[0]); ledger.revisions[i] = Long.parseLong(row[1]);
                if (row.length != 2 || ledger.deadlines[i] < 0 || ledger.revisions[i] < 0 || ledger.revisions[i] > ledger.revision) return new TimerLedger();
            }
            return ledger;
        } catch (RuntimeException malformed) { return new TimerLedger(); }
    }
}
