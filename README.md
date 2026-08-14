# Tauri Spine Desktop Pet

Transparent cross-platform desktop pet bootstrap built with Tauri 2, React, TypeScript, Vite, PixiJS 7, and a Spine 3.8-compatible Pixi runtime path.

This MVP focuses on:

- transparent always-on-top desktop window
- Pet Runtime isolated from React
- PixiJS renderer lifecycle management
- Spine manifest loading and runtime validation
- state-driven animation control
- desktop dragging
- mouse passthrough switching
- tray menu
- debug overlay
- placeholder fallback when real Spine assets are not available

## Compatibility

- Tauri CLI: `2.11.4`
- Tauri Rust crate: `2.11.5`
- `@tauri-apps/api`: `2.11.1`
- `pixi.js`: `7.4.3`
- `@pixi-spine/all-3.8`: `4.0.6`

Rules used by this bootstrap:

- Do not use deprecated `pixi-spine` or `spine-pixi`.
- Current workspace is intentionally switched away from the original `spine-pixi-v8` / Spine 4.2 route.
- The integrated Pepe package exports `Spine 3.8.99`, so the project now uses a 3.8-compatible runtime path.
- Spine export version must still match the runtime `major.minor`.
- Version mismatch or malformed assets must raise a clear `Character Load Error`.


## Requirements

- Node.js 20+
- pnpm 10+
- Rust stable toolchain
- macOS or Windows desktop environment

Rust must be available on `PATH`. In this environment that means `~/.cargo/bin` must be exported before running Tauri commands.

## Development

```bash
pnpm install
pnpm tauri dev
```

If Rust is installed via `rustup` but not on your shell path yet:

```bash
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/rustup/bin:$PATH"
pnpm tauri dev
```

## Architecture

```text
Tauri
  -> NativeWindowService
    -> PetRuntime
      -> PixiRenderer (PixiJS 7)
        -> SpineCharacter (3.8 runtime path)
```

- `src/app`: React shell, controls, debug UI
- `src/pet`: runtime, state machine, interactions, renderer, character loading
- `src/services/tauri.ts`: Tauri JS API boundary
- `src-tauri/src`: minimal native bootstrap and plugin registration

Architecture maintenance guides:

- [Behavior engine](docs/architecture/behavior-engine.md): lifecycle
  invariants, dependency boundaries, extension steps, and testing strategy.
- [Phase 4 requirements](docs/phase-4-requirements.md): architecture-first
  acceptance scope before autonomous features are enabled.
- [Ambient behavior modules](docs/architecture/ambient-behaviors.md): scheduler,
  module, time, coordinate, and cancellation ownership for Phase 5.
- [Phase 5 requirements](docs/phase-5-requirements.md): first autonomous
  behavior modules built on the Phase 4 engine.

React does not own Pixi or Spine lifecycle. `PetRuntime` runs independently and React only mounts the host element plus UI panels.

## Character Format

Characters live under `public/characters/*`.

Example:

```text
public/
  characters/
    demo/
      manifest.json
      character.json or character.skel
      character.atlas
      textures...
```

Example manifest:

```json
{
  "id": "demo",
  "name": "Demo",
  "skeleton": "character.json",
  "atlas": "character.atlas",
  "scale": 0.5,
  "nativeFacing": "right",
  "animations": {
    "idle": "Idle",
    "interact": "Touch",
    "drag": "Move"
  }
}
```

Current workspace now includes a real asset package for Pepe under `public/characters/demo/`.
The supplied package exports `Spine 3.8.99`, and the project has been migrated to a
3.8-compatible runtime path so the character can load.

## Current MVP Behavior

- Loads `public/characters/demo/manifest.json`
- Attempts to validate and load real Spine 3.8 assets
- Includes the provided Pepe package from `char_4058_pepe/默认-基建/package`
- Falls back to a Pixi placeholder pet with explicit error details when assets are missing or invalid
- Provides persisted scale, FPS, always-on-top, and debug visibility settings
- Matches the `Move` animation facing to physical drag direction
- Routes idle, interaction, and drag lifecycles through the documented behavior
  engine foundation
- Schedules local, interruptible walking, sitting, and sleeping behavior through
  registered ambient modules
- Shows an optional debug panel in development
- Provides tray actions for show, hide, reload, settings, and quit

## Notes

- On macOS, transparent desktop pet windows require `macOSPrivateApi: true`.
- This project uses a transparent undecorated window with `alwaysOnTop`, `skipTaskbar`, and `incognito`.
- The integrated atlas declared a `624x624` page while the provided texture was `416x416`, so the local
  runtime copy of the PNG was resized to the atlas page dimensions to make the package loadable.

## Status

Phase 1–3 runtime behavior is integrated. Phase 4 establishes the documented,
tested behavior engine, and Phase 5 adds the first modular ambient behaviors.
