#[cfg(all(target_os = "windows", debug_assertions))]
mod desktop_review;
#[cfg(all(target_os = "windows", debug_assertions))]
mod windows_session;
#[cfg(all(target_os = "windows", debug_assertions))]
mod windows_vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(target_os = "windows", debug_assertions))]
    if std::env::args().skip(1).collect::<Vec<_>>() == ["--windows-verifier-availability"] {
        println!("{}", windows_vault::availability());
        return;
    }
    let context = tauri::generate_context!();
    let builder = tauri::Builder::default();

    // The optional loopback probe is only compiled into Windows debug builds.
    // Default launches and Android retain the bundled offline adapter.
    #[cfg(all(target_os = "windows", debug_assertions))]
    let (builder, context) = {
        let mut context = context;
        let args: Vec<String> = std::env::args().skip(1).collect();
        let native_vault = args == ["--fictional-windows-vault"];
        let url = if native_vault {
            None
        } else {
            desktop_review::review_url(args).expect("Invalid fictional review launch arguments")
        };
        let builder = if native_vault {
            let url = windows_vault::read_url().expect("Invalid native example input");
            context.config_mut().app.windows.clear();
            builder.setup(move |app| windows_vault::setup(app, url))
        } else if let Some(url) = url {
            let mut window = context.config().app.windows[0].clone();
            context.config_mut().app.windows.clear();
            window.url = tauri::WebviewUrl::External(url.clone());
            window.title = "Luna OS Home — Fictional assistant review".into();
            builder.setup(move |app| {
                tauri::WebviewWindowBuilder::from_config(app, &window)?
                    .on_navigation(move |candidate| {
                        desktop_review::allowed_navigation(&url, candidate)
                    })
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .on_download(|_, _| false)
                    .build()?;
                Ok(())
            })
        } else {
            builder
        };
        (builder, context)
    };

    // No application commands, plugins or native capability grants.
    builder
        .run(context)
        .expect("Could not start the fictional Home preview");
}
