use tauri::{plugin::PluginHandle, Manager, Runtime};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LunaSnapshot {
    pub status: &'static str,
    pub reason: &'static str,
    pub microphone_in_use: Option<bool>,
    pub online_answers_enabled: Option<bool>,
    pub active_timers: Option<Vec<LunaTimerSnapshot>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LunaTimerSnapshot {
    pub id: String,
    pub label: String,
    pub remaining_seconds: u64,
}

pub(crate) struct Vault<R: Runtime>(PluginHandle<R>);

#[tauri::command]
pub async fn open_fictional_vault<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, Vault<R>>,
    kind: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the local main window may open this experiment".into());
    }
    let operation = match kind.as_deref() {
        None => "open",
        Some("prepare-direct") => "prepareDirect",
        Some("open-direct") => "openDirect",
        Some("vehicle") => "openVehicle",
        _ => return Err("Unsupported fictional experiment".into()),
    };
    state
        .0
        .run_mobile_plugin_async::<()>(operation, ())
        .await
        .map_err(|_| "Native screen unavailable".into())
}

// Opening the demo only brings its controls into view; it never enables capture.
#[tauri::command]
pub async fn open_luna_probe<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, Vault<R>>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the local main window may open the Luna demo".into());
    }
    state
        .0
        .run_mobile_plugin_async::<()>("openLunaProbe", ())
        .await
        .map_err(|_| "Luna demo unavailable".into())
}

// Home has not yet adopted the voice probe's native state owner. Report that
// boundary explicitly instead of reading or guessing at another package's state.
#[tauri::command]
pub async fn get_luna_snapshot<R: Runtime>(
    window: tauri::WebviewWindow<R>,
) -> Result<LunaSnapshot, String> {
    if window.label() != "main" {
        return Err("Only the local main window may read Luna status".into());
    }
    Ok(LunaSnapshot {
        status: "unavailable",
        reason: "voice_not_integrated",
        microphone_in_use: None,
        online_answers_enabled: None,
        active_timers: None,
    })
}

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("home-vault")
        .setup(|app, api| {
            let handle = api.register_android_plugin(
                "io.github.f2illc.lunaos.home.preview",
                "HomeVaultPlugin",
            )?;
            app.manage(Vault(handle));
            Ok(())
        })
        .build()
}
