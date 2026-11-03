fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["open_fictional_vault", "open_luna_probe"]),
    ))
    .expect("Could not build Home command permissions")
}
