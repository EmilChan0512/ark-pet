# Phase 9 Requirements: Character Package System

## Goal

Phase 9 turns the single built-in Pepe character into a safe, local,
multi-character product without turning character packages into executable
plugins.

The phase introduces a versioned Character Package format, native package
validation and installation, an installed-character catalog, atomic character
switching, and a small management UI. A package composes capabilities already
owned by the runtime:

```text
Local .arkpet file
    -> Native package validator
    -> Staged, atomic install
    -> InstalledCharacterCatalog
    -> CharacterManager + CharacterPersonaLoader
    -> Existing behavior / reaction / speech boundaries
```

The primary product outcome is that a user can import a trusted local package,
preview its metadata, install it, switch to it, restart the app with that
selection preserved, and remove it without breaking the built-in fallback.

Phase 9 is not a marketplace, mod scripting system, model installer, or remote
content platform.

## Product principles

1. **Characters are declarative data, never code.** A package may contain
   manifests, Spine assets, textures, persona data, and approved static media.
   It may not contain JavaScript, WebAssembly, native libraries, executables,
   shell commands, Python, dynamic imports, or lifecycle hooks.
2. **Validate before trust.** Package structure, paths, sizes, hashes, schemas,
   runtime compatibility, references, and required capabilities are validated
   in staging before an installed catalog changes.
3. **Install atomically.** An interrupted or failed import leaves neither a
   half-installed character nor a corrupt catalog.
4. **Built-in recovery is permanent.** The bundled `demo` character remains an
   immutable fallback and cannot be removed or overwritten by an imported
   package.
5. **Switch through existing lifecycle owners.** Character replacement must
   cancel behavior, reactions, speech, pointer state, and stale async work
   through the Phase 4–8 boundaries.
6. **Identity is stable.** Package ID, character ID, persona ID, and optional
   voice identity are distinct, validated identifiers. Display names are not
   identity keys.
7. **Local first.** Phase 9 adds no marketplace, package discovery service,
   account, telemetry, or automatic network download.
8. **Failure is recoverable.** Invalid packages produce actionable errors;
   invalid persisted selections fall back safely to `demo`.

## Existing architecture to preserve

Phase 9 must preserve these invariants:

- `PetRuntime` remains the composition root.
- `RuntimeCommandCoordinator` remains the ordered entrance for import,
  switching, removal, reload, visibility, settings, and shutdown intent.
- `CharacterManager` owns loaded Spine character resources; React does not.
- `BehaviorEngine` remains the single active behavior lifecycle owner.
- `ReactionEngine` consumes a validated `CharacterPersona`; packages do not
  call the engine directly.
- `SpeechSessionCoordinator` remains the speech lifecycle owner.
- Character changes invalidate character generation, reaction generation,
  pending voice identity, animation callbacks, and package-backed resource
  handles.
- Core catalog and package-policy code must not import React, Pixi, Spine, DOM,
  browser globals, or concrete Tauri APIs.

Do not expand `CharacterManager` into a file installer. Native package storage
and validation are a separate boundary; `CharacterManager` consumes only a
resolved, validated character descriptor.

## Package format

Introduce Character Package v1 with a dedicated extension such as `.arkpet`.
The file is a ZIP-compatible archive, but the product should refer to it as a
Character Package rather than exposing archive implementation details.

Recommended root layout:

```text
package.json
character/
  manifest.json
  persona.json
  character.skel
  character.atlas
  textures/
    character.png
  media/                 # optional approved static assets only
    preview.png
checksums.json
```

Every referenced file must remain inside the package root. The archive must
not contain absolute paths, `..` traversal, drive prefixes, alternate data
streams, device paths, hard links, symbolic links, or case-colliding paths.

### Package manifest

A v1 package manifest should express at least:

