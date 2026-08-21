use std::sync::OnceLock;

use tauri::{AppHandle, Emitter};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

unsafe extern "C" {
    fn ark_pet_install_dock_menu();
}

pub fn install(app: &tauri::App) {
    if APP_HANDLE.set(app.handle().clone()).is_err() {
        return;
    }

    unsafe {
        ark_pet_install_dock_menu();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ark_pet_open_settings() {
    let Some(app) = APP_HANDLE.get() else {
        return;
    };

    let _ = app.emit("ark://open-settings", ());
}
