use image::ImageReader;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File},
    io::{BufReader, Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use zip::ZipArchive;

const MAX_ARCHIVE_SIZE: u64 = 64 * 1024 * 1024;
const MAX_TOTAL_SIZE: u64 = 192 * 1024 * 1024;
const MAX_FILE_SIZE: u64 = 64 * 1024 * 1024;
const MAX_FILES: usize = 256;
const MAX_TEXTURE_DIMENSION: u32 = 4096;
const MAX_RATIO: u64 = 200;
const BUILTIN_ID: &str = "demo";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PackageError {
    code: String,
    message: String,
}

impl PackageError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

type PackageResult<T> = Result<T, PackageError>;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackageManifestV1 {
    schema_version: u32,
    package_id: String,
    package_version: String,
    character_id: String,
    display_name: String,
    author: Option<String>,
    description: Option<String>,
    license: Option<String>,
    homepage: Option<String>,
    character_manifest: String,
    persona: String,
    preview: Option<String>,
    minimum_ark_pet_version: Option<String>,
    content_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Checksums { files: BTreeMap<String, String> }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CharacterManifest {
    id: String,
    name: String,
    skeleton: String,
    atlas: String,
    spine_version: Option<String>,
    animations: BTreeMap<String, String>,
    voice: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledCharacterRecord {
    package_id: String,
    package_version: String,
    character_id: String,
    display_name: String,
    author: Option<String>,
    description: Option<String>,
    content_digest: String,
    archive_digest: String,
    installed_size: u64,
    install_generation: u64,
    resource_root: String,
    character_manifest: String,
    persona: String,
    preview: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PackageInspection {
    inspection_token: String,
    package_id: String,
    package_version: String,
    character_id: String,
    display_name: String,
    author: Option<String>,
    description: Option<String>,
    license: Option<String>,
    homepage: Option<String>,
    installed_size: u64,
    archive_digest: String,
    content_digest: String,
    preview: Option<String>,
    preview_data_url: Option<String>,
    capabilities: Vec<String>,
    warnings: Vec<String>,
    update_kind: String,
}

#[derive(Clone)]
struct PendingInspection {
    source_path: PathBuf,
    staging_path: PathBuf,
    archive_digest: String,
    manifest: PackageManifestV1,
    installed_size: u64,
}

#[derive(Default)]
pub struct CharacterPackageState {
    pending: Mutex<HashMap<String, PendingInspection>>,
}

fn package_error(code: &str, value: impl std::fmt::Display) -> PackageError {
    PackageError::new(code, value.to_string())
}

fn validate_id(value: &str, field: &str) -> PackageResult<()> {
    let valid = (3..=96).contains(&value.len())
        && value.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-'))
        && !value.starts_with(['.', '-'])
        && !value.ends_with(['.', '-'])
        && !value.contains("..")
        && !value.contains("--");
    if valid { Ok(()) } else { Err(PackageError::new("invalid-id", format!("{field} uses an invalid identifier"))) }
}

fn normalized_relative(value: &str) -> PackageResult<PathBuf> {
    if value.is_empty() || value.len() > 240 || value.contains('\\') || value.contains(':') || !value.is_ascii() {
        return Err(PackageError::new("unsafe-path", "Package contains a non-portable path"));
    }
    let path = Path::new(value);
    if path.is_absolute() || path.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err(PackageError::new("unsafe-path", "Package path must be normalized and relative"));
    }
    Ok(path.to_path_buf())
}

fn forbidden_extension(path: &Path) -> bool {
    matches!(path.extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase().as_str(),
        "js" | "mjs" | "cjs" | "wasm" | "exe" | "dll" | "so" | "dylib" | "bat" | "cmd" | "ps1" | "sh" | "py" | "jar" | "msi" | "com" | "scr" | "svg" | "html" | "htm")
}

fn sha256_file(path: &Path) -> PackageResult<String> {
    let metadata = fs::metadata(path).map_err(|e| package_error("source-unavailable", e))?;
    if !metadata.is_file() || metadata.len() > MAX_ARCHIVE_SIZE {
        return Err(PackageError::new("archive-size", "Character Package exceeds the 64 MiB archive limit"));
    }
    let mut input = BufReader::new(File::open(path).map_err(|e| package_error("source-unavailable", e))?);
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(|e| package_error("source-read", e))?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn read_json<T: for<'de> Deserialize<'de>>(root: &Path, relative: &str, code: &str) -> PackageResult<T> {
    let path = root.join(normalized_relative(relative)?);
    let bytes = fs::read(path).map_err(|e| package_error(code, e))?;
    serde_json::from_slice(&bytes).map_err(|e| package_error(code, e))
}

fn canonical_checksum_digest(checksums: &Checksums) -> PackageResult<String> {
    let bytes = serde_json::to_vec(&checksums.files).map_err(|e| package_error("checksum-schema", e))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn validate_cross_references(root: &Path, manifest: &PackageManifestV1, checksums: &Checksums) -> PackageResult<()> {
    let character: CharacterManifest = read_json(root, &manifest.character_manifest, "character-manifest")?;
    if character.id != manifest.character_id || character.name.trim().is_empty() {
        return Err(PackageError::new("character-id-mismatch", "Character manifest identity does not match package.json"));
    }
    if character.voice.is_some() {
        return Err(PackageError::new("unsupported-voice", "Imported Character Package v1 cannot declare a trusted voice identity"));
    }
    if !character.spine_version.as_deref().is_some_and(|value| value.starts_with("3.8")) {
        return Err(PackageError::new("incompatible-spine", "Character Package v1 requires an explicit Spine 3.8 export"));
    }
    let idle = character.animations.get("idle").filter(|v| !v.trim().is_empty())
        .ok_or_else(|| PackageError::new("missing-animation", "Character manifest requires an idle animation"))?;
    let manifest_dir = Path::new(&manifest.character_manifest).parent().unwrap_or(Path::new(""));
    let skeleton_rel = manifest_dir.join(normalized_relative(&character.skeleton)?);
    let atlas_rel = manifest_dir.join(normalized_relative(&character.atlas)?);
    for required in [&skeleton_rel, &atlas_rel] {
        let key = required.to_string_lossy().replace('\\', "/");
        if !checksums.files.contains_key(&key) { return Err(PackageError::new("missing-reference", format!("Referenced file is undeclared: {key}"))); }
    }
    let skeleton = fs::read(root.join(&skeleton_rel)).map_err(|e| package_error("skeleton-read", e))?;
    if skeleton_rel.extension().and_then(|v| v.to_str()) == Some("json") {
        let value: serde_json::Value = serde_json::from_slice(&skeleton).map_err(|e| package_error("skeleton-schema", e))?;
        let version = value.pointer("/skeleton/spine").and_then(|v| v.as_str()).unwrap_or("");
        let animations = value.get("animations").and_then(|v| v.as_object()).ok_or_else(|| PackageError::new("skeleton-schema", "Spine JSON has no animations map"))?;
        if !version.starts_with("3.8") || character.animations.values().any(|name| !animations.contains_key(name)) {
            return Err(PackageError::new("incompatible-skeleton", "Spine version or declared animation map does not match the skeleton"));
        }
    } else {
        let text = String::from_utf8_lossy(&skeleton);
        if !text.contains("3.8") || !text.contains(idle) {
            return Err(PackageError::new("incompatible-skeleton", "Binary skeleton does not expose the required Spine 3.8 identity and idle animation"));
        }
    }
    let atlas = fs::read_to_string(root.join(&atlas_rel)).map_err(|e| package_error("atlas-schema", e))?;
    let atlas_dir = atlas_rel.parent().unwrap_or(Path::new(""));
    let pages: Vec<&str> = atlas.lines().map(str::trim).filter(|line| {
        let lower = line.to_ascii_lowercase();
        !line.contains(':') && (lower.ends_with(".png") || lower.ends_with(".webp"))
    }).collect();
    if pages.is_empty() { return Err(PackageError::new("atlas-schema", "Spine atlas declares no texture pages")); }
    for page in pages {
        let relative = atlas_dir.join(normalized_relative(page)?);
        let key = relative.to_string_lossy().replace('\\', "/");
        if !checksums.files.contains_key(&key) { return Err(PackageError::new("missing-reference", format!("Atlas texture is undeclared: {key}"))); }
        let dimensions = ImageReader::new(std::io::Cursor::new(fs::read(root.join(relative)).map_err(|e| package_error("texture-read", e))?))
            .with_guessed_format().map_err(|e| package_error("texture-format", e))?
            .into_dimensions().map_err(|e| package_error("texture-format", e))?;
        if dimensions.0 > MAX_TEXTURE_DIMENSION || dimensions.1 > MAX_TEXTURE_DIMENSION {
            return Err(PackageError::new("texture-dimensions", "Texture exceeds 4096 x 4096"));
        }
    }
    let persona: serde_json::Value = read_json(root, &manifest.persona, "persona-schema")?;
    if persona.get("version").and_then(|v| v.as_u64()) != Some(1)
        || persona.get("characterId").and_then(|v| v.as_str()) != Some(&manifest.character_id) {
        return Err(PackageError::new("persona-id-mismatch", "Persona v1 identity does not match the package character"));
    }
    let reactions = persona.get("reactions").and_then(|v| v.as_array()).ok_or_else(|| PackageError::new("persona-schema", "Persona requires reactions"))?;
    if reactions.is_empty() || reactions.len() > 128 { return Err(PackageError::new("persona-limit", "Persona must contain 1-128 reactions")); }
    let event_types = ["pet.clicked", "pet.drag-started", "pet.drag-ended", "session.started", "session.first-meeting-today", "session.user-returned", "session.long-active", "time.period-entered"];
    let step_types = ["behavior", "animation", "speak", "wait"];
    let mut reaction_ids = HashSet::new();
    for reaction in reactions {
        let object = reaction.as_object().ok_or_else(|| PackageError::new("persona-schema", "Every reaction must be an object"))?;
        let id = object.get("id").and_then(|v| v.as_str()).filter(|v| !v.is_empty()).ok_or_else(|| PackageError::new("persona-schema", "Reaction id is required"))?;
        if !reaction_ids.insert(id) { return Err(PackageError::new("persona-schema", "Persona contains duplicate reaction ids")); }
        let event = object.get("event").and_then(|v| v.as_str()).unwrap_or("");
        if !event_types.contains(&event) || !object.get("priority").is_some_and(|v| v.is_number()) {
            return Err(PackageError::new("persona-schema", "Reaction event or priority is invalid"));
        }
        let plan = object.get("plan").and_then(|v| v.as_array()).filter(|v| (1..=8).contains(&v.len())).ok_or_else(|| PackageError::new("persona-schema", "Reaction plan requires 1-8 steps"))?;
        for step in plan {
            let step = step.as_object().ok_or_else(|| PackageError::new("persona-schema", "Reaction step must be an object"))?;
            let step_type = step.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if !step_types.contains(&step_type) { return Err(PackageError::new("persona-schema", "Reaction step type is unsupported")); }
            if step_type == "wait" && !step.get("durationMs").and_then(|v| v.as_u64()).is_some_and(|v| v <= 30_000) {
                return Err(PackageError::new("persona-schema", "Reaction wait exceeds 30 seconds"));
            }
            if step_type == "speak" && !step.get("text").and_then(|v| v.as_str()).is_some_and(|v| (1..=256).contains(&v.chars().count())) {
                return Err(PackageError::new("persona-schema", "Reaction speech must contain 1-256 characters"));
            }
        }
    }
    Ok(())
}

fn inspect_archive(source: &Path, staging: &Path) -> PackageResult<(PackageManifestV1, u64, String)> {
    let archive_digest = sha256_file(source)?;
    let file = File::open(source).map_err(|e| package_error("source-unavailable", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| package_error("invalid-archive", e))?;
    if archive.len() > MAX_FILES { return Err(PackageError::new("file-count", "Character Package contains more than 256 entries")); }
    if staging.exists() { fs::remove_dir_all(staging).map_err(|e| package_error("staging-cleanup", e))?; }
    fs::create_dir_all(staging).map_err(|e| package_error("staging-create", e))?;
    let mut seen = HashSet::new();
    let mut total = 0_u64;
    let result = (|| {
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|e| package_error("invalid-entry", e))?;
            let name = entry.name().trim_end_matches('/').to_string();
            if name.is_empty() { continue; }
            let relative = normalized_relative(&name)?;
            let folded = name.to_ascii_lowercase();
            if !seen.insert(folded) { return Err(PackageError::new("case-collision", "Package contains duplicate or case-colliding paths")); }
            if forbidden_extension(&relative) { return Err(PackageError::new("executable-content", format!("Executable content is forbidden: {name}"))); }
            if entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
                return Err(PackageError::new("link-entry", "Symbolic and hard links are forbidden"));
            }
            if entry.is_dir() { fs::create_dir_all(staging.join(relative)).map_err(|e| package_error("staging-write", e))?; continue; }
            if entry.size() > MAX_FILE_SIZE || (entry.compressed_size() > 0 && entry.size() / entry.compressed_size().max(1) > MAX_RATIO) {
                return Err(PackageError::new("archive-bomb", "Package entry exceeds size or compression-ratio limits"));
            }
            total = total.checked_add(entry.size()).ok_or_else(|| PackageError::new("archive-bomb", "Decompressed size overflow"))?;
            if total > MAX_TOTAL_SIZE { return Err(PackageError::new("archive-bomb", "Package exceeds total decompressed size limit")); }
            let destination = staging.join(relative);
            if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|e| package_error("staging-write", e))?; }
            let mut output = File::create(destination).map_err(|e| package_error("staging-write", e))?;
            std::io::copy(&mut entry, &mut output).map_err(|e| package_error("staging-write", e))?;
            output.flush().map_err(|e| package_error("staging-write", e))?;
        }
        let package: PackageManifestV1 = read_json(staging, "package.json", "package-schema")?;
        if package.schema_version != 1 { return Err(PackageError::new("schema-version", "Only Character Package schemaVersion 1 is supported")); }
        validate_id(&package.package_id, "packageId")?;
        validate_id(&package.character_id, "characterId")?;
        if package.character_id == BUILTIN_ID || package.package_id == BUILTIN_ID { return Err(PackageError::new("reserved-id", "The built-in demo identity is reserved")); }
        Version::parse(&package.package_version).map_err(|_| PackageError::new("invalid-version", "packageVersion must be SemVer"))?;
        if let Some(minimum) = &package.minimum_ark_pet_version {
            let required = Version::parse(minimum).map_err(|_| PackageError::new("invalid-version", "minimumArkPetVersion must be SemVer"))?;
            let current = Version::parse(env!("CARGO_PKG_VERSION")).expect("crate version is semver");
            if required > current { return Err(PackageError::new("incompatible-app", "Package requires a newer Ark Pet version")); }
        }
        if package.display_name.trim().is_empty() || package.display_name.chars().count() > 80
            || package.author.as_ref().is_some_and(|v| v.chars().count() > 120)
            || package.description.as_ref().is_some_and(|v| v.chars().count() > 500) {
            return Err(PackageError::new("metadata-limit", "Package metadata is empty or exceeds length limits"));
        }
        let checksums: Checksums = read_json(staging, "checksums.json", "checksum-schema")?;
        if canonical_checksum_digest(&checksums)? != package.content_digest.to_ascii_lowercase() {
            return Err(PackageError::new("content-digest", "contentDigest does not match the canonical checksum manifest"));
        }
        let extracted: HashSet<String> = seen.iter().filter(|name| *name != "package.json" && *name != "checksums.json").cloned().collect();
        let declared: HashSet<String> = checksums.files.keys().map(|v| v.to_ascii_lowercase()).collect();
        if extracted != declared { return Err(PackageError::new("undeclared-files", "Payload files and checksums.json do not match exactly")); }
        for (relative, expected) in &checksums.files {
            let path = staging.join(normalized_relative(relative)?);
            let bytes = fs::read(path).map_err(|e| package_error("missing-payload", e))?;
            let actual = format!("{:x}", Sha256::digest(bytes));
            if actual != expected.to_ascii_lowercase() { return Err(PackageError::new("checksum-mismatch", format!("Checksum mismatch: {relative}"))); }
        }
        for reference in [&package.character_manifest, &package.persona] {
            if !checksums.files.contains_key(reference) { return Err(PackageError::new("missing-reference", format!("Undeclared package reference: {reference}"))); }
        }
        if let Some(preview) = &package.preview {
            if !checksums.files.contains_key(preview) { return Err(PackageError::new("missing-reference", "Preview is undeclared")); }
            let lower = preview.to_ascii_lowercase();
            if !(lower.ends_with(".png") || lower.ends_with(".webp")) { return Err(PackageError::new("preview-format", "Preview must be PNG or WebP")); }
            let bytes = fs::read(staging.join(normalized_relative(preview)?)).map_err(|e| package_error("preview-format", e))?;
            if bytes.len() > 4 * 1024 * 1024 { return Err(PackageError::new("preview-size", "Preview exceeds 4 MiB")); }
            let dimensions = ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|e| package_error("preview-format", e))?
                .into_dimensions().map_err(|e| package_error("preview-format", e))?;
            if dimensions.0 > MAX_TEXTURE_DIMENSION || dimensions.1 > MAX_TEXTURE_DIMENSION { return Err(PackageError::new("preview-dimensions", "Preview exceeds 4096 x 4096")); }
        }
        validate_cross_references(staging, &package, &checksums)?;
        Ok(package)
    })();
    match result {
        Ok(package) => Ok((package, total, archive_digest)),
        Err(error) => { let _ = fs::remove_dir_all(staging); Err(error) }
    }
}