```ts
interface CharacterPackageManifestV1 {
  schemaVersion: 1
  packageId: string
  packageVersion: string
  characterId: string
  displayName: string
  author?: string
  description?: string
  license?: string
  homepage?: string
  characterManifest: string
  persona: string
  preview?: string
  minimumArkPetVersion?: string
  contentDigest: string
}
```

Required semantics:

- IDs use a documented lowercase, ASCII, reverse-domain-safe or similarly
  conservative grammar and have bounded length.
- `packageVersion` is valid SemVer. Version comparison must not be inferred
  from filenames or modification time.
- `characterId` is globally unique among installed packages. Imported packages
  may not use reserved built-in IDs such as `demo`.
- All paths are normalized relative paths and point to declared files.
- `contentDigest` covers the canonical checksum manifest. That manifest covers
  every payload file except the two root control documents (`package.json` and
  `checksums.json`) to avoid a self-referential digest; undeclared payload files
  are rejected. The native inspection token separately binds the complete
  source archive digest, including both control documents.
- Optional human-readable fields are length-bounded and rendered as plain text,
  never HTML or Markdown with active links.
- Unknown required capabilities or a future schema version fail clearly.
  Unknown optional metadata may be retained only when doing so is safe.

Exact field names may change during implementation, but versioning, identity,
relative references, integrity, and compatibility must remain explicit.

## Supported content in v1

Character Package v1 supports only:

- one Spine 3.8 character compatible with the pinned
  `@pixi-spine/all-3.8` runtime;
- one existing character manifest using the Phase 1–5 animation map;
- one Phase 8 `persona.json` with bounded declarative reaction plans;
- atlas and texture assets required by the character;
- one optional static raster preview image (for example PNG or WebP, not SVG);
- bounded, non-executable metadata.

The implementation must validate that:

- skeleton export major/minor matches the runtime before activation;
- atlas page references resolve to declared texture files;
- required `idle` animation and every manifest animation exist;
- persona character ID matches the package character ID;
- persona animation and behavior references are supported, or individual
  reactions are marked ineligible according to the Phase 8 rules;
- decompressed image dimensions, file counts, and total sizes remain within
  documented limits.

Suggested initial limits, adjustable only with evidence:

```text
archive size                 64 MiB
total decompressed size     192 MiB
file count                    256
single file                  64 MiB
texture dimension          4096 x 4096
persona reactions             128
```

Compression-ratio and cumulative-output checks must stop ZIP bombs while
extracting; checking only the archive header is insufficient.

## Voice and media boundary

Phase 7 voice identity rules remain stronger than package convenience.

- Imported packages cannot declare a system voice, generic voice, executable
  synthesis engine, model download, Python environment, native library, or
  arbitrary resolver configuration.
- The pinned Pepe AI identity cannot be reassigned to another character.
- Imported audio must not silently become a trusted character voice.
- If optional original cue clips are included in v1, they are text-only
  companions unless a separate, explicit trust and transcript-verification
  path is implemented and tested. Omitting imported audio entirely is an
  acceptable Phase 9 implementation choice.
- Missing or unsupported voice capability degrades to the package persona's
  visible text.

Production voice package signing, creator verification, voice cloning, and
model distribution remain deferred.

## Native package boundary

Package file access and installed storage belong to Rust/Tauri, not the
frontend.

Recommended native operations:

```text
inspect_character_package(path/token) -> PackageInspection
install_character_package(inspectionToken) -> InstalledCharacterRecord
list_installed_characters() -> InstalledCharacterRecord[]
remove_character_package(packageId) -> outcome
repair_character_catalog() -> outcome       # development/recovery only
```

The exact command API may use a file-dialog token rather than accepting an
arbitrary path from the webview. Frontend input must not select arbitrary
install destinations or escape the app-owned data directory.

Native responsibilities:

- acquire user-selected local files through the narrowest Tauri dialog
  capability;
