//! Session owner window and lifecycle watchdog.
//!
//! An unlocked session is one process. Its native window owns the Windows
//! key-password dialog and receives session and power notifications. The
//! watchdog ends the process, and with it every open key handle, on:
//!
//! - Windows lock, unlock, logoff, disconnect or remote-control change;
//! - suspend or resume;
//! - the window being closed (the owner's manual lock);
//! - no request for the idle limit, the unlock gesture outliving its limit, or
//!   the session reaching its maximum lifetime.
//!
//! Process exit is the hard boundary. No key is handed to another process and
//! nothing is retained for a later session. Nothing here locks, unlocks or
//! suspends Windows, and focus is never forced after the first activation.
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, DispatchMessageW, IsWindow, IsWindowVisible, PeekMessageW,
    SetForegroundWindow, SetWindowTextW, ShowWindow, TranslateMessage, CW_USEDEFAULT, MSG,
    PM_REMOVE, SW_SHOWMINNOACTIVE, SW_SHOWNORMAL, WINDOW_EX_STYLE, WM_QUIT, WS_EX_APPWINDOW,
    WS_OVERLAPPED, WS_OVERLAPPEDWINDOW,
};

#[path = "../../../src/windows_session.rs"]
#[allow(dead_code)]
mod monitor;

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

/// Run `operation` on its own thread while this thread owns the window, pumps
/// its messages and enforces the limits. `end` must not return; it is called
/// with a fixed reason when the session has to stop.
pub fn run<T: Send + 'static>(
    presentation: Presentation,
    limits: Limits,
    end: fn(&'static str) -> !,
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
    if visible {
        unsafe {
            // A parent may start this process with a hidden default show
            // state; ask for a normal window explicitly, twice if needed.
            let _ = ShowWindow(hwnd, SW_SHOWNORMAL);
            let _ = ShowWindow(hwnd, SW_SHOWNORMAL);
            if !IsWindowVisible(hwnd).as_bool() {
                let _ = DestroyWindow(hwnd);
                return Err("owner-window-hidden");
            }
            let _ = SetForegroundWindow(hwnd);
        }
    }
    let _monitor = monitor::install(hwnd, move || end("session-event"))
        .map_err(|_| "session-monitor-unavailable")?;
    let clock = Arc::new(Clock::new());
    let shared = clock.clone();
    let address = hwnd.0 as isize;
    let worker = std::thread::spawn(move || operation(address, shared));
    while !worker.is_finished() {
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            end("window-closed");
        }
        if let Some(reason) = verdict(
            &limits,
            clock.phase(),
            clock.in_phase(),
            clock.start.elapsed(),
        ) {
            end(reason);
        }
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
    let result = worker.join().map_err(|_| "session-worker-failed");
    unsafe {
        let _ = DestroyWindow(hwnd);
    }
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
