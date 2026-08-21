use tauri::Manager;

#[cfg(target_os = "macos")]
mod macos_dock_menu;

pub fn configure_main_window(app: &tauri::App) {
    if app.get_webview_window("main").is_none() {
        eprintln!("[window] main webview window was not found during setup");
    }

    #[cfg(target_os = "macos")]
    macos_dock_menu::install(app);
}