fn package_root(app: &tauri::AppHandle) -> PackageResult<PathBuf> {
    app.path().app_data_dir().map(|path| path.join("characters")).map_err(|e| package_error("storage-root", e))
}

fn catalog_path(root: &Path) -> PathBuf { root.join("catalog.json") }

fn read_catalog(root: &Path) -> Vec<InstalledCharacterRecord> {
    let path = catalog_path(root);
    let backup = root.join("catalog.previous.json");
    if !path.exists() && backup.exists() { let _ = fs::rename(&backup, &path); }
    let Ok(bytes) = fs::read(&path) else { return Vec::new(); };
    let Ok(mut records) = serde_json::from_slice::<Vec<InstalledCharacterRecord>>(&bytes) else {
        let _ = fs::rename(&path, root.join("catalog.corrupt.json"));
        return Vec::new();
    };
    records.retain(|record| {
        root.join(&record.package_id).join(&record.package_version).is_dir()
            && record.character_id != BUILTIN_ID
    });
    records.sort_by(|a, b| a.display_name.cmp(&b.display_name).then(a.package_id.cmp(&b.package_id)));
    records
}

fn write_catalog(root: &Path, records: &[InstalledCharacterRecord]) -> PackageResult<()> {
    fs::create_dir_all(root).map_err(|e| package_error("catalog-write", e))?;
    let temporary = root.join("catalog.next.json");
    let bytes = serde_json::to_vec_pretty(records).map_err(|e| package_error("catalog-write", e))?;
    let mut output = File::create(&temporary).map_err(|e| package_error("catalog-write", e))?;
    output.write_all(&bytes).and_then(|_| output.sync_all()).map_err(|e| package_error("catalog-write", e))?;
    let current = catalog_path(root);
    let backup = root.join("catalog.previous.json");
    if backup.exists() { fs::remove_file(&backup).map_err(|e| package_error("catalog-write", e))?; }
    if current.exists() { fs::rename(&current, &backup).map_err(|e| package_error("catalog-write", e))?; }
    if let Err(error) = fs::rename(&temporary, &current) {
        if backup.exists() { let _ = fs::rename(&backup, &current); }
        return Err(package_error("catalog-write", error));
    }
    if backup.exists() { fs::remove_file(backup).map_err(|e| package_error("catalog-write", e))?; }
    Ok(())
}

