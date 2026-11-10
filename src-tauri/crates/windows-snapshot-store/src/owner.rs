//! Session owner window and lifecycle watchdog.
//!
//! An unlocked session is one process. Its native window owns the Windows
//! key-password dialog and receives session and power notifications. The
//! session ends, by process exit and with it every open key handle, on:
//!
//! - Windows lock, unlock, logoff, disconnect or remote-control change;
//! - suspend or resume;
//! - the window being closed (the owner's manual lock);
//! - no request for the idle limit, the unlock gesture outliving its limit, or
//!   the session reaching its maximum lifetime.
//!
//! Three threads take part and none of them waits for another before ending
//! the process: the window thread delivers session, power and close events
//! from inside the window procedure, so they arrive even while a system menu
//! or a window drag runs its own message loop; a watchdog thread enforces the
//! time limits without depending on the message pump; and the request thread
//! serves the caller. The `end` callback must not block on the caller's pipes.
//!
//! Process exit is the hard boundary. No key is handed to another process and
//! nothing is retained for a later session. Nothing here locks, unlocks or
//! suspends Windows, and focus is never forced after the first activation.
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Power::{
    RegisterSuspendResumeNotification, UnregisterSuspendResumeNotification, HPOWERNOTIFY,
};
use windows::Win32::System::RemoteDesktop::{
    WTSRegisterSessionNotification, WTSUnRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, DispatchMessageW, IsWindowVisible, PeekMessageW,
    SetForegroundWindow, SetWindowTextW, ShowWindow, TranslateMessage, CW_USEDEFAULT,
    DEVICE_NOTIFY_WINDOW_HANDLE, MSG, PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMECRITICAL,
    PBT_APMRESUMESUSPEND, PBT_APMSUSPEND, PM_REMOVE, SW_SHOWMINNOACTIVE, SW_SHOWNORMAL,
    WINDOW_EX_STYLE, WM_CLOSE, WM_DESTROY, WM_ENDSESSION, WM_NCDESTROY, WM_POWERBROADCAST, WM_QUIT,
    WM_WTSSESSION_CHANGE, WS_EX_APPWINDOW, WS_OVERLAPPED, WS_OVERLAPPEDWINDOW,
    WTS_CONSOLE_DISCONNECT, WTS_REMOTE_DISCONNECT, WTS_SESSION_LOCK, WTS_SESSION_LOGOFF,
    WTS_SESSION_REMOTE_CONTROL, WTS_SESSION_UNLOCK,
};

/// Called with a fixed reason when the session has to stop. It must end the
/// process and must not wait on anything the caller controls.
pub type End = fn(&'static str) -> !;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// Longest wait for the Windows key-password gesture.
    pub unlock: Duration,
    /// Longest gap between requests while unlocked.
    pub idle: Duration,
    /// Longest session, whatever its activity.
    pub lifetime: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            unlock: Duration::from_secs(120),
            idle: Duration::from_secs(5 * 60),
            lifetime: Duration::from_secs(30 * 60),
        }
    }
}

// A mutation in flight gets this long to reach a commit boundary once the
// lifetime is over. Session and power events never wait.
const LIFETIME_GRACE: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Unlocking = 0,
    Idle = 1,
    Busy = 2,
}

/// Shared between the request thread and the watchdog.
pub struct Clock {
    start: Instant,
    phase: AtomicU8,
    since_ms: AtomicU64,
}

impl Clock {
    fn new() -> Self {
        Self {
            start: Instant::now(),
            phase: AtomicU8::new(Phase::Unlocking as u8),
            since_ms: AtomicU64::new(0),
        }
    }

    pub fn enter(&self, phase: Phase) {
        self.since_ms
            .store(self.start.elapsed().as_millis() as u64, Ordering::SeqCst);
        self.phase.store(phase as u8, Ordering::SeqCst);
    }

