package io.github.f2illc.lunaos.home.voiceprobe;

/** Pure timer identity/deadline policy. Elapsed time is valid for one boot only. */
final class TimerLedger {
    static final int LIMIT = 8;
    /** The deadline of a paused timer: active, never due, never counting. */
    static final long HELD = Long.MAX_VALUE / 2;
    final long[] deadlines = new long[LIMIT + 1], revisions = new long[LIMIT + 1];
    /** Milliseconds a paused timer still has to run; zero when it is not paused. */
    final long[] paused = new long[LIMIT + 1];
    long revision;
    boolean held(int id) { return paused[id] > 0; }
    boolean counting(int id, long now) { return deadlines[id] > now && !held(id); }
    /** The timer to pause (one that is counting) or to resume (one that is paused). */
    int select(int target, boolean wantHeld, long now) {
        int found = 0;
        for (int i = 1; i <= LIMIT; i++) if (wantHeld ? held(i) : counting(i, now)) {
            if (target == i) return i;
            if (target == 0 && found != 0) return -1;
            if (target == 0) found = i;
        }
        return found;
    }
    void pause(int id, long now) { paused[id] = Math.max(1, deadlines[id] - now); set(id, HELD); }
    void resume(int id, long now) { long left = paused[id]; set(id, now + left); }
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
    void set(int id, long deadline) { deadlines[id] = deadline; revisions[id] = ++revision; if (deadline != HELD) paused[id] = 0; }
    boolean due(int id, long token, long now) {
        return id > 0 && id <= LIMIT && deadlines[id] > 0 && revisions[id] == token && now >= deadlines[id];
    }
    String encode(int boot) {
        StringBuilder out = new StringBuilder(boot + ":" + revision);
        for (int i = 1; i <= LIMIT; i++) {
            out.append(':').append(deadlines[i]).append(',').append(revisions[i]);
            if (held(i)) out.append(',').append(paused[i]);
        }
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
                if (row.length == 3) ledger.paused[i] = Long.parseLong(row[2]);
                if (row.length < 2 || row.length > 3 || ledger.deadlines[i] < 0 || ledger.revisions[i] < 0 || ledger.revisions[i] > ledger.revision
                    || row.length == 3 && ledger.paused[i] <= 0 || ledger.held(i) != (ledger.deadlines[i] == HELD)) return new TimerLedger();
            }
            return ledger;
        } catch (RuntimeException malformed) { return new TimerLedger(); }
    }
}
