use serde::{Deserialize, Serialize};
use tauri::{plugin::PluginHandle, Manager, Runtime};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LunaSnapshot {
    pub status: String,
    pub reason: String,
    pub capture_phase: String,
    pub notebook_animation: Option<String>,
    pub notebook_list_id: Option<String>,
    pub notebook_event: Option<u64>,
    pub last_heard: Option<String>,
    pub reply_caption: Option<String>,
    pub microphone_in_use: Option<bool>,
    pub online_answers_enabled: Option<bool>,
    pub online_answers_available: Option<bool>,
    pub active_timers: Option<Vec<LunaTimerSnapshot>>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LunaTimerSnapshot {
    pub id: String,
    pub label: String,
    pub remaining_seconds: u64,
    #[serde(default)]
    pub paused: bool,
}

#[derive(Serialize)]
struct LunaTimerRequest {
    id: u8,
}

pub(crate) struct Vault<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
struct NotebookRequest { body: String, session: String }
#[derive(Deserialize)]
struct NotebookResponse { json: String }

#[tauri::command]
pub async fn notebook_request<R: Runtime>(window: tauri::WebviewWindow<R>, state: tauri::State<'_, Vault<R>>, body: String, session: String) -> Result<String, String> {
    if window.label() != "main" || body.len() > 8192 || !(32..=64).contains(&session.len())
        || !session.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') {
        return Err("Invalid notebook request".into());
    }
    state.0.run_mobile_plugin_async::<NotebookResponse>("notebookRequest", NotebookRequest { body, session }).await
        .map(|response| response.json)
        .map_err(|_| "Could not confirm the notebook result. Reopen the list before retrying.".into())
}

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

#[tauri::command]
pub async fn get_luna_snapshot<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, Vault<R>>,
) -> Result<LunaSnapshot, String> {
    if window.label() != "main" {
        return Err("Only the local main window may read Luna status".into());
    }
    state.0.run_mobile_plugin_async::<LunaSnapshot>("lunaSnapshot", ()).await
        .map_err(|_| "Home voice status unavailable".into())
}

#[tauri::command]
pub async fn enable_luna_wake<R: Runtime>(window: tauri::WebviewWindow<R>, state: tauri::State<'_, Vault<R>>) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the local main window may enable Luna".into()); }
    state.0.run_mobile_plugin_async("enableLunaWake", ()).await.map_err(|_| "Could not enable Luna listening".into())
}

#[tauri::command]
pub async fn request_luna_microphone<R: Runtime>(window: tauri::WebviewWindow<R>, state: tauri::State<'_, Vault<R>>) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the local main window may request Luna microphone access".into()); }
    state.0.run_mobile_plugin_async::<()>("requestLunaMicrophone", ()).await.map_err(|_| "Could not request microphone access".into())
}

#[tauri::command]
pub async fn disable_luna_wake<R: Runtime>(window: tauri::WebviewWindow<R>, state: tauri::State<'_, Vault<R>>) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the local main window may disable Luna".into()); }
    state.0.run_mobile_plugin_async::<()>("disableLunaWake", ()).await.map_err(|_| "Could not disable Luna listening".into())
}

#[derive(Serialize)]
struct LunaOnlineRequest { enabled: bool }

#[tauri::command]
pub async fn set_luna_online_answers<R: Runtime>(window: tauri::WebviewWindow<R>, state: tauri::State<'_, Vault<R>>, enabled: bool) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the local main window may change Luna online answers".into()); }
    state.0.run_mobile_plugin_async::<()>("setLunaOnlineAnswers", LunaOnlineRequest { enabled }).await
        .map_err(|_| "Could not change Luna online answers".into())
}

#[tauri::command]
pub async fn cancel_luna_timer<R: Runtime>(window: tauri::WebviewWindow<R>, state: tauri::State<'_, Vault<R>>, id: u8) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the local main window may cancel a Luna timer".into()); }
    if !(1..=8).contains(&id) { return Err("Invalid Luna timer".into()); }
    state.0.run_mobile_plugin_async::<()>("cancelLunaTimer", LunaTimerRequest { id }).await.map_err(|_| "Could not cancel Luna timer".into())
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
