package io.github.f2illc.lunaos.home.preview;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;

public final class VaultServiceTest {
    private static final VaultService.Member ALEX = VaultService.Member.ALEX;
    private static final VaultService.Member SAM = VaultService.Member.SAM;
    private static final VaultService.Mode SETUP = VaultService.Mode.SETUP;
    private static void require(boolean value) { if (!value) throw new AssertionError(); }
    private static void denied(Runnable action) {
        try { action.run(); throw new AssertionError("Expected denial"); } catch (SecurityException expected) { }
    }
    private static void await(CountDownLatch latch) throws Exception {
        if (!latch.await(5, TimeUnit.SECONDS)) throw new AssertionError("Timed out");
    }
    private static final class Store implements VaultService.Store {
        int writes;
        int value;
        boolean unknown;
        CountDownLatch entered;
        CountDownLatch release;
        Runnable afterCommit = () -> {};
        private void hold() throws Exception {
            if (entered != null) { entered.countDown(); await(release); }
        }
        public int read(VaultService.Member member) throws Exception { hold(); return value; }
        public void write(VaultService.Member member, int variant, Runnable check) throws Exception {
            hold(); check.run(); value = variant; writes++; afterCommit.run();
            if (unknown) throw new java.io.IOException("Acknowledgement lost");
        }
    }
    public static void main(String[] args) throws Exception {
        AtomicLong time = new AtomicLong(1);
        Store store = new Store();
        VaultService service = new VaultService(store, time::get);
        VaultService.Grant read = service.approve(ALEX, VaultService.Mode.READ_ONLY);
        denied(() -> service.save(read, ALEX, 0, 1));
        denied(() -> service.check(read, SAM, VaultService.Action.READ));
        denied(() -> service.check(read, ALEX, VaultService.Action.DELETE));
        VaultService.Grant setup = service.approve(ALEX, SETUP);
        denied(() -> service.check(read, ALEX, VaultService.Action.READ));
        denied(() -> service.check(setup, ALEX, VaultService.Action.DELETE));
        require(service.save(setup, ALEX, 1, 1) == VaultService.Result.APPLIED);
        denied(() -> service.save(setup, ALEX, 0, 1));
        denied(() -> service.save(setup, ALEX, 2, 99));
        require(store.writes == 1 && service.read(setup, ALEX) == 1);
        time.addAndGet(60_000);
        denied(() -> service.save(setup, ALEX, 0, 2));
        VaultService.Grant ended = service.approve(ALEX, SETUP);
        store.afterCommit = service::end;
        require(service.save(ended, ALEX, 0, 3) == VaultService.Result.APPLIED_ENDED);
        store.afterCommit = () -> {};
        store.unknown = true;
        VaultService.Grant uncertain = service.approve(ALEX, SETUP);
        require(service.save(uncertain, ALEX, 1, 4) == VaultService.Result.UNKNOWN);
        denied(() -> service.approve(ALEX, SETUP));
        denied(() -> service.save(uncertain, ALEX, 0, 5));
        VaultService restarted = new VaultService(store, time::get);
        denied(() -> restarted.check(uncertain, ALEX, VaultService.Action.READ));
        require(restarted.read(restarted.approve(ALEX, VaultService.Mode.READ_ONLY), ALEX) == 1);
        for (boolean writing : new boolean[] { false, true }) {
            for (int closure = 0; closure < 3; closure++) {
                Store held = new Store(); held.entered = new CountDownLatch(1); held.release = new CountDownLatch(1);
                VaultService guarded = new VaultService(held, time::get);
                VaultService.Grant original = guarded.approve(ALEX, SETUP);
                AtomicReference<Throwable> failure = new AtomicReference<>();
                Thread first = new Thread(() -> {
                    try {
                        if (writing) guarded.save(original, ALEX, 1, 1); else guarded.read(original, ALEX);
                        failure.set(new AssertionError("Late operation escaped"));
                    } catch (SecurityException expected) { }
                    catch (Throwable error) { failure.set(error); }
                });
                Thread queued = new Thread(() -> {
                    try { denied(() -> guarded.save(original, ALEX, 0, 2)); }
                    catch (Throwable error) { failure.set(error); }
                });
                first.start(); await(held.entered); queued.start();
                if (closure == 0) guarded.end();
                else if (closure == 1) guarded.approve(SAM, SETUP);
                else time.addAndGet(60_000);
                held.release.countDown(); first.join(5000); queued.join(5000);
                require(!first.isAlive() && !queued.isAlive() && failure.get() == null && held.writes == 0);
            }
        }
        AtomicBoolean unlocked = new AtomicBoolean(true);
        Store lockStore = new Store();
        VaultService locked = new VaultService(lockStore, time::get, unlocked::get);
        VaultService.Grant lockGrant = locked.approve(ALEX, SETUP);
        unlocked.set(false);
        denied(() -> locked.save(lockGrant, ALEX, 0, 1));
        denied(() -> locked.approve(ALEX, SETUP));
        unlocked.set(true);
        denied(() -> locked.check(lockGrant, ALEX, VaultService.Action.READ));
        require(lockStore.writes == 0);
        VaultService.Grant backwards = restarted.approve(ALEX, SETUP);
        time.set(0);
        denied(() -> restarted.check(backwards, ALEX, VaultService.Action.READ));
        System.out.println("PASS native policy: scope, read-only, delete, expiry, replacement, held reads/writes, queued writes, restart, duplicate and uncertain outcomes");
    }
}