    fn phase(&self) -> Phase {
        match self.phase.load(Ordering::SeqCst) {
            0 => Phase::Unlocking,
            1 => Phase::Idle,
            _ => Phase::Busy,
        }
    }

    fn in_phase(&self) -> Duration {
        self.start
            .elapsed()
            .saturating_sub(Duration::from_millis(self.since_ms.load(Ordering::SeqCst)))
    }
}

/// Why the watchdog would end the session now, if at all.
pub fn verdict(
    limits: &Limits,
    phase: Phase,
    in_phase: Duration,
    elapsed: Duration,
) -> Option<&'static str> {
    if elapsed >= limits.lifetime
        && (phase != Phase::Busy || elapsed >= limits.lifetime + LIFETIME_GRACE)
    {
        return Some("expired");
    }
    match phase {
        Phase::Unlocking if in_phase >= limits.unlock => Some("unlock-timeout"),
        Phase::Idle if in_phase >= limits.idle => Some("idle"),
        _ => None,
    }
}

/// The fixed reason for a window message that ends the session, if it does.
pub fn ending_message(message: u32, value: usize) -> Option<&'static str> {
    match message {
        WM_WTSSESSION_CHANGE => match value as u32 {
            WTS_SESSION_LOCK => Some("windows-lock"),
            WTS_SESSION_UNLOCK
            | WTS_SESSION_LOGOFF
            | WTS_CONSOLE_DISCONNECT
            | WTS_REMOTE_DISCONNECT
            | WTS_SESSION_REMOTE_CONTROL => Some("windows-session-change"),
            _ => None,
        },
        WM_POWERBROADCAST => match value as u32 {
            PBT_APMSUSPEND => Some("suspend"),
            PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND | PBT_APMRESUMECRITICAL => Some("resume"),
            _ => None,
        },
        WM_ENDSESSION if value != 0 => Some("windows-session-change"),
        WM_CLOSE | WM_DESTROY | WM_NCDESTROY => Some("window-closed"),
        _ => None,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Presentation {
    /// A visible window that owns the Windows key-password dialog.
    Visible,
    /// No visible window: for protectors that never show a dialog.
    Hidden,
}

pub fn set_title(window: isize, title: PCWSTR) {
    unsafe {
        let _ = SetWindowTextW(HWND(window as *mut _), title);
    }
}

/// Move the owner window out of the way without taking or forcing focus.
pub fn minimize(window: isize) {
    unsafe {
        let _ = ShowWindow(HWND(window as *mut _), SW_SHOWMINNOACTIVE);
    }
}

struct Monitor {
    end: End,
    power: HPOWERNOTIFY,
    // Set when `run` itself tears the window down after a normal finish.
    finishing: Arc<AtomicBool>,
}

const SUBCLASS_ID: usize = 0x4c55_4e41;

unsafe extern "system" fn window_procedure(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _: usize,
    data: usize,
) -> LRESULT {
    // The box is owned by this subclass from a successful install until the
    // window's final message.
    let monitor = &*(data as *const Monitor);
    if let Some(reason) = ending_message(message, wparam.0) {
        if !monitor.finishing.load(Ordering::SeqCst) {
            (monitor.end)(reason);
        }
    }
    if message == WM_NCDESTROY {
        let _ = WTSUnRegisterSessionNotification(hwnd);
        let _ = UnregisterSuspendResumeNotification(monitor.power);
        if RemoveWindowSubclass(hwnd, Some(window_procedure), SUBCLASS_ID).as_bool() {
            drop(Box::from_raw(data as *mut Monitor));
        }
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}

// Must run on the window's own thread. A session never starts unmonitored.
fn install(hwnd: HWND, end: End, finishing: Arc<AtomicBool>) -> Result<(), &'static str> {
    unsafe {
        WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)
            .map_err(|_| "session-monitor-unavailable")?;
        let power =
            match RegisterSuspendResumeNotification(HANDLE(hwnd.0), DEVICE_NOTIFY_WINDOW_HANDLE) {
                Ok(power) => power,
                Err(_) => {
                    let _ = WTSUnRegisterSessionNotification(hwnd);
                    return Err("session-monitor-unavailable");
                }
            };
        let data = Box::into_raw(Box::new(Monitor {
            end,
            power,
            finishing,
        }));
        if !SetWindowSubclass(hwnd, Some(window_procedure), SUBCLASS_ID, data as usize).as_bool() {
            drop(Box::from_raw(data));
            let _ = WTSUnRegisterSessionNotification(hwnd);
            let _ = UnregisterSuspendResumeNotification(power);
            return Err("session-monitor-unavailable");
        }
    }
    Ok(())
}

