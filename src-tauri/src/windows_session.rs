//! Native-window lifecycle monitor. No operation here locks or suspends Windows.
use std::{
    io::Write,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use windows::{
    core::Error,
    Win32::{
        Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM},
        System::{
            Power::{
                RegisterSuspendResumeNotification, UnregisterSuspendResumeNotification,
                HPOWERNOTIFY,
            },
            RemoteDesktop::{
                WTSRegisterSessionNotification, WTSUnRegisterSessionNotification,
                NOTIFY_FOR_THIS_SESSION,
            },
        },
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::*,
        },
    },
};

#[derive(Clone, Copy, PartialEq, Debug)]
enum Phase {
    Waiting,
    Ready,
    Verified,
    Ended,
}
pub struct Visit {
    phase: Mutex<Phase>,
}
impl Visit {
    fn new() -> Self {
        Self {
            phase: Mutex::new(Phase::Waiting),
        }
    }
    // The mutex serializes monitor termination with an outstanding OS prompt.
    // Receipt order can never become Ended -> Verified, even across threads.
    fn transition(&self, next: Phase, output: &mut impl Write) -> bool {
        let Ok(mut phase) = self.phase.lock() else {
            return false;
        };
        let allowed = matches!(
            (*phase, next),
            (Phase::Waiting, Phase::Ready)
                | (Phase::Ready, Phase::Verified)
                | (
                    Phase::Waiting | Phase::Ready | Phase::Verified,
                    Phase::Ended
                )
        );
        if !allowed {
            return false;
        }
        let receipt = match next {
            Phase::Ready => b"HOME_WINDOWS_MONITOR_READY\n".as_slice(),
            Phase::Verified => b"HOME_WINDOWS_VERIFIED\n".as_slice(),
            _ => b"HOME_WINDOWS_SESSION_ENDED\n".as_slice(),
        };
        *phase = next;
        if output
            .write_all(receipt)
            .and_then(|_| output.flush())
            .is_err()
        {
            *phase = Phase::Ended;
            return false;
        }
        true
    }
    pub fn verify(&self) -> bool {
        self.transition(Phase::Verified, &mut std::io::stdout().lock())
    }
    fn end(&self) -> bool {
        self.transition(Phase::Ended, &mut std::io::stdout().lock())
    }
}

fn ends_visit(message: u32, value: usize) -> bool {
    match message {
        WM_WTSSESSION_CHANGE => matches!(
            value as u32,
            WTS_SESSION_LOCK
                | WTS_SESSION_UNLOCK
                | WTS_SESSION_LOGOFF
                | WTS_CONSOLE_DISCONNECT
                | WTS_REMOTE_DISCONNECT
                | WTS_SESSION_REMOTE_CONTROL
        ),
        WM_POWERBROADCAST => matches!(
            value as u32,
            PBT_APMSUSPEND | PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND | PBT_APMRESUMECRITICAL
        ),
        WM_ENDSESSION => value != 0,
        WM_DESTROY | WM_NCDESTROY => true,
        _ => false,
    }
}

struct Monitor {
    visit: Arc<Visit>,
    on_end: Box<dyn Fn()>,
    hwnd: HWND,
    power: HPOWERNOTIFY,
    unregistered: AtomicBool,
}
impl Monitor {
    fn unregister(&self) {
        if !self.unregistered.swap(true, Ordering::SeqCst) {
            // Both registrations belong to this window and were successfully made.
            unsafe {
                let _ = WTSUnRegisterSessionNotification(self.hwnd);
                let _ = UnregisterSuspendResumeNotification(self.power);
            }
        }
    }
}
const SUBCLASS_ID: usize = 0x4c554e41;
unsafe extern "system" fn callback(
    hwnd: HWND,
    message: u32,
    wp: WPARAM,
    lp: LPARAM,
    _: usize,
    data: usize,
) -> LRESULT {
    // Box ownership transfers to this subclass on successful installation. It
    // is released only after removing the callback at final window destruction.
    let monitor = &*(data as *const Monitor);
    if ends_visit(message, wp.0) {
        // Bounded event labels only; no session IDs, account details or raw messages.
        // Emit before ending the pipe gate so supervisor termination cannot lose it.
        let reason = match (message, wp.0 as u32) {
            (WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK) => "lock",
            (WM_POWERBROADCAST, PBT_APMSUSPEND) => "suspend",
            (WM_POWERBROADCAST, _) => "resume",
            (WM_WTSSESSION_CHANGE, _) => "session-change",
            _ => "window-close",
        };
        eprintln!("HOME_WINDOWS_EVENT:{reason}");
        monitor.visit.end();
        if !matches!(message, WM_DESTROY | WM_NCDESTROY) {
            let _ = ShowWindow(hwnd, SW_HIDE);
            (monitor.on_end)();
        }
    }
    if matches!(message, WM_DESTROY | WM_NCDESTROY) {
        monitor.unregister();
    }
    if message == WM_NCDESTROY {
        // Remove before releasing data, so a nested message cannot reuse it.
        if RemoveWindowSubclass(hwnd, Some(callback), SUBCLASS_ID).as_bool() {
            drop(Box::from_raw(data as *mut Monitor));
        } // On removal failure retain the allocation until process exit.
    }
    DefSubclassProc(hwnd, message, wp, lp)
}

