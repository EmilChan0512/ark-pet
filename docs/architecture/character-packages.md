# Character Package System

## Trust model

Character Package v1 (`.arkpet`) is a ZIP-compatible, declarative container. It is untrusted local input and never receives JavaScript, WebAssembly, native, shell, Python, DOM, network, Tauri, or process capabilities. Imported packages cannot declare a trusted character voice. Unsupported voice capability degrades to visible persona text.

The webview chooses a local file with the Tauri dialog plugin. Rust performs inspection, extraction, hashing, schema checks, and storage. React receives inert metadata, a bounded raster preview data URL, an opaque inspection token, and validated installed records. Installation confirmation is bound to the complete archive SHA-256; Rust hashes the source again before commit.

## V1 layout

```text
package.json
checksums.json
character/
  manifest.json
  persona.json
  character.skel or character.json
  character.atlas
  textures referenced by the atlas
  media/preview.png              # optional PNG/WebP
```

`package.json` fields are `schemaVersion: 1`, `packageId`, `packageVersion`, `characterId`, `displayName`, optional bounded author/description/license/homepage, `characterManifest`, `persona`, optional `preview`, optional `minimumArkPetVersion`, and `contentDigest`.

IDs are 3–96 lowercase ASCII letters, numbers, dots, or hyphens. Versions are SemVer. `demo` is reserved. All paths are normalized forward-slash relative paths. V1 rejects unknown package fields so a future capability cannot be silently interpreted by an older runtime.

`checksums.json` has this shape:

```json
{"files":{"character/manifest.json":"<sha256>","character/persona.json":"<sha256>"}}
```

It lists every payload file and neither control document. Keys are serialized as a sorted map; `contentDigest` is SHA-256 of the compact JSON serialization of that sorted `files` object. The inspection token separately binds the complete source archive, including both control documents.

## Validation pipeline

Rust validates while extracting into `<app-data>/characters/.staging/<archive-sha256>`:

1. Require `.arkpet`, a regular source file, archive size ≤64 MiB, ≤256 entries.
2. Reject absolute, traversal, drive, device/colon, backslash, non-ASCII, duplicate, case-colliding, link, executable, script, native-library, SVG, and HTML paths.
3. Bound each file to 64 MiB, cumulative output to 192 MiB, and compression ratio to 200:1 while streaming output.
4. Parse strict package/checksum schemas, conservative IDs, SemVer, minimum app version, and bounded plain-text metadata.
5. Require an exact payload/checksum set and verify every SHA-256 plus the canonical content digest.
6. Cross-check package, character manifest, and persona identities; reject imported voice metadata.
7. Require explicit Spine 3.8, a declared idle animation, declared skeleton/atlas, resolvable atlas pages, and PNG/WebP dimensions ≤4096².
8. Validate persona v1, 1–128 unique reactions, known event/step vocabulary, bounded plan length/waits/speech, then rely on Phase 8 capability eligibility for optional animation or behavior steps.
9. Return inert review metadata and keep staging private until explicit confirmation.

Any failure removes the inspection staging directory and returns a stable error code plus safe message. Startup removes abandoned staging directories.

## Atomic storage and catalog recovery

Installed content lives only below:

```text
<app-data>/characters/<package-id>/<semver>/...
<app-data>/characters/catalog.json
```

Confirmation re-hashes the source. A validated staging directory is renamed into the version directory, then a synced `catalog.next.json` replaces the catalog using `catalog.previous.json` as a crash rollback. Catalog write failure removes the newly committed version. A missing current catalog restores the previous file; malformed records are quarantined/omitted. The built-in `demo` entry is composed in TypeScript and therefore cannot disappear through catalog corruption.

Same ID/version/digest is idempotent. Same version/different digest conflicts. Downgrades are rejected. An upgrade commits into a new version directory and leaves the previous version available until later safe cleanup. Removal canonicalizes the package directory and requires its direct parent to be the canonical app-owned character root before recursive deletion.

## Runtime switching

`select-character`, install, and removal mutations pass through `RuntimeCommandCoordinator`. Selection commands coalesce latest-wins while the coordinator serializes active work. `PetRuntime` cancels pointer state, reaction generation, speech/voice, behavior, time/session sources, and old animation callbacks before loading.

Persona is fetched and validated before the target Spine resource transaction. `CharacterManager` creates the target separately and destroys the previous GPU resources only after the target loads. Character generation increments only after that commit. A failed target preserves the previous manager resource, restores idle/session scheduling, and reports the selection failure. Successful readiness persists `activeCharacterId` through settings v5. Missing persisted IDs repair to `demo`.

Removing the active imported package first selects `demo`, waits for that switch, then invokes native removal. Installed manifests are exposed only through Tauri's scoped app-owned asset protocol.

## Creating a development package

Generate the deterministic visible Phase 9 fixture from the bundled demo assets:

```bash
cargo run --manifest-path src-tauri/Cargo.toml --bin create_phase9_fixture
```

The output is `target/phase9-fixtures/pepe-fixture.arkpet`. It uses a unique development package/character identity, removes voice metadata, recomputes every payload checksum and the canonical content digest, and is suitable for import, restart persistence, switching, and removal smoke tests.

For a real creator package:

1. Export one Spine 3.8 character and verify every manifest animation exists.
2. Keep all atlas pages and references relative under `character/`.
3. Create a Phase 8 persona using only bounded declarative steps.
4. Do not include audio trust configuration, code, models, plugins, links, SVG, or HTML.
5. Hash every payload into a lexically sorted checksum map, compute `contentDigest`, then archive the two root control files and payload.
6. Import through the product review flow; never copy directly into app data.

## Testing and extension rules

Native tests generate small archives deterministically and cover a valid package, unsafe paths/extensions, conservative IDs, canonical digest stability, checksum failure with staging cleanup, reserved identity, incompatible Spine, and executable payload rejection. Frontend tests cover settings migration and latest-wins selection commands. Full acceptance also runs frontend tests/build/lint, Rust tests/check, and diff checks.

Future schema versions must fail closed in v1. Add a new version as a separate parser and explicit capability policy; never widen v1 to accept executable hooks or implicit trust.
