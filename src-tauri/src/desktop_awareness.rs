use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const SAMPLE_INTERVAL: Duration = Duration::from_millis(1500);
const IDLE_SHORT_MS: u64 = 5 * 60_000;
const IDLE_MEDIUM_MS: u64 = 15 * 60_000;
const IDLE_LONG_MS: u64 = 60 * 60_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
enum CapabilityState {
    Available,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAwarenessCapabilities {
    foreground_category: CapabilityState,
    system_idle: CapabilityState,
    session_lock: CapabilityState,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoarseDesktopSample {
    category: &'static str,
    idle_state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    idle_bucket: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_state: Option<&'static str>,
}

struct Observer {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

#[derive(Default)]
pub struct DesktopAwarenessState(Mutex<Option<Observer>>);

fn capabilities() -> DesktopAwarenessCapabilities {
    #[cfg(windows)]
    {
        DesktopAwarenessCapabilities {
            foreground_category: CapabilityState::Available,
            system_idle: CapabilityState::Available,
            session_lock: CapabilityState::Available,
        }
    }
    #[cfg(target_os = "macos")]
    {
        DesktopAwarenessCapabilities {
            foreground_category: CapabilityState::Available,
            system_idle: CapabilityState::Available,
            session_lock: CapabilityState::Unsupported,
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        DesktopAwarenessCapabilities {
            foreground_category: CapabilityState::Unsupported,
            system_idle: CapabilityState::Unsupported,
            session_lock: CapabilityState::Unsupported,
        }
    }
}

fn stop_locked(observer: &mut Option<Observer>) {
    if let Some(observer) = observer.take() {
        observer.stop.store(true, Ordering::Release);
        let _ = observer.thread.join();
    }
}

#[tauri::command]
pub fn start_desktop_awareness(
    app: AppHandle,
    state: State<'_, DesktopAwarenessState>,
) -> Result<DesktopAwarenessCapabilities, &'static str> {
    let caps = capabilities();
    let mut observer = state.0.lock().map_err(|_| "observer-state-unavailable")?;
    stop_locked(&mut observer);

    #[cfg(any(windows, target_os = "macos"))]
    {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let thread = thread::Builder::new()
            .name("desktop-awareness".into())
            .spawn(move || {
                let mut previous: Option<CoarseDesktopSample> = None;
                while !thread_stop.load(Ordering::Acquire) {
                    let sample = platform_sample();
                    if previous.as_ref() != Some(&sample) {
                        // Payload is already minimized. Never log adapter inputs or payloads.
                        let _ = app.emit("desktop-awareness://sample", &sample);
                        previous = Some(sample);
                    }
                    let mut elapsed = Duration::ZERO;
                    while elapsed < SAMPLE_INTERVAL && !thread_stop.load(Ordering::Acquire) {
                        let slice = Duration::from_millis(100);
                        thread::sleep(slice);
                        elapsed += slice;
                    }
                }
            })
            .map_err(|_| "observer-thread-unavailable")?;
        *observer = Some(Observer { stop, thread });
    }
    Ok(caps)
}

#[cfg(windows)]
fn platform_sample() -> CoarseDesktopSample {
    windows_adapter::sample()
}

#[cfg(target_os = "macos")]
fn platform_sample() -> CoarseDesktopSample {
    macos_adapter::sample()
}

#[tauri::command]
pub fn stop_desktop_awareness(state: State<'_, DesktopAwarenessState>) -> Result<(), &'static str> {
    let mut observer = state.0.lock().map_err(|_| "observer-state-unavailable")?;
    stop_locked(&mut observer);
    Ok(())
}

#[cfg(windows)]
mod windows_adapter {
    use super::{CoarseDesktopSample, IDLE_LONG_MS, IDLE_MEDIUM_MS, IDLE_SHORT_MS};
    use std::path::Path;
    use windows_sys::Win32::Foundation::{CloseHandle, MAX_PATH};
    use windows_sys::Win32::System::StationsAndDesktops::{
        CloseDesktop, OpenInputDesktop, DESKTOP_READOBJECTS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    pub(super) fn sample() -> CoarseDesktopSample {
        let locked = is_session_locked();
        let idle_ms = aggregate_idle_ms();
        CoarseDesktopSample {
            category: if locked {
                "system"
            } else {
                foreground_category()
            },
            idle_state: if idle_ms >= IDLE_SHORT_MS {
                "idle"
            } else {
                "active"
            },
            idle_bucket: if idle_ms >= IDLE_LONG_MS {
                Some("long")
            } else if idle_ms >= IDLE_MEDIUM_MS {
                Some("medium")
            } else if idle_ms >= IDLE_SHORT_MS {
                Some("short")
            } else {
                None
            },
            session_state: Some(if locked { "locked" } else { "available" }),
        }
    }

    fn aggregate_idle_ms() -> u64 {
        let mut input = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if unsafe { GetLastInputInfo(&mut input) } == 0 {
            return 0;
        }
        u32::wrapping_sub(
            unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount() },
            input.dwTime,
        ) as u64
    }

    fn is_session_locked() -> bool {
        let desktop = unsafe { OpenInputDesktop(0, 0, DESKTOP_READOBJECTS) };
        if desktop.is_null() {
            return true;
        }
        unsafe {
            CloseDesktop(desktop);
        }
        false
    }

    fn foreground_category() -> &'static str {
        let window = unsafe { GetForegroundWindow() };
        if window.is_null() {
            return "unknown";
        }
        let mut process_id = 0u32;
        unsafe {
            GetWindowThreadProcessId(window, &mut process_id);
        }
        if process_id == 0 {
            return "unknown";
        }
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
        if process.is_null() {
            return "unknown";
        }
        let mut buffer = vec![0u16; MAX_PATH as usize * 4];
        let mut length = buffer.len() as u32;
        let ok =
            unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) };
        unsafe {
            CloseHandle(process);
        }
        if ok == 0 {
            return "unknown";
        }
        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        let identity = Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        classify_normalized_identity(&identity)
    }

    pub(super) fn classify_normalized_identity(identity: &str) -> &'static str {
        match identity {
            "code.exe"
            | "devenv.exe"
            | "idea64.exe"
            | "pycharm64.exe"
            | "webstorm64.exe"
            | "rider64.exe"
            | "androidstudio64.exe" => "development",
            "chrome.exe" | "msedge.exe" | "firefox.exe" | "brave.exe" | "opera.exe" => "browsing",
            "slack.exe" | "discord.exe" | "teams.exe" | "wechat.exe" | "qq.exe" | "zoom.exe" => {
                "communication"
            }
            "winword.exe" | "excel.exe" | "powerpnt.exe" | "onenote.exe" | "notion.exe" => {
                "productivity"
            }
            "photoshop.exe" | "illustrator.exe" | "figma.exe" | "blender.exe"
            | "davinciresolve.exe" => "creative",
            "spotify.exe" | "vlc.exe" | "wmplayer.exe" | "music.ui.exe" => "media",
            "steam.exe" | "epicgameslauncher.exe" | "goggalaxy.exe" | "riotclientservices.exe" => {
                "gaming"
            }
            "explorer.exe"
            | "searchhost.exe"
            | "shellexperiencehost.exe"
            | "applicationframehost.exe"
            | "tauri-spine-desktop-pet.exe" => "system",
            "" => "unknown",
            _ => "unknown",
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{classify_normalized_identity, sample};
        #[test]
        fn classifies_exact_known_identities() {
            assert_eq!(classify_normalized_identity("code.exe"), "development");
            assert_eq!(classify_normalized_identity("steam.exe"), "gaming");
            assert_eq!(classify_normalized_identity("vlc.exe"), "media");
        }
        #[test]
        fn unknown_does_not_use_fuzzy_matching() {
            assert_eq!(classify_normalized_identity("code-helper.exe"), "unknown");
            assert_eq!(
                classify_normalized_identity("secret-project-title.exe"),
                "unknown"
            );
        }

        /// Explicitly invoked by the Phase 10 acceptance command. It is kept
        /// out of the normal deterministic suite because it samples the real
        /// desktop once, but it still asserts only the minimized contract.
        #[test]
        #[ignore = "Windows platform smoke test"]
        fn platform_smoke_returns_only_public_coarse_values() {
            let sample = sample();
            assert!([
                "development", "browsing", "communication", "productivity",
                "creative", "media", "gaming", "system", "other", "unknown",
            ].contains(&sample.category));
            assert!(["active", "idle"].contains(&sample.idle_state));
            assert!(sample.idle_bucket.is_none_or(|bucket| ["short", "medium", "long"].contains(&bucket)));
            assert!(sample.session_state.is_none_or(|state| ["available", "locked"].contains(&state)));
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_adapter {
    use super::{CoarseDesktopSample, IDLE_LONG_MS, IDLE_MEDIUM_MS, IDLE_SHORT_MS};
    use std::ffi::{c_char, c_void, CStr};

    #[link(name = "AppKit", kind = "framework")]
    extern "C" {}
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: u32, event_type: u32) -> f64;
    }
    #[link(name = "objc", kind = "dylib")]
    extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut c_void;
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        fn objc_msgSend();
        fn objc_autoreleasePoolPush() -> *mut c_void;
        fn objc_autoreleasePoolPop(pool: *mut c_void);
    }

    pub(super) fn sample() -> CoarseDesktopSample {
        let idle_ms = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
        let idle_ms = if idle_ms.is_finite() && idle_ms >= 0.0 {
            (idle_ms * 1000.0) as u64
        } else {
            0
        };
        CoarseDesktopSample {
            category: foreground_category(),
            idle_state: if idle_ms >= IDLE_SHORT_MS {
                "idle"
            } else {
                "active"
            },
            idle_bucket: if idle_ms >= IDLE_LONG_MS {
                Some("long")
            } else if idle_ms >= IDLE_MEDIUM_MS {
                Some("medium")
            } else if idle_ms >= IDLE_SHORT_MS {
                Some("short")
            } else {
                None
            },
            // A reliable lock notification requires a lifecycle integration;
            // this sub-capability is reported unsupported rather than guessed.
            session_state: None,
        }
    }

    fn foreground_category() -> &'static str {
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let workspace_class = objc_getClass(c"NSWorkspace".as_ptr());
            if workspace_class.is_null() {
                objc_autoreleasePoolPop(pool);
                return "unknown";
            }
            let shared: extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
                std::mem::transmute(objc_msgSend as *const ());
            let workspace = shared(
                workspace_class,
                sel_registerName(c"sharedWorkspace".as_ptr()),
            );
            let frontmost = shared(
                workspace,
                sel_registerName(c"frontmostApplication".as_ptr()),
            );
            let bundle = if frontmost.is_null() {
                std::ptr::null_mut()
            } else {
                shared(frontmost, sel_registerName(c"bundleIdentifier".as_ptr()))
            };
            let identity = if bundle.is_null() {
                None
            } else {
                let utf8: extern "C" fn(*mut c_void, *mut c_void) -> *const c_char =
                    std::mem::transmute(objc_msgSend as *const ());
                let pointer = utf8(bundle, sel_registerName(c"UTF8String".as_ptr()));
                if pointer.is_null() {
                    None
                } else {
                    CStr::from_ptr(pointer)
                        .to_str()
                        .ok()
                        .map(str::to_ascii_lowercase)
                }
            };
            let category = identity
                .as_deref()
                .map(classify_bundle_id)
                .unwrap_or("unknown");
            objc_autoreleasePoolPop(pool);
            category
        }
    }

    fn classify_bundle_id(identity: &str) -> &'static str {
        match identity {
            "com.microsoft.vscode"
            | "com.apple.dt.xcode"
            | "com.jetbrains.intellij"
            | "com.jetbrains.pycharm" => "development",
            "com.apple.safari"
            | "com.google.chrome"
            | "org.mozilla.firefox"
            | "com.brave.browser" => "browsing",
            "com.tinyspeck.slackmacgap"
            | "com.hnc.discord"
            | "com.microsoft.teams2"
            | "us.zoom.xos" => "communication",
            "com.microsoft.word"
            | "com.microsoft.excel"
            | "com.microsoft.powerpoint"
            | "notion.id" => "productivity",
            "com.adobe.photoshop" | "com.adobe.illustrator" | "com.blenderfoundation.blender" => {
                "creative"
            }
            "com.spotify.client"
            | "org.videolan.vlc"
            | "com.apple.music"
            | "com.apple.quicktimeplayerx" => "media",
            "com.valvesoftware.steam" | "com.epicgames.epicgameslauncher" => "gaming",
            "com.apple.finder"
            | "com.apple.systempreferences"
            | "com.apple.systemsettings"
            | "com.arkpet.desktop" => "system",
            _ => "unknown",
        }
    }
}

#[cfg(test)]
mod privacy_tests {
    use super::*;
    #[test]
    fn frontend_payload_contains_only_coarse_fields() {
        let payload = serde_json::to_value(CoarseDesktopSample {
            category: "development",
            idle_state: "active",
            idle_bucket: None,
            session_state: Some("available"),
        })
        .unwrap();
        let object = payload.as_object().unwrap();
        assert_eq!(
            object.keys().cloned().collect::<Vec<_>>(),
            vec!["category", "idleState", "sessionState"]
        );
    }
}