// Must run on the HWND's UI thread. Registration failures cannot emit Ready.
pub fn install(hwnd: HWND, on_end: impl Fn() + 'static) -> windows::core::Result<Arc<Visit>> {
    unsafe {
        WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION)?;
        let power =
            match RegisterSuspendResumeNotification(HANDLE(hwnd.0), DEVICE_NOTIFY_WINDOW_HANDLE) {
                Ok(value) => value,
                Err(error) => {
                    let _ = WTSUnRegisterSessionNotification(hwnd);
                    return Err(error);
                }
            };
        let visit = Arc::new(Visit::new());
        let monitor = Box::new(Monitor {
            visit: visit.clone(),
            on_end: Box::new(on_end),
            hwnd,
            power,
            unregistered: AtomicBool::new(false),
        });
        let data = Box::into_raw(monitor);
        if !SetWindowSubclass(hwnd, Some(callback), SUBCLASS_ID, data as usize).as_bool() {
            let monitor = Box::from_raw(data);
            monitor.unregister();
            return Err(Error::from_hresult(windows::core::HRESULT(
                0x80004005u32 as i32,
            )));
        }
        if !visit.transition(Phase::Ready, &mut std::io::stdout().lock()) {
            return Err(Error::from_hresult(windows::core::HRESULT(
                0x80004005u32 as i32,
            )));
        }
        Ok(visit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_registration_and_injected_window_delivery_without_locking_windows() {
        use std::{cell::Cell, rc::Rc};
        use windows::core::w;
        struct Window(HWND);
        impl Drop for Window {
            fn drop(&mut self) {
                unsafe {
                    let _ = DestroyWindow(self.0);
                }
            }
        }
        // Hidden owned window; SendMessage targets it only, never HWND_BROADCAST.
        // This exercises real registration/subclass delivery, NOT a machine lock.
        for (message, value) in [
            (WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK),
            (WM_POWERBROADCAST, PBT_APMSUSPEND),
            (WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC),
        ] {
            let window = Window(unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("STATIC"),
                    w!("Luna synthetic event test"),
                    WS_OVERLAPPED,
                    0,
                    0,
                    1,
                    1,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap()
            });
            let ended = Rc::new(Cell::new(0));
            let observed = ended.clone();
            let visit = install(window.0, move || observed.set(observed.get() + 1)).unwrap();
            assert_eq!(*visit.phase.lock().unwrap(), Phase::Ready);
            unsafe {
                SendMessageW(
                    window.0,
                    message,
                    Some(WPARAM(value as usize)),
                    Some(LPARAM(0)),
                );
            }
            assert_eq!(ended.get(), 1);
            assert_eq!(*visit.phase.lock().unwrap(), Phase::Ended);
            assert!(!visit.transition(Phase::Verified, &mut Vec::new()));
            drop(window);
        }
        assert!(install(HWND::default(), || panic!(
            "Unavailable monitor must not be used"
        ))
        .is_err());
    }
    #[test]
    fn injected_session_and_power_messages_end_visit_without_resuming_it() {
        for (message, values) in [
            (
                WM_WTSSESSION_CHANGE,
                vec![
                    WTS_SESSION_LOCK,
                    WTS_SESSION_UNLOCK,
                    WTS_SESSION_LOGOFF,
                    WTS_CONSOLE_DISCONNECT,
                    WTS_REMOTE_DISCONNECT,
                    WTS_SESSION_REMOTE_CONTROL,
                ],
            ),
            (
                WM_POWERBROADCAST,
                vec![
                    PBT_APMSUSPEND,
                    PBT_APMRESUMEAUTOMATIC,
                    PBT_APMRESUMESUSPEND,
                    PBT_APMRESUMECRITICAL,
                ],
            ),
        ] {
            for value in values {
                assert!(ends_visit(message, value as usize));
                let visit = Visit::new();
                let mut output = Vec::new();
                assert!(visit.transition(Phase::Ready, &mut output));
                assert!(visit.transition(Phase::Ended, &mut output));
                assert!(!visit.transition(Phase::Verified, &mut output));
                assert!(!visit.transition(Phase::Ready, &mut output));
                assert_eq!(
                    output,
                    b"HOME_WINDOWS_MONITOR_READY\nHOME_WINDOWS_SESSION_ENDED\n"
                );
            }
        }
        assert!(!ends_visit(
            WM_POWERBROADCAST,
            PBT_APMPOWERSTATUSCHANGE as usize
        ));
        assert!(!ends_visit(WM_ENDSESSION, 0));
        assert!(ends_visit(WM_ENDSESSION, 1));
        assert!(ends_visit(WM_DESTROY, 0));
        assert!(ends_visit(WM_NCDESTROY, 0));
    }
    #[test]
    fn unavailable_monitor_and_failed_pipe_cannot_verify() {
        let visit = Visit::new();
        let mut output = Vec::new();
        assert!(!visit.transition(Phase::Verified, &mut output));
        assert!(output.is_empty());
        struct Broken;
        impl Write for Broken {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::ErrorKind::BrokenPipe.into())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        assert!(!visit.transition(Phase::Ready, &mut Broken));
        assert!(!visit.transition(Phase::Verified, &mut output));
    }
    #[test]
    fn verification_racing_monitor_end_always_finishes_ended() {
        let visit = Arc::new(Visit::new());
        let mut output = Vec::new();
        assert!(visit.transition(Phase::Ready, &mut output));
        let verifier = visit.clone();
        let thread =
            std::thread::spawn(move || verifier.transition(Phase::Verified, &mut Vec::new()));
        visit.transition(Phase::Ended, &mut output);
        thread.join().unwrap();
        assert_eq!(*visit.phase.lock().unwrap(), Phase::Ended);
        assert!(!visit.transition(Phase::Verified, &mut output));
    }
}
