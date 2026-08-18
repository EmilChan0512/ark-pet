use std::{
    collections::HashSet,
    env,
    fs::{self, File},
    io::{BufRead, BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::ZipArchive;

const PEPE_CHARACTER_ID: &str = "char_4058_pepe";
const PEPE_VOICE_IDENTITY: &str = "pepe.zh-CN.cn_012";
const MAX_ORIGINAL_CLIP_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone)]
pub struct VoiceState {
    package_dir: Option<PathBuf>,
    python_executable: Option<PathBuf>,
    engine_dir: Option<PathBuf>,
    worker: Arc<Mutex<Option<VoiceWorker>>>,
    cancelled: Arc<Mutex<HashSet<String>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalVoiceConfig {
    package_dir: PathBuf,
    python_executable: Option<PathBuf>,
    engine_dir: Option<PathBuf>,
}

#[derive(Deserialize)]
struct VoiceProfile {
    character_id: String,
    locale: String,
    reference: VoiceReference,
}

#[derive(Deserialize)]
struct VoiceReference {
    voice_id: String,
}

#[derive(Deserialize)]
struct CueRegistry {
    character_id: String,
    locale: String,
    records: Vec<CueRecord>,
}

#[derive(Deserialize)]
struct CueRecord {
    voice_id: String,
    cue: String,
    locale: String,
    canonical_transcript: String,
    wav_filename: String,
    wav_sha256: String,
    verification_status: String,
}

struct VoiceWorker {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerResponse {
    #[serde(rename = "type")]
    response_type: String,
    request_id: Option<String>,
    error: Option<String>,
    audio_base64: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCapabilities {
    configured: bool,
    original_clips_available: bool,
    ai_available: bool,
    character_id: Option<String>,
    voice_identity: Option<String>,
    locale: Option<String>,
    reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedVoiceArtifact {
    character_id: String,
    character_generation: u64,
    voice_identity: String,
    transcript: String,
    source: String,
    audio_uri: String,
}

impl VoiceState {
    pub fn discover() -> Self {
        let config_path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("voice-package.local.json");
        let local_config = fs::read_to_string(config_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<LocalVoiceConfig>(&raw).ok());
        let package_dir = env::var_os("ARK_PET_PEPE_VOICE_PACKAGE_DIR")
            .map(PathBuf::from)
            .or_else(|| local_config.as_ref().map(|config| config.package_dir.clone()));
        let python_executable = env::var_os("ARK_PET_PYTHON_EXECUTABLE")
            .map(PathBuf::from)
            .or_else(|| {
                local_config
                    .as_ref()
                    .and_then(|config| config.python_executable.clone())
            });
        let engine_dir = env::var_os("ARK_PET_GPT_SOVITS_ENGINE_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                local_config
                    .as_ref()
                    .and_then(|config| config.engine_dir.clone())
            });
        Self {
            package_dir,
            python_executable,
            engine_dir,
            worker: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    fn validated_profile(&self) -> Result<VoiceProfile, String> {
        let package_dir = self
            .package_dir
            .as_ref()
            .ok_or_else(|| "Pepe voice package is not configured".to_string())?;
        let raw = fs::read_to_string(package_dir.join("voice_profile.json"))
            .map_err(|error| format!("Could not read voice profile: {error}"))?;
        let profile: VoiceProfile = serde_json::from_str(&raw)
            .map_err(|error| format!("Invalid voice profile: {error}"))?;
        if profile.character_id != PEPE_CHARACTER_ID || profile.reference.voice_id != "cn_012" {
            return Err("Voice profile identity does not match the pinned Pepe profile".into());
        }
        Ok(profile)
    }

    fn ai_available(&self) -> bool {
        cfg!(target_os = "windows")
            && self
                .python_executable
                .as_ref()
                .is_some_and(|path| path.is_file())
            && self.engine_dir.as_ref().is_some_and(|path| path.is_dir())
    }

    fn synthesize(
        &self,
        request_id: String,
        text: String,
        character_generation: u64,
    ) -> Result<ResolvedVoiceArtifact, String> {
        if self
            .cancelled
            .lock()
            .map_err(|_| "Voice cancellation state is poisoned".to_string())?
            .remove(&request_id)
        {
            return Err("Voice synthesis was cancelled".into());
        }
        let mut worker_guard = self
            .worker
            .lock()
            .map_err(|_| "Voice worker state is poisoned".to_string())?;
        if worker_guard.is_none() {
            *worker_guard = Some(VoiceWorker::start(self)?);
        }
        if self
            .cancelled
            .lock()
            .map_err(|_| "Voice cancellation state is poisoned".to_string())?
            .remove(&request_id)
        {
            return Err("Voice synthesis was cancelled".into());
        }
        let result = worker_guard
            .as_mut()
            .expect("worker initialized")
            .synthesize(&request_id, &text);
        if result.is_err() {
            if let Some(mut worker) = worker_guard.take() {
                let _ = worker.child.kill();
            }
        }
        let audio_base64 = result?;
        if self
            .cancelled
            .lock()
            .map_err(|_| "Voice cancellation state is poisoned".to_string())?
            .remove(&request_id)
        {
            return Err("Voice synthesis was cancelled".into());
        }
        Ok(ResolvedVoiceArtifact {
            character_id: PEPE_CHARACTER_ID.into(),
            character_generation,
            voice_identity: PEPE_VOICE_IDENTITY.into(),
            transcript: text,
            source: "character-ai".into(),
            audio_uri: format!("data:audio/wav;base64,{audio_base64}"),
        })
    }
}

impl VoiceWorker {
    fn start(state: &VoiceState) -> Result<Self, String> {
        if !state.ai_available() {
            return Err("Pinned Pepe AI voice runtime is unavailable on this platform".into());
        }
        let script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("sidecars/pepe_voice_worker.py");
        let mut child = Command::new(
            state
                .python_executable
                .as_ref()
                .expect("validated Python executable"),
        )
        .arg(script)
        .arg("--package-dir")
        .arg(state.package_dir.as_ref().expect("validated package directory"))
        .arg("--engine-dir")
        .arg(state.engine_dir.as_ref().expect("validated engine directory"))
        // The protocol is UTF-8 on every platform. Pin Python's process-wide
        // mode as a second guard in addition to the worker stream reconfigure.
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("Could not start pinned Pepe voice worker: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Voice worker stdin is unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Voice worker stdout is unavailable".to_string())?;
        let mut worker = Self {
            child,
            stdin: BufWriter::new(stdin),
            stdout: BufReader::new(stdout),
        };
        let ready = worker.read_response()?;
        if ready.response_type != "ready" {
            return Err("Pinned Pepe voice worker did not complete its identity handshake".into());
        }
        Ok(worker)
    }

    fn synthesize(&mut self, request_id: &str, text: &str) -> Result<String, String> {
        serde_json::to_writer(
            &mut self.stdin,
            &serde_json::json!({
                "type": "synthesize",
                "requestId": request_id,
                "text": text,
                "seed": 2026081501_u64,
            }),
        )
        .map_err(|error| format!("Could not encode voice request: {error}"))?;
        self.stdin
            .write_all(b"\n")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("Could not send voice request: {error}"))?;
        let response = self.read_response()?;
        if response.request_id.as_deref() != Some(request_id) {
            return Err("Voice worker response request ID mismatch".into());
        }
        if response.response_type == "error" {
            return Err(response
                .error
                .unwrap_or_else(|| "Voice worker returned an unknown error".into()));
        }
        if response.response_type != "synthesis-complete" {
            return Err("Voice worker returned an unexpected response".into());
        }
        response
            .audio_base64
            .filter(|value| value.len() <= MAX_ORIGINAL_CLIP_BYTES as usize * 2)
            .ok_or_else(|| "Voice worker audio is missing or exceeds the size limit".into())
    }

    fn read_response(&mut self) -> Result<WorkerResponse, String> {
        let mut line = String::new();
        let count = self
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("Could not read voice worker response: {error}"))?;
        if count == 0 {
            return Err("Voice worker exited before responding".into());
        }
        serde_json::from_str(&line)
            .map_err(|error| format!("Voice worker returned invalid JSON: {error}"))
    }
}

#[tauri::command]
pub fn get_voice_capabilities(state: tauri::State<'_, VoiceState>) -> VoiceCapabilities {
    match state.validated_profile() {
        Ok(profile) => {
            let package_dir = state.package_dir.as_ref().expect("validated package directory");
            let original_clips_available = package_dir
                .join("fallback/pepe_voice_cn_source_bundle.zip")
                .is_file()
                && package_dir
                    .join("fallback/cue_transcript_registry.json")
                    .is_file();
            VoiceCapabilities {
                configured: true,
                original_clips_available,
                ai_available: state.ai_available(),
                character_id: Some(profile.character_id),
                voice_identity: Some(PEPE_VOICE_IDENTITY.into()),
                locale: Some(profile.locale),
                reason: None,
            }
        }
        Err(reason) => VoiceCapabilities {
            configured: false,
            original_clips_available: false,
            ai_available: false,
            character_id: None,
            voice_identity: None,
            locale: None,
            reason: Some(reason),
        },
    }
}

#[tauri::command]
pub fn resolve_original_voice_clip(
    state: tauri::State<'_, VoiceState>,
    cue: String,
    locale: String,
    character_id: String,
    voice_identity: String,
    character_generation: u64,
) -> Result<Option<ResolvedVoiceArtifact>, String> {
    if character_id != PEPE_CHARACTER_ID || voice_identity != PEPE_VOICE_IDENTITY {
        return Err("Requested character voice identity is not the pinned Pepe identity".into());
    }
    let profile = state.validated_profile()?;
    if locale != profile.locale {
        return Ok(None);
    }
    let package_dir = state.package_dir.as_ref().expect("validated package directory");
    let registry_raw = fs::read_to_string(package_dir.join("fallback/cue_transcript_registry.json"))
        .map_err(|error| format!("Could not read cue registry: {error}"))?;
    let registry: CueRegistry = serde_json::from_str(&registry_raw)
        .map_err(|error| format!("Invalid cue registry: {error}"))?;
    if registry.character_id != character_id || registry.locale != locale {
        return Err("Cue registry identity does not match the active character".into());
    }
    let Some(record) = registry.records.into_iter().find(|record| {
        record.cue == cue
            && record.locale == locale
            && record.verification_status.starts_with("user_confirmed")
    }) else {
        return Ok(None);
    };
    if record.wav_filename != format!("{}.wav", record.voice_id) {
        return Err("Registered voice ID and WAV filename do not match".into());
    }

    let archive_file = File::open(package_dir.join("fallback/pepe_voice_cn_source_bundle.zip"))
        .map_err(|error| format!("Could not open original voice archive: {error}"))?;
    let mut archive = ZipArchive::new(archive_file)
        .map_err(|error| format!("Invalid original voice archive: {error}"))?;
    let entry_name = format!("char_4058_pepe/original/{}", record.wav_filename);
    let mut entry = archive
        .by_name(&entry_name)
        .map_err(|error| format!("Registered original voice is missing: {error}"))?;
    if entry.size() > MAX_ORIGINAL_CLIP_BYTES {
        return Err("Registered original voice exceeds the playback size limit".into());
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read original voice: {error}"))?;
    let actual_hash = format!("{:x}", Sha256::digest(&bytes));
    if actual_hash != record.wav_sha256 {
        return Err("Registered original voice checksum mismatch".into());
    }

    Ok(Some(ResolvedVoiceArtifact {
        character_id,
        character_generation,
        voice_identity,
        transcript: record.canonical_transcript,
        source: "character-original".into(),
        audio_uri: format!("data:audio/wav;base64,{}", BASE64.encode(bytes)),
    }))
}

#[tauri::command]
pub async fn synthesize_character_voice(
    state: tauri::State<'_, VoiceState>,
    request_id: String,
    text: String,
    locale: String,
    character_id: String,
    voice_identity: String,
    character_generation: u64,
) -> Result<ResolvedVoiceArtifact, String> {
    if character_id != PEPE_CHARACTER_ID || voice_identity != PEPE_VOICE_IDENTITY {
        return Err("Requested character voice identity is not the pinned Pepe identity".into());
    }
    if locale != "zh-CN" || text.trim().is_empty() || text.chars().count() > 256 {
        return Err("Pepe voice synthesis accepts 1-256 Chinese characters".into());
    }
    state.validated_profile()?;
    let owned_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        owned_state.synthesize(request_id, text.trim().to_string(), character_generation)
    })
    .await
    .map_err(|error| format!("Voice worker task failed: {error}"))?
}

#[tauri::command]
pub async fn warm_character_voice(
    state: tauri::State<'_, VoiceState>,
) -> Result<(), String> {
    state.validated_profile()?;
    let owned_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = owned_state
            .worker
            .lock()
            .map_err(|_| "Voice worker state is poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(VoiceWorker::start(&owned_state)?);
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("Voice warmup task failed: {error}"))?
}

#[tauri::command]
pub fn cancel_character_voice(
    state: tauri::State<'_, VoiceState>,
    request_id: String,
) -> Result<(), String> {
    state
        .cancelled
        .lock()
        .map_err(|_| "Voice cancellation state is poisoned".to_string())?
        .insert(request_id);
    Ok(())
}

#[tauri::command]
pub async fn shutdown_character_voice(
    state: tauri::State<'_, VoiceState>,
) -> Result<(), String> {
    let owned_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = owned_state
            .worker
            .lock()
            .map_err(|_| "Voice worker state is poisoned".to_string())?;
        if let Some(mut worker) = guard.take() {
            let _ = worker.child.kill();
            let _ = worker.child.wait();
        }
        owned_state
            .cancelled
            .lock()
            .map_err(|_| "Voice cancellation state is poisoned".to_string())?
            .clear();
        Ok(())
    })
    .await
    .map_err(|error| format!("Voice shutdown task failed: {error}"))?
}