/// Run `operation` on its own thread while this thread owns the window and a
/// watchdog thread enforces the limits. Returns the operation's result when
/// it finishes; a session that must not outlive its last response should end
/// the process from `operation` itself, because a modal loop on the window
/// (its system menu, a drag) delays this return.
pub fn run<T: Send + 'static>(
    presentation: Presentation,
    limits: Limits,
    end: End,
    operation: impl FnOnce(isize, Arc<Clock>) -> T + Send + 'static,
) -> Result<T, &'static str> {
    let visible = presentation == Presentation::Visible;
    let hwnd = unsafe {
        CreateWindowExW(
            if visible {
                WS_EX_APPWINDOW
            } else {
                WINDOW_EX_STYLE::default()
            },
            w!("STATIC"),
            w!("Luna OS Home vault - waiting for your vault password"),
            if visible {
                WS_OVERLAPPEDWINDOW
            } else {
                WS_OVERLAPPED
            },
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            if visible { 620 } else { 1 },
            if visible { 160 } else { 1 },
            None,
            None,
            None,
            None,
        )
    }
    .map_err(|_| "owner-window-unavailable")?;
    let finishing = Arc::new(AtomicBool::new(false));
    let destroy = |hwnd: HWND| unsafe {
        finishing.store(true, Ordering::SeqCst);
        let _ = DestroyWindow(hwnd);
    };
    if visible {
        unsafe {
            // A parent may start this process with a hidden default show
            // state; ask for a normal window explicitly, twice if needed.
            let _ = ShowWindow(hwnd, SW_SHOWNORMAL);
            let _ = ShowWindow(hwnd, SW_SHOWNORMAL);
            if !IsWindowVisible(hwnd).as_bool() {
                destroy(hwnd);
                return Err("owner-window-hidden");
            }
            let _ = SetForegroundWindow(hwnd);
        }
    }
    if let Err(reason) = install(hwnd, end, finishing.clone()) {
        destroy(hwnd);
        return Err(reason);
    }
    let clock = Arc::new(Clock::new());
    let done = Arc::new(AtomicBool::new(false));
    {
        // The time limits do not depend on this thread's message pump.
        let clock = clock.clone();
        let done = done.clone();
        std::thread::spawn(move || {
            while !done.load(Ordering::SeqCst) {
                if let Some(reason) = verdict(
                    &limits,
                    clock.phase(),
                    clock.in_phase(),
                    clock.start.elapsed(),
                ) {
                    if !done.load(Ordering::SeqCst) {
                        end(reason);
                    }
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        });
    }
    let shared = clock.clone();
    let address = hwnd.0 as isize;
    let worker = std::thread::spawn(move || operation(address, shared));
    while !worker.is_finished() {
        let mut message = MSG::default();
        unsafe {
            while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                if message.message == WM_QUIT {
                    end("window-closed");
                }
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    done.store(true, Ordering::SeqCst);
    let result = worker.join().map_err(|_| "session-worker-failed");
    destroy(hwnd);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMITS: Limits = Limits {
        unlock: Duration::from_secs(120),
        idle: Duration::from_secs(300),
        lifetime: Duration::from_secs(1800),
    };

    #[test]
    fn the_watchdog_ends_idle_overlong_and_stalled_sessions_only() {
        let s = Duration::from_secs;
        assert_eq!(verdict(&LIMITS, Phase::Unlocking, s(119), s(119)), None);
        assert_eq!(
            verdict(&LIMITS, Phase::Unlocking, s(120), s(120)),
            Some("unlock-timeout")
        );
        assert_eq!(verdict(&LIMITS, Phase::Idle, s(299), s(900)), None);
        assert_eq!(verdict(&LIMITS, Phase::Idle, s(300), s(900)), Some("idle"));
        // A request in flight is not idle, however long it has run.
        assert_eq!(verdict(&LIMITS, Phase::Busy, s(600), s(900)), None);
        // The lifetime ends an idle session at once and a busy one after a
        // short grace, so activity can never extend a session indefinitely.
        assert_eq!(
            verdict(&LIMITS, Phase::Idle, s(1), s(1800)),
            Some("expired")
        );
        assert_eq!(verdict(&LIMITS, Phase::Busy, s(1), s(1800)), None);
        assert_eq!(
            verdict(&LIMITS, Phase::Busy, s(1), s(1810)),
            Some("expired")
        );
        assert_eq!(
            verdict(&LIMITS, Phase::Unlocking, s(1), s(1800)),
            Some("expired")
        );
    }

    #[test]
    fn session_power_and_close_messages_end_the_session_with_fixed_reasons() {
        let session = |value: u32| ending_message(WM_WTSSESSION_CHANGE, value as usize);
        assert_eq!(session(WTS_SESSION_LOCK), Some("windows-lock"));
        for value in [
            WTS_SESSION_UNLOCK,
            WTS_SESSION_LOGOFF,
            WTS_CONSOLE_DISCONNECT,
            WTS_REMOTE_DISCONNECT,
            WTS_SESSION_REMOTE_CONTROL,
        ] {
            assert_eq!(session(value), Some("windows-session-change"));
        }
        assert_eq!(session(0x1), None, "console connect does not end a session");
        let power = |value: u32| ending_message(WM_POWERBROADCAST, value as usize);
        assert_eq!(power(PBT_APMSUSPEND), Some("suspend"));
        for value in [
            PBT_APMRESUMEAUTOMATIC,
            PBT_APMRESUMESUSPEND,
            PBT_APMRESUMECRITICAL,
        ] {
            assert_eq!(power(value), Some("resume"));
        }
        assert_eq!(power(0xA), None, "a power status change is not a suspend");
        assert_eq!(ending_message(WM_ENDSESSION, 0), None);
        assert_eq!(
            ending_message(WM_ENDSESSION, 1),
            Some("windows-session-change")
        );
        for message in [WM_CLOSE, WM_DESTROY, WM_NCDESTROY] {
            assert_eq!(ending_message(message, 0), Some("window-closed"));
        }
        assert_eq!(ending_message(0x0113, 0), None, "a timer tick is ignored");
    }

    #[test]
    fn the_clock_restarts_its_phase_timer_on_every_transition() {
        let clock = Clock::new();
        assert_eq!(clock.phase(), Phase::Unlocking);
        std::thread::sleep(Duration::from_millis(30));
        assert!(clock.in_phase() >= Duration::from_millis(30));
        clock.enter(Phase::Idle);
        assert_eq!(clock.phase(), Phase::Idle);
        assert!(clock.in_phase() < Duration::from_millis(30));
        clock.enter(Phase::Busy);
        assert_eq!(clock.phase(), Phase::Busy);
    }

    #[test]
    fn a_hidden_session_runs_its_operation_and_returns_the_result() {
        fn never(_: &'static str) -> ! {
            panic!("the session must not end early")
        }
        let result = run(Presentation::Hidden, LIMITS, never, |window, clock| {
            clock.enter(Phase::Idle);
            window != 0
        });
        assert_eq!(result, Ok(true));
    }
}
