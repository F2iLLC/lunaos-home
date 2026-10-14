#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // This packaging probe exposes no application commands or native plugins.
    // Drafts use the shared, in-memory JavaScript rules inside this webview.
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Could not start the fictional Home preview");
}
