pub mod commands;
pub mod character_packages;
pub mod desktop_awareness;
pub mod speech;
pub mod tray;
pub mod window;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(speech::VoiceState::discover())
        .manage(character_packages::CharacterPackageState::default())
        .manage(desktop_awareness::DesktopAwarenessState::default())
        .invoke_handler(tauri::generate_handler![
            speech::get_voice_capabilities,
            speech::resolve_original_voice_clip,
            speech::synthesize_character_voice,
            speech::warm_character_voice,
            speech::cancel_character_voice,
            speech::shutdown_character_voice,
            character_packages::inspect_character_package,
            character_packages::install_character_package,
            character_packages::list_installed_characters,
            character_packages::remove_character_package,
            character_packages::cleanup_character_staging,
            desktop_awareness::start_desktop_awareness,
            desktop_awareness::stop_desktop_awareness,
        ])
        .setup(|app| {
            let character_root = app.path().app_data_dir()?.join("characters");
            app.asset_protocol_scope().allow_directory(character_root, true)?;
            window::configure_main_window(app);
            tray::log_strategy();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
