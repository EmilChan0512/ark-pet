# Phase 2 Requirements: Settings MVP

## Goal

Make the desktop pet suitable for long-running daily use by adding a small,
local-only settings surface. This phase does not add AI, autonomous movement,
cloud services, plugins, updates, additional characters, or third-party API
dependencies.

## Functional scope

- Open and close a real settings panel from the tray `Settings` item.
- Change character scale from 60% to 140%.
- Select a 30 FPS or 60 FPS render cap.
- Enable or disable always-on-top behavior.
- Show or hide the development debug panel.
- Apply every setting immediately without remounting React or reloading Spine.
- Persist settings locally and restore them on the next launch.
- Reset all settings to their defaults.

Character scale is a multiplier applied to the scale in the character manifest.
The default multiplier is `0.8`.

## Defaults

| Setting | Default |
| --- | --- |
| Character scale | 80% |
| FPS cap | 60 |
| Always on top | Enabled |
| Debug panel | Enabled in development, disabled in production |

## Storage and failure behavior

- Store settings under the versioned local-storage key `ark-pet.settings.v1`.
- Phase 5 supersedes the active key with `ark-pet.settings.v2`; the v1 key is
  retained as a documented migration source.
- Validate stored data before use.
- Missing, malformed, incomplete, or unsupported values fall back to defaults.
- Storage failures must not prevent the pet from starting or settings from
  working for the current session.

## Interaction requirements

- Opening settings shows the native window if it is hidden.
- While settings are open, the window must accept pointer input across the UI.
- Closing settings restores normal transparent-area mouse passthrough.
- Reloading the character retains and reapplies current settings.

## Acceptance criteria

1. First launch uses all documented defaults.
2. Valid settings survive WebView reload and application restart.
3. Corrupt or invalid persisted data does not crash startup and uses defaults.
4. Scale changes resize the existing Spine instance immediately.
5. FPS changes update the existing Pixi ticker immediately.
6. Always-on-top changes call the native window API immediately.
7. Debug visibility changes immediately.
8. Tray `Settings` toggles the panel and the panel receives pointer input.
9. Closing the panel restores character-bound hit testing and passthrough.
10. Character reload retains the current settings.
11. Phase 1 reload, interaction, dragging, show/hide, tray, and cleanup behavior
    remains intact.
12. TypeScript build, lint, Tauri native build, and a clean `tauri dev` launch
    pass.
