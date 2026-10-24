package io.github.f2illc.lunaos.directtlsprobe;

/** In-memory, one-attempt draft. No automatic retry or persisted write queue. */
final class VersionedEditState {
    private String revision;
    private boolean saving, unknown;
    static boolean validRevision(String value) {
        return value != null && value.matches("[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}");
    }
    void observed(String value) {
        if (saving || !validRevision(value)) throw new IllegalStateException("Fresh revision required");
        revision = value; unknown = false;
    }
    boolean canEdit() { return revision != null && !saving && !unknown; }
    String begin() {
        if (!canEdit()) throw new IllegalStateException("Read before editing");
        String expected = revision; revision = null; saving = true; return expected;
    }
    void finished(boolean uncertain) {
        if (!saving) throw new IllegalStateException("No pending edit");
        saving = false; revision = null; unknown = uncertain;
    }
    void clear() { unknown |= saving; saving = false; revision = null; }
    boolean unknown() { return unknown; }
}
