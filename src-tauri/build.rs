fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_fictional_vault",
            "get_luna_snapshot",
            "enable_luna_wake",
            "request_luna_microphone",
            "disable_luna_wake",
            "cancel_luna_timer",
        ]),
    ))
    .expect("Could not build Home command permissions")
}