- stream archive validation and hashing with bounded memory;
- extract into a unique app-owned staging directory;
- validate schemas and cross-file references before commit;
- fsync/close required files where supported;
- atomically rename staging into a versioned install directory;
- atomically update the catalog only after installation succeeds;
- clean abandoned staging directories on startup;
- report structured error codes without leaking unnecessary absolute paths;
- never follow links or execute package content.

Installation must not weaken the webview CSP or grant general filesystem or
shell access.

## Installed catalog

Replace the hard-coded `loadCharacterCatalog()` entry with a catalog composed
from two sources:

1. immutable built-in records shipped with the app;
2. validated installed records resolved by the native package service.

An installed record should contain only metadata needed to discover and load a
validated package: package/character identity, version, install generation,
resolved app-owned resource root or opaque resource URL, preview metadata, and
validation status. It must not duplicate the full persona or Spine data.

Catalog requirements:

- deterministic ordering;
- duplicate package and character IDs rejected;
- one active version per package in v1;
- catalog writes atomic and recoverable;
- missing directories and invalid records quarantined or omitted;
- corruption cannot remove the built-in fallback;
- uninstall of the active package first switches safely to `demo`;
- catalog and active selection survive restart.

Do not scan arbitrary user directories on every startup. Scan only the
app-owned package root, and prefer a bounded persisted catalog with explicit
repair logic.

## Import and management UX

Add a compact character-management surface reachable from settings.

Minimum flow:

1. User chooses **Import Character Package**.
2. Native validation runs before installation.
3. A review screen shows display name, author, version, declared capabilities,
   approximate installed size, preview, and validation warnings.
4. User explicitly confirms installation or replacement of an older version.
5. Installation completes atomically.
6. The character appears in a selector and may be activated.

Management must support:

- listing built-in and installed characters;
- distinguishing built-in, installed, update available from local file, and
  invalid/quarantined states;
- switching the active character;
- removing an inactive imported character with confirmation;
- removing the active imported character by first switching to `demo`;
- actionable errors for incompatible Spine version, invalid persona, ID
  conflict, bad checksum, unsafe path, oversized package, and insufficient
  disk space;
- keyboard-accessible controls and plain-text metadata rendering.

Phase 9 does not need drag-and-drop import if the system file picker is safer
and simpler.

## Character switching lifecycle

Add explicit runtime intent such as:

```ts
{ type: 'select-character'; characterId: string }
```

Selection must pass through `RuntimeCommandCoordinator`. A switch is a bounded
transaction:

1. close acceptance of redundant/coalesced selection commands as appropriate;
2. cancel pointer/drag state;
3. invalidate the active reaction generation;
4. cancel active and queued character speech;
5. pause/cancel active behavior and ambient scheduling;
6. load and validate the target manifest, Spine resources, and persona;
7. increment character generation only for the committed target;
8. apply scale/facing/settings and publish the new catalog selection;
9. enter a fresh idle lifecycle and resume eligible systems;
10. persist the active character ID after successful readiness.

If target loading fails, the runtime must destroy partial resources and either
restore the previous ready character or load `demo`. It must never leave a
manifest/persona mismatch or allow late audio from the previous identity.

Rapid A -> B -> C selection must settle deterministically on the last accepted
command. Late A/B loads cannot replace C.

## Settings and migration

Add the minimum setting with clear product value:

```ts
activeCharacterId: string // default 'demo'
```

Migrate the Phase 8 settings schema deterministically to the next version while
preserving personality, speech, autonomous behavior, scale, FPS, debug, and
window settings. Invalid or unavailable active IDs fall back to `demo` and are
repaired on the next successful settings write.

Package catalog data does not belong inside the general settings JSON.

## Update, replacement, and removal rules

- Installing the same package ID and version is an idempotent no-op when the
  digest matches; a differing digest is a conflict, not a silent overwrite.
- A newer local version requires explicit confirmation.
- Downgrade is rejected by default; a development-only override may be added
  without becoming production behavior.
