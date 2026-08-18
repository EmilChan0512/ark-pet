pub mod commands;
pub mod speech;
pub mod tray;
pub mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .manage(speech::VoiceState::discover())
        .invoke_handler(tauri::generate_handler![
            speech::get_voice_capabilities,
            speech::resolve_original_voice_clip,
            speech::synthesize_character_voice,
            speech::warm_character_voice,
            speech::cancel_character_voice,
            speech::shutdown_character_voice,
        ])
        .setup(|app| {
            window::configure_main_window(app);
            tray::log_strategy();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
