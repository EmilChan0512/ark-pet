pub mod commands;
pub mod tray;
pub mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            window::configure_main_window(app);
            tray::log_strategy();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