#[tauri::command]
pub fn inspect_character_package(app: tauri::AppHandle, state: tauri::State<'_, CharacterPackageState>, path: String) -> PackageResult<PackageInspection> {
    let source = PathBuf::from(path);
    if source.extension().and_then(|v| v.to_str()).map(|v| v.eq_ignore_ascii_case("arkpet")) != Some(true) {
        return Err(PackageError::new("file-extension", "Select a .arkpet Character Package"));
    }
    let root = package_root(&app)?;
    let staging_root = root.join(".staging");
    fs::create_dir_all(&staging_root).map_err(|e| package_error("staging-create", e))?;
    let source_digest = sha256_file(&source)?;
    let staging = staging_root.join(&source_digest);
    let (manifest, installed_size, archive_digest) = inspect_archive(&source, &staging)?;
    let existing = read_catalog(&root).into_iter().find(|record| record.package_id == manifest.package_id);
    let update_kind = match existing {
        None => "new",
        Some(ref record) if record.package_version == manifest.package_version && record.content_digest == manifest.content_digest => "identical",
        Some(ref record) if Version::parse(&manifest.package_version).ok() > Version::parse(&record.package_version).ok() => "upgrade",
        Some(_) => "conflict",
    }.to_string();
    let token = archive_digest.clone();
    let preview_data_url = manifest.preview.as_ref().and_then(|preview| {
        let bytes = fs::read(staging.join(preview)).ok()?;
        let mime = if preview.to_ascii_lowercase().ends_with(".webp") { "image/webp" } else { "image/png" };
        Some(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
    });
    state.pending.lock().map_err(|_| PackageError::new("inspection-state", "Inspection state is unavailable"))?.insert(token.clone(), PendingInspection {
        source_path: source, staging_path: staging, archive_digest: archive_digest.clone(), installed_size, manifest: PackageManifestV1 {
            schema_version: manifest.schema_version, package_id: manifest.package_id.clone(), package_version: manifest.package_version.clone(),
            character_id: manifest.character_id.clone(), display_name: manifest.display_name.clone(), author: manifest.author.clone(), description: manifest.description.clone(),
            license: manifest.license.clone(), homepage: manifest.homepage.clone(), character_manifest: manifest.character_manifest.clone(), persona: manifest.persona.clone(),
            preview: manifest.preview.clone(), minimum_ark_pet_version: manifest.minimum_ark_pet_version.clone(), content_digest: manifest.content_digest.clone(),
        },
    });
    Ok(PackageInspection {
        inspection_token: token, package_id: manifest.package_id, package_version: manifest.package_version, character_id: manifest.character_id,
        display_name: manifest.display_name, author: manifest.author, description: manifest.description, license: manifest.license, homepage: manifest.homepage,
        installed_size, archive_digest, content_digest: manifest.content_digest, preview: manifest.preview, preview_data_url,
        capabilities: vec!["spine-3.8".into(), "persona-v1".into(), "text-dialogue".into()], warnings: Vec::new(), update_kind,
    })
}

fn commit_install(root: &Path, pending: PendingInspection) -> PackageResult<InstalledCharacterRecord> {
    let mut catalog = read_catalog(&root);
    if catalog.iter().any(|record| record.character_id == pending.manifest.character_id && record.package_id != pending.manifest.package_id) {
        return Err(PackageError::new("character-conflict", "characterId is already installed by another package"));
    }
    if let Some(existing) = catalog.iter().find(|record| record.package_id == pending.manifest.package_id) {
        if existing.package_version == pending.manifest.package_version {
            if existing.content_digest == pending.manifest.content_digest {
                let _ = fs::remove_dir_all(&pending.staging_path);
                return Ok(existing.clone());
            }
            return Err(PackageError::new("digest-conflict", "The same package version has a different digest"));
        }
        if Version::parse(&pending.manifest.package_version).unwrap() < Version::parse(&existing.package_version).unwrap() {
            return Err(PackageError::new("downgrade", "Character Package downgrades are not allowed"));
        }
    }
    let package_dir = root.join(&pending.manifest.package_id);
    let final_dir = package_dir.join(&pending.manifest.package_version);
    fs::create_dir_all(&package_dir).map_err(|e| package_error("install-create", e))?;
    if final_dir.exists() { return Err(PackageError::new("install-conflict", "Install directory already exists without a matching catalog record")); }
    fs::rename(&pending.staging_path, &final_dir).map_err(|e| package_error("install-commit", e))?;
    let generation = catalog.iter().map(|v| v.install_generation).max().unwrap_or(0) + 1;
    let record = InstalledCharacterRecord {
        package_id: pending.manifest.package_id.clone(), package_version: pending.manifest.package_version.clone(), character_id: pending.manifest.character_id.clone(),
        display_name: pending.manifest.display_name, author: pending.manifest.author, description: pending.manifest.description,
        content_digest: pending.manifest.content_digest, archive_digest: pending.archive_digest, installed_size: pending.installed_size,
        install_generation: generation, resource_root: final_dir.to_string_lossy().to_string(), character_manifest: pending.manifest.character_manifest,
        persona: pending.manifest.persona, preview: pending.manifest.preview,
    };
    catalog.retain(|value| value.package_id != record.package_id);
    catalog.push(record.clone());
    catalog.sort_by(|a, b| a.display_name.cmp(&b.display_name).then(a.package_id.cmp(&b.package_id)));
    if let Err(error) = write_catalog(&root, &catalog) { let _ = fs::remove_dir_all(&final_dir); return Err(error); }
    Ok(record)
}

#[tauri::command]
pub fn install_character_package(app: tauri::AppHandle, state: tauri::State<'_, CharacterPackageState>, inspection_token: String) -> PackageResult<InstalledCharacterRecord> {
    let pending = state.pending.lock().map_err(|_| PackageError::new("inspection-state", "Inspection state is unavailable"))?
        .remove(&inspection_token).ok_or_else(|| PackageError::new("inspection-token", "Inspection token is missing or expired"))?;
    if sha256_file(&pending.source_path)? != pending.archive_digest { return Err(PackageError::new("source-changed", "Character Package changed after inspection")); }
    commit_install(&package_root(&app)?, pending)
}

#[tauri::command]
pub fn list_installed_characters(app: tauri::AppHandle) -> PackageResult<Vec<InstalledCharacterRecord>> {
    Ok(read_catalog(&package_root(&app)?))
}

fn remove_installed(root: &Path, package_id: &str) -> PackageResult<()> {
    validate_id(&package_id, "packageId")?;
    if package_id == BUILTIN_ID { return Err(PackageError::new("builtin-immutable", "The built-in demo character cannot be removed")); }
    let canonical_root = fs::canonicalize(&root).map_err(|e| package_error("storage-root", e))?;
    let target = root.join(&package_id);
    let canonical_target = fs::canonicalize(&target).map_err(|e| package_error("package-missing", e))?;
    if canonical_target.parent() != Some(canonical_root.as_path()) { return Err(PackageError::new("unsafe-removal", "Removal target escaped the character package root")); }
    let mut catalog = read_catalog(&root);
    if !catalog.iter().any(|record| record.package_id == package_id) { return Err(PackageError::new("package-missing", "Installed package was not found")); }
    fs::remove_dir_all(&canonical_target).map_err(|e| package_error("remove-failed", e))?;
    catalog.retain(|record| record.package_id != package_id);
    write_catalog(&root, &catalog)
}

#[tauri::command]
pub fn remove_character_package(app: tauri::AppHandle, package_id: String) -> PackageResult<()> {
    remove_installed(&package_root(&app)?, &package_id)
}

fn cleanup_staging(root: &Path) -> PackageResult<u32> {
    let staging = root.join(".staging");
    if !staging.exists() { return Ok(0); }
    let count = fs::read_dir(&staging).map_err(|e| package_error("staging-cleanup", e))?.count() as u32;
    fs::remove_dir_all(&staging).map_err(|e| package_error("staging-cleanup", e))?;
    fs::create_dir_all(&staging).map_err(|e| package_error("staging-cleanup", e))?;
    Ok(count)
}

#[tauri::command]
pub fn cleanup_character_staging(app: tauri::AppHandle) -> PackageResult<u32> {
    cleanup_staging(&package_root(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{codecs::png::PngEncoder, ExtendedColorType, ImageEncoder};
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn temporary(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("ark-pet-{label}-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()))
    }

    fn png() -> Vec<u8> {
        let mut bytes = Vec::new();
        PngEncoder::new(&mut bytes).write_image(&[120, 80, 200, 255], 1, 1, ExtendedColorType::Rgba8).unwrap();
        bytes
    }

    fn write_fixture(path: &Path, package_id: &str, spine_version: &str, bad_checksum: bool, extra: Option<(&str, Vec<u8>)>) {
        let character_id = "com.example.character";
        let mut payload = BTreeMap::<String, Vec<u8>>::new();
        payload.insert("character/manifest.json".into(), serde_json::to_vec(&serde_json::json!({
            "id": character_id, "name": "Fixture", "skeleton": "character.json", "atlas": "character.atlas",
            "spineVersion": spine_version, "animations": { "idle": "idle" }
        })).unwrap());
        payload.insert("character/persona.json".into(), serde_json::to_vec(&serde_json::json!({
            "version": 1, "characterId": character_id, "displayName": "Fixture",
            "reactions": [{ "id": "fixture.click", "event": "pet.clicked", "priority": 1, "plan": [{ "type": "wait", "durationMs": 1 }] }]
        })).unwrap());
        payload.insert("character/character.json".into(), serde_json::to_vec(&serde_json::json!({
            "skeleton": { "spine": spine_version }, "animations": { "idle": {} }
        })).unwrap());
        payload.insert("character/character.atlas".into(), b"texture.png\nsize: 1,1\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nregion\n  rotate: false\n".to_vec());
        payload.insert("character/texture.png".into(), png());
        let mut checksums = BTreeMap::new();
        for (name, bytes) in &payload { checksums.insert(name.clone(), format!("{:x}", Sha256::digest(bytes))); }
        if bad_checksum { checksums.insert("character/texture.png".into(), "00".repeat(32)); }
        let checksum_document = Checksums { files: checksums };
        let package = serde_json::json!({
            "schemaVersion": 1, "packageId": package_id, "packageVersion": "1.0.0", "characterId": character_id,
            "displayName": "Fixture", "characterManifest": "character/manifest.json", "persona": "character/persona.json",
            "contentDigest": canonical_checksum_digest(&checksum_document).unwrap()
        });
        let file = File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        writer.start_file("package.json", options).unwrap(); writer.write_all(&serde_json::to_vec(&package).unwrap()).unwrap();
        writer.start_file("checksums.json", options).unwrap(); writer.write_all(&serde_json::to_vec(&checksum_document.files).unwrap().into_iter().fold(b"{\"files\":".to_vec(), |mut out, byte| { out.push(byte); out })).unwrap();
        // Finish the small wrapper without relying on map serialization order.
        writer.write_all(b"}").unwrap();
        for (name, bytes) in payload { writer.start_file(name, options).unwrap(); writer.write_all(&bytes).unwrap(); }
        if let Some((name, bytes)) = extra { writer.start_file(name, options).unwrap(); writer.write_all(&bytes).unwrap(); }
        writer.finish().unwrap();
    }

    #[test]
    fn rejects_unsafe_and_executable_paths() {
        for value in ["../evil", "/absolute", "C:/drive", "a\\b", "a/../b"] { assert_eq!(normalized_relative(value).unwrap_err().code, "unsafe-path"); }
        assert!(forbidden_extension(Path::new("character/hook.js")));
        assert!(forbidden_extension(Path::new("character/native.dll")));
        assert!(!forbidden_extension(Path::new("character/texture.png")));
    }

    #[test]
    fn validates_conservative_ids() {
        assert!(validate_id("com.example.pet", "id").is_ok());
        for value in ["Upper.Case", "../pet", "a", "pet_name"] { assert!(validate_id(value, "id").is_err()); }
    }

    #[test]
    fn canonical_checksum_digest_is_stable() {
        let mut files = BTreeMap::new();
        files.insert("character/a".into(), "00".repeat(32));
        files.insert("character/b".into(), "11".repeat(32));
        let first = canonical_checksum_digest(&Checksums { files: files.clone() }).unwrap();
        let second = canonical_checksum_digest(&Checksums { files }).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn validates_a_complete_v1_archive() {
        let root = temporary("valid"); fs::create_dir_all(&root).unwrap();
        let archive = root.join("valid.arkpet"); let staging = root.join("staging");
        write_fixture(&archive, "com.example.package", "3.8.99", false, None);
        let (manifest, size, digest) = inspect_archive(&archive, &staging).unwrap();
        assert_eq!(manifest.character_id, "com.example.character");
        assert!(size > 0); assert_eq!(digest.len(), 64); assert!(staging.join("character/persona.json").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_checksum_mismatch_and_cleans_staging() {
        let root = temporary("checksum"); fs::create_dir_all(&root).unwrap();
        let archive = root.join("bad.arkpet"); let staging = root.join("staging");
        write_fixture(&archive, "com.example.package", "3.8.99", true, None);
        assert_eq!(inspect_archive(&archive, &staging).unwrap_err().code, "checksum-mismatch");
        assert!(!staging.exists()); fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_reserved_identity_incompatible_spine_and_executable_payloads() {
        for (label, package_id, spine, extra, expected) in [
            ("reserved", "demo", "3.8.99", None, "reserved-id"),
            ("spine", "com.example.package", "4.2.0", None, "incompatible-spine"),
            ("script", "com.example.package", "3.8.99", Some(("character/hook.js", b"alert(1)".to_vec())), "executable-content"),
        ] {
            let root = temporary(label); fs::create_dir_all(&root).unwrap();
            let archive = root.join("bad.arkpet"); let staging = root.join("staging");
            write_fixture(&archive, package_id, spine, false, extra);
            assert_eq!(inspect_archive(&archive, &staging).unwrap_err().code, expected);
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn commits_idempotently_removes_safely_and_cleans_abandoned_staging() {
        let root = temporary("install"); fs::create_dir_all(&root).unwrap();
        let source = root.join("source.arkpet");
        write_fixture(&source, "com.example.package", "3.8.99", false, None);
        let staging = root.join(".staging/first");
        let (manifest, installed_size, archive_digest) = inspect_archive(&source, &staging).unwrap();
        let pending = PendingInspection { source_path: source.clone(), staging_path: staging, archive_digest: archive_digest.clone(), manifest, installed_size };
        let record = commit_install(&root, pending).unwrap();
        assert_eq!(record.package_id, "com.example.package");
        assert_eq!(read_catalog(&root).len(), 1);
        assert!(root.join("com.example.package/1.0.0/character/persona.json").is_file());

        let second_staging = root.join(".staging/second");
        let (manifest, installed_size, archive_digest) = inspect_archive(&source, &second_staging).unwrap();
        let repeated = commit_install(&root, PendingInspection { source_path: source, staging_path: second_staging.clone(), archive_digest, manifest, installed_size }).unwrap();
        assert_eq!(repeated.install_generation, record.install_generation);
        assert!(!second_staging.exists());

        let abandoned = root.join(".staging/abandoned"); fs::create_dir_all(&abandoned).unwrap(); fs::write(abandoned.join("partial"), b"partial").unwrap();
        assert_eq!(cleanup_staging(&root).unwrap(), 1);
        remove_installed(&root, "com.example.package").unwrap();
        assert!(read_catalog(&root).is_empty());
        assert!(!root.join("com.example.package").exists());
        assert_eq!(remove_installed(&root, "demo").unwrap_err().code, "builtin-immutable");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupt_catalog_is_quarantined() {
        let root = temporary("catalog"); fs::create_dir_all(&root).unwrap();
        fs::write(root.join("catalog.json"), b"not json").unwrap();
        assert!(read_catalog(&root).is_empty());
        assert!(root.join("catalog.corrupt.json").is_file());
        fs::remove_dir_all(root).unwrap();
    }
}
