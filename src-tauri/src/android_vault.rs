use tauri::{plugin::PluginHandle, Manager, Runtime};

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
