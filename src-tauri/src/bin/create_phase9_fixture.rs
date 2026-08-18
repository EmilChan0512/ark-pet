use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, env, fs, io::Write, path::PathBuf};
use zip::{write::SimpleFileOptions, ZipWriter};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
    let source = repository.join("public/characters/demo");
    let output = env::args().nth(1).map(PathBuf::from).unwrap_or_else(|| repository.join("target/phase9-fixtures/pepe-fixture.arkpet"));
    if let Some(parent) = output.parent() { fs::create_dir_all(parent)?; }

    let character_id = "dev.arkpet.pepe-fixture.character";
    let package_id = "dev.arkpet.pepe-fixture";
    let mut manifest: Value = serde_json::from_slice(&fs::read(source.join("manifest.json"))?)?;
    manifest["id"] = json!(character_id);
    manifest["name"] = json!("Pepe Fixture");
    manifest.as_object_mut().unwrap().remove("voice");
    let mut persona: Value = serde_json::from_slice(&fs::read(source.join("persona.json"))?)?;
    persona["characterId"] = json!(character_id);
    persona["displayName"] = json!("Pepe Fixture");

    let mut payload = BTreeMap::<String, Vec<u8>>::new();
    payload.insert("character/manifest.json".into(), serde_json::to_vec_pretty(&manifest)?);
    payload.insert("character/persona.json".into(), serde_json::to_vec_pretty(&persona)?);
    for name in ["build_char_4058_pepe.skel", "build_char_4058_pepe.atlas", "build_char_4058_pepe.png"] {
        payload.insert(format!("character/{name}"), fs::read(source.join(name))?);
    }
    let checksums: BTreeMap<String, String> = payload.iter().map(|(name, bytes)| (name.clone(), format!("{:x}", Sha256::digest(bytes)))).collect();
    let content_digest = format!("{:x}", Sha256::digest(serde_json::to_vec(&checksums)?));
    let package = json!({
        "schemaVersion": 1,
        "packageId": package_id,
        "packageVersion": "1.0.0",
        "characterId": character_id,
        "displayName": "Pepe Fixture",
        "author": "Ark Pet development fixture",
        "description": "Deterministic local package used to verify Phase 9 import, switching, persistence, and removal.",
        "characterManifest": "character/manifest.json",
        "persona": "character/persona.json",
        "preview": "character/build_char_4058_pepe.png",
        "minimumArkPetVersion": "0.1.0",
        "contentDigest": content_digest
    });

    let mut writer = ZipWriter::new(fs::File::create(&output)?);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("package.json", options)?; writer.write_all(&serde_json::to_vec_pretty(&package)?)?;
    writer.start_file("checksums.json", options)?; writer.write_all(&serde_json::to_vec_pretty(&json!({ "files": checksums }))?)?;
    for (name, bytes) in payload { writer.start_file(name, options)?; writer.write_all(&bytes)?; }
    writer.finish()?.sync_all()?;
    println!("{}", output.display());
    Ok(())
}
