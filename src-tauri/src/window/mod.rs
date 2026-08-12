use tauri::Manager;

pub fn configure_main_window(app: &tauri::App) {
    if app.get_webview_window("main").is_none() {
        eprintln!("[window] main webview window was not found during setup");
    }
}
