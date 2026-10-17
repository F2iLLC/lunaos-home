//! Debug-only, fixed-example native screen; never reads an OS password or PIN.
use std::io::Read;
use tauri::Url;
use windows::{
    core::HSTRING,
    Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier},
    Win32::System::WinRT::IUserConsentVerifierInterop,
};
use windows_future::IAsyncOperation;

pub fn parse_url(input: &str) -> Result<Url, &'static str> {
    let url = Url::parse(input).map_err(|_| "Invalid native example address")?;
    let key = url.fragment().unwrap_or_default();
    if url.as_str() != input
        || url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || !url.port().is_some_and(|p| p > 0)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/windows-vault"
        || url.query().is_some()
        || key.len() != 72
        || !key.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
    {
        return Err("Invalid native example address");
    }
    Ok(url)
}

pub fn read_url() -> Result<Url, &'static str> {
    let mut input = String::new();
    std::io::stdin()
        .take(513)
        .read_to_string(&mut input)
        .map_err(|_| "Missing native example address")?;
    if input.len() > 512 || !input.ends_with('\n') {
        return Err("Invalid native example address");
    }
    parse_url(&input[..input.len() - 1])
}

pub fn allowed_navigation(selected: &Url, candidate: &Url) -> bool {
    candidate.origin() == selected.origin()
        && candidate.username().is_empty()
        && candidate.password().is_none()
        && candidate.path() == "/windows-vault"
        && candidate.query().is_none()
        && (candidate.fragment().is_none() || candidate.fragment() == selected.fragment())
}

pub fn availability() -> &'static str {
    use windows::Security::Credentials::UI::UserConsentVerifierAvailability as Availability;
    use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};
    if unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_err() {
        return "unavailable";
    }
    let result =
        UserConsentVerifier::CheckAvailabilityAsync().and_then(|operation| operation.join());
    unsafe { RoUninitialize() };
    match result {
        Ok(Availability::Available) => "available",
        Ok(Availability::DeviceNotPresent) => "device-not-present",
        Ok(Availability::NotConfiguredForUser) => "not-configured",
        Ok(Availability::DisabledByPolicy) => "disabled-by-policy",
        Ok(Availability::DeviceBusy) => "device-busy",
        _ => "unavailable",
    }
}

fn verified(result: windows::core::Result<UserConsentVerificationResult>) -> bool {
    matches!(result, Ok(UserConsentVerificationResult::Verified))
}

pub fn setup(app: &mut tauri::App, url: Url) -> Result<(), Box<dyn std::error::Error>> {
    let selected = url.clone();
    let window = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("windows-unlock.html".into()),
    )
    .title("Luna OS Home — Verify to open examples")
    .inner_size(1100.0, 800.0)
    .on_navigation(move |candidate| {
        allowed_navigation(&selected, candidate)
            || matches!(
                candidate.as_str(),
                "http://tauri.localhost/windows-unlock.html"
                    | "tauri://localhost/windows-unlock.html"
            )
    })
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .on_download(|_, _| false)
    .build()?;
    // Owner HWND binds the OS dialog to our visible native window. This API
    // returns only a status; Home never receives the verification input.
    let handle = app.handle().clone();
    let owned_window = window.clone();
    window.run_on_main_thread(move || {
        let Ok(hwnd) = owned_window.hwnd() else {
            handle.exit(2);
            return;
        };
        let monitor_app = handle.clone();
        let visit = match crate::windows_session::install(hwnd, move || monitor_app.exit(3)) {
            Ok(visit) => visit,
            Err(_) => {
                eprintln!("HOME_WINDOWS_MONITOR_UNAVAILABLE");
                handle.exit(3);
                return;
            }
        };
        let operation =
            (|| -> windows::core::Result<IAsyncOperation<UserConsentVerificationResult>> {
                let interop: IUserConsentVerifierInterop =
                    windows::core::factory::<UserConsentVerifier, IUserConsentVerifierInterop>()?;
                unsafe {
                    interop.RequestVerificationForWindowAsync(
                        hwnd,
                        &HSTRING::from(
                            "Open Luna OS Home fictional examples for up to five minutes.",
                        ),
                    )
                }
            })();
        tauri::async_runtime::spawn(async move {
            let result = match operation {
                Ok(operation) => operation.await,
                Err(error) => Err(error),
            };
            if matches!(&result, Ok(UserConsentVerificationResult::Canceled)) {
                // Status only, on the supervisor's private diagnostic pipe.
                eprintln!("HOME_WINDOWS_CANCELED");
            }
            if !verified(result) {
                handle.exit(2);
                return;
            }
            if !visit.verify() || owned_window.navigate(url).is_err() {
                handle.exit(2);
            }
        });
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn address() -> String {
        format!("http://127.0.0.1:4183/windows-vault#{}", "a".repeat(72))
    }
    #[test]
    fn native_url_is_exact_and_navigation_cannot_leave_screen() {
        let url = parse_url(&address()).unwrap();
        assert!(allowed_navigation(&url, &url));
        assert!(allowed_navigation(
            &url,
            &Url::parse("http://127.0.0.1:4183/windows-vault").unwrap()
        ));
        for candidate in [
            address().replace("127.0.0.1", "localhost"),
            address().replace("127.0.0.1", "127.1"),
            address().replace(":4183", ":0"),
            address().replace("/windows-vault", "/x/../windows-vault"),
            address().replace("http:", "https:"),
            address().replace("#", "?x#"),
            address().replace("127.0.0.1", "user@127.0.0.1"),
            format!(" {}", address()),
            address().replace(&"a".repeat(72), "short"),
        ] {
            assert!(parse_url(&candidate).is_err());
        }
        for candidate in [
            "http://127.0.0.1:4184/windows-vault",
            "http://127.0.0.1:4183/api/windows-preview",
            "http://127.0.0.1:4183/windows-vault#other",
            "https://example.com/",
            "about:blank",
        ] {
            assert!(!allowed_navigation(&url, &Url::parse(candidate).unwrap()));
        }
    }
    #[test]
    fn only_verified_os_result_opens_gate() {
        assert!(verified(Ok(UserConsentVerificationResult::Verified)));
        for status in [1, 2, 3, 4, 5, 6, 99] {
            assert!(!verified(Ok(UserConsentVerificationResult(status))));
        }
        assert!(!verified(Err(windows::core::Error::from_hresult(
            windows::core::HRESULT(-1)
        ))));
    }
}