- Update validation occurs in a new staging/version directory. The active
  version remains usable until the new version commits.
- Old versions may be removed only after no runtime resource references them.
- Removal is recoverable where practical and never recursively targets an
  unresolved path.
- Built-in files are never updated or deleted by package commands.

Automatic update checks and network package URLs are deferred.

## Diagnostics and recovery

Development diagnostics should expose:

- active character and package IDs/versions;
- character generation;
- catalog source and count;
- last inspection/install/switch outcome;
- validation error code and safe message;
- staging cleanup status;
- resolved capabilities, not arbitrary native paths.

Provide test fixtures for valid, malformed, traversal, duplicate, oversized,
checksum-mismatched, incompatible, and interrupted packages. Do not commit
large proprietary assets just to test the installer; generate minimal fixtures
deterministically.

## Tests

Tests must not require a real system picker, production character archive,
network, GPU voice model, or interactive Tauri window.

### Schema and archive validation

- valid v1 package and canonical checksum set;
- missing/unknown schema version;
- duplicate IDs and reserved built-in IDs;
- absolute/traversal/drive/device/case-collision paths;
- symlink/hard-link rejection;
- undeclared, missing, and checksum-mismatched files;
- file count, compressed/decompressed size, ratio, and texture limits;
- invalid SemVer and incompatible minimum app/runtime version;
- malformed atlas, manifest, and persona cross-references;
- executable/script/native-library content rejection.

### Catalog and installation

- stage then atomic commit;
- failure leaves existing catalog/install untouched;
- startup cleans abandoned staging safely;
- identical reinstall is idempotent;
- conflicting digest and downgrade are rejected;
- update retains old version until commit;
- corrupted catalog preserves built-in fallback;
- removal cannot escape the app-owned package root.

### Runtime product scenarios

1. Import a valid local package and activate it.
2. Restart restores the selected installed character.
3. Invalid selection falls back to `demo`.
4. A -> B -> C rapid switching commits only C.
5. Switching cancels old behavior, reaction, animation callback, speech, and
   voice artifact generations.
6. Failed target load restores a safe ready character without leaked Pixi or
   Spine resources.
7. Removing the active package switches to `demo` before deletion.
8. Imported persona reactions use existing Phase 8 policy and cannot execute
   unsupported actions.
9. Imported voice metadata cannot bypass Phase 7 identity restrictions.
10. Phase 8 settings migrate deterministically with `activeCharacterId`.

## Documentation

Implementation must add an architecture guide such as:

```text
docs/architecture/character-packages.md
```

Document package layout/versioning, trust model, native/frontend boundary,
validation pipeline, storage layout, catalog recovery, switching generations,
update/removal lifecycle, fixture creation, and how a creator builds a valid
package without adding executable content.

Update `README.md` status only after the Phase 9 implementation and full
validation are complete.

## Performance and resource rules

- Hash and extract streams; do not read a 64 MiB package into one frontend
  buffer.
- Installation work must not block the render ticker.
- Catalog loading is bounded and does not recursively scan unrelated paths.
- Only the active character keeps Spine textures/skeleton data loaded.
- Preview images use bounded dimensions and lazy loading.
- Switching destroys previous GPU and audio resources after replacement is
  safely committed.
- No package content is fetched from the network.

## Security and privacy

- Package content is untrusted local input.
- Prevent ZIP Slip, ZIP bombs, path confusion, Unicode/case collisions,
  symlink traversal, checksum substitution, and TOCTOU between inspection and
  install.
- Bind confirmation to an inspection token/digest; revalidate if the source
  file changes.
- Render metadata as inert text and images through safe app-owned resource
  URLs.
- Packages receive no Tauri capability, network access, DOM access, filesystem
  handle, process access, or runtime callback.
- Do not upload package identity, author, asset hashes, or install history.
- Removal and staging cleanup resolve and verify the final app-owned target
  before recursive deletion.

