package io.github.f2illc.lunaos.home.preview;

import java.util.HashSet;
import java.util.Set;
import java.util.function.LongSupplier;
import java.util.function.BooleanSupplier;

public final class VaultService {
    public enum Member { ALEX, SAM }
    public enum Mode { READ_ONLY, SETUP }
    public enum Action { READ, SAVE, DELETE }
    public enum Result { APPLIED, APPLIED_ENDED, UNKNOWN }
    public interface Store {
        int read(Member member) throws Exception;
        void write(Member member, int variant, Runnable beforeCommit) throws Exception;
    }
    public static final class Grant {
        final Member member;
        final Mode mode;
        final long expires;
        final Set<Long> used = new HashSet<>();
        Grant(Member member, Mode mode, long expires) {
            this.member = member; this.mode = mode; this.expires = expires;
        }
    }
    private final Store store;
    private final LongSupplier clock;
    private final BooleanSupplier available;
    private final Object work = new Object();
    private Grant active;
    private long lastTime;
    private boolean uncertain;
    public VaultService(Store store, LongSupplier clock) { this(store, clock, () -> true); }
    public VaultService(Store store, LongSupplier clock, BooleanSupplier available) {
        this.store = store; this.clock = clock; this.available = available;
    }
    private long now() {
        long value = clock.getAsLong();
        if (value < lastTime) { active = null; throw new SecurityException("Clock changed"); }
        lastTime = value;
        return value;
    }
    public synchronized Grant approve(Member member, Mode mode) {
        if (!available.getAsBoolean()) { active = null; throw new SecurityException("Device locked"); }
        if (uncertain || member == null || mode == null) throw new SecurityException("Closed");
        active = new Grant(member, mode, now() + 60_000);
        return active;
    }
    public synchronized void end() { active = null; }
    public synchronized void check(Grant grant, Member member, Action action) {
        if (!available.getAsBoolean()) { active = null; throw new SecurityException("Device locked"); }
        if (grant == null || action == null || grant != active || now() >= grant.expires || grant.member != member ||
            action == Action.DELETE || (action == Action.SAVE && grant.mode != Mode.SETUP))
            throw new SecurityException("Access closed or outside scope");
    }
    public int read(Grant grant, Member member) throws Exception {
        synchronized (work) {
            check(grant, member, Action.READ);
            int value = store.read(member);
            synchronized (this) { check(grant, member, Action.READ); return value; }
        }
    }
    public Result save(Grant grant, Member member, int variant, long operation) {
        synchronized (work) {
            synchronized (this) {
                check(grant, member, Action.SAVE);
                if (variant < 0 || variant > 1 || !grant.used.add(operation))
                    throw new SecurityException("Unsupported or duplicate change");
            }
            try { store.write(member, variant, () -> check(grant, member, Action.SAVE)); }
            catch (SecurityException denied) { throw denied; }
            catch (Exception failure) {
                synchronized (this) { uncertain = true; active = null; }
                return Result.UNKNOWN;
            }
            try { check(grant, member, Action.SAVE); return Result.APPLIED; }
            catch (SecurityException ended) { return Result.APPLIED_ENDED; }
        }
    }
    public static String fixture(Member member, int variant) {
        if (variant < 0 || variant > 1) throw new IllegalArgumentException("Unsupported fixture");
        return (member == Member.ALEX ? "Alex Example" : "Sam Example") +
            (variant == 0 ? " — fictional library visit: Monday" : " — fictional library visit: Tuesday");
    }
}
