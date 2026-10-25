package io.github.f2illc.lunaos.directtlsprobe;

public final class VersionedEditStateProbe {
    private static void require(boolean condition) { if (!condition) throw new AssertionError(); }
    private static void denied(Runnable action) {
        try { action.run(); } catch (IllegalStateException expected) { return; }
        throw new AssertionError("Expected refusal");
    }
    public static void main(String[] ignored) {
        String old = "12345678-1234-4234-8234-123456789abc", fresh = "12345678-1234-4234-9234-123456789abc";
        VersionedEditState draft = new VersionedEditState();
        denied(() -> draft.begin());
        for (String bad : new String[]{"", "*", old.toUpperCase(), "12345678-1234-1234-8234-123456789abc"})
            denied(() -> draft.observed(bad));
        draft.observed(old); require(old.equals(draft.begin()));
        denied(() -> draft.begin()); denied(() -> draft.observed(fresh));
        draft.finished(false); // Definite conflict or success still needs another read.
        require(!draft.canEdit()); denied(() -> draft.begin());
        draft.observed(fresh); require(fresh.equals(draft.begin()));
        draft.finished(true); require(draft.unknown()); denied(() -> draft.begin());
        draft.clear(); require(draft.unknown()); denied(() -> draft.begin());
        draft.observed(fresh); require(!draft.unknown()); require(draft.canEdit());
        draft.begin(); draft.clear(); // End/background while save is in flight.
        require(draft.unknown()); denied(() -> draft.begin());
        VersionedEditState restarted = new VersionedEditState();
        denied(() -> restarted.begin()); require(!restarted.canEdit());
        restarted.observed(fresh); restarted.clear(); denied(() -> restarted.begin());
        System.out.println("PASS: conflicts, unknown receipts, interruption, restart and duplicate saves require explicit fresh readback");
    }
}
