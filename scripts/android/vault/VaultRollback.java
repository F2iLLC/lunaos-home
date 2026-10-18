package io.github.f2illc.lunaos.home.preview;

import java.io.IOException;

/** Resolves whether a failed, pre-commit write was safely rolled back. */
final class VaultRollback {
    interface RollbackAction { void run() throws Exception; }
    interface RestorationCheck { boolean restored() throws Exception; }

    private VaultRollback() { }

    static Exception resolve(Exception original, RollbackAction rollback, RestorationCheck check) {
        Exception rollbackFailure = null;
        try { rollback.run(); }
        catch (Exception failure) { rollbackFailure = failure; }

        Exception verificationFailure = null;
        boolean restored = false;
        try { restored = check.restored(); }
        catch (Exception failure) { verificationFailure = failure; }

        if (restored) {
            if (rollbackFailure != null) original.addSuppressed(rollbackFailure);
            return original;
        }

        IOException unknown = new IOException("Write outcome unknown", original);
        if (rollbackFailure != null) unknown.addSuppressed(rollbackFailure);
        if (verificationFailure != null) unknown.addSuppressed(verificationFailure);
        return unknown;
    }
}
