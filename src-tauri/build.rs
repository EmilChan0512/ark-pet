fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=src/window/macos_dock_menu.m");
        cc::Build::new()
            .file("src/window/macos_dock_menu.m")
            .flag("-fobjc-arc")
            .compile("ark_pet_macos_dock_menu");
    }

    tauri_build::build()
}