## Explicitly deferred

Do **not** implement in Phase 9:

- online marketplace, search, ratings, accounts, purchases, or telemetry;
- remote URLs, automatic download, or background update checks;
- package signing PKI, creator identity verification, or trust badges;
- arbitrary plugins, scripts, JavaScript, WebAssembly, native libraries, or
  lifecycle hooks;
- generic behavior/reaction scripting beyond the Phase 8 bounded vocabulary;
- multiple simultaneous pets or multi-character audio mixing;
- Spine 4.x or automatic asset conversion;
- Live2D, VRM, video, HTML characters, or other renderer families;
- voice cloning, model packages, executable TTS engines, or automatic model
  installation;
- production character-authoring editor;
- cloud sync of installed characters or settings.

## Implementation order

Codex should implement Phase 9 in this order unless repository evidence
requires a documented adjustment:

1. Preserve and baseline Phase 4–8 lifecycle tests.
2. Finalize Character Package v1 schemas, IDs, limits, and fixture generator.
3. Implement pure archive-entry, checksum, compatibility, and cross-reference
   validators with adversarial tests.
4. Implement the native staging/atomic-install boundary and cleanup tests.
5. Add installed catalog storage, built-in composition, and recovery.
6. Refactor `CharacterManager` to consume validated catalog descriptors without
   owning installation.
7. Add generation-safe runtime `select-character` orchestration.
8. Load package personas through the Phase 8 boundary and enforce capability
   eligibility.
9. Add settings migration and active-character persistence.
10. Add import review, selector, removal, and diagnostics UI.
11. Add architecture and creator documentation.
12. Run frontend tests/build/lint, Rust tests/check, package adversarial tests,
    smoke switching, and `git diff --check` before stopping.

## Acceptance criteria

Phase 9 is complete only when all of the following are true:

1. A versioned, documented `.arkpet` v1 format represents one Spine character
   and one validated persona without executable content.
2. Native validation rejects unsafe paths, links, bombs, undeclared files,
   checksum mismatches, incompatible runtimes, invalid schemas, and bounded
   resource violations before catalog mutation.
3. Installation is staged and atomic; interruption cannot corrupt an existing
   character or catalog.
4. Built-in `demo` is immutable, always discoverable, and the fallback for
   corrupt catalog or invalid selection.
5. Users can inspect, confirm, install, select, restart with, and remove a local
   package through a clear management UI.
6. Character switching uses the runtime command boundary and invalidates stale
   behavior, reaction, speech, animation, voice, and asset completions.
7. Rapid selection commits only the last accepted target; failure restores a
   safe ready character.
8. Package persona data reuses the Phase 8 reaction engine and cannot bypass
   capability checks or create executable behavior.
9. Imported voice metadata cannot weaken the Phase 7 pinned-identity and
   text-only fallback guarantees.
10. Settings migrate deterministically and persist a valid active character ID
    separately from package catalog data.
11. Package operations remain inside the app-owned data root and grant no
    general filesystem, shell, process, DOM, or network capability.
12. Tests cover adversarial archives, atomic recovery, lifecycle cancellation,
    resource cleanup, and product scenarios without large proprietary assets.
13. `pnpm test`, `pnpm build`, `pnpm lint`, Rust tests, `cargo check`, and
    `git diff --check` all pass.
14. `docs/architecture/character-packages.md` is sufficient for a future agent
    to implement a v1 creator/installer without relying on chat history.

## Delivery expectation for Codex

Codex should treat this document as the Phase 9 execution contract.

Do not stop after defining a ZIP schema or character selector. Deliver the
native trust boundary, atomic installer, installed catalog, safe switching,
settings migration, management UX, adversarial tests, recovery behavior, and
architecture documentation together.

When convenience conflicts with package isolation, Phase 4–8 lifecycle
ownership, or Phase 7 voice identity, preserve the stronger safety invariant.
