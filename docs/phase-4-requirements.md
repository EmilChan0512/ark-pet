# Phase 4 Requirements: Autonomous Behavior MVP

## Goal

Make the pet feel alive while the user is not interacting with it. Phase 4
adds a local, bounded behavior scheduler that can rest, sit, sleep, and roam on
the current monitor. All behavior remains deterministic under test, immediately
interruptible, and independent of network services or AI APIs.

## Scope

- Add autonomous behavior states for walking, sitting, and sleeping.
- Use the existing Spine animations `Move`, `Sit`, `Sleep`, and `Relax`.
- Move the native pet window smoothly during autonomous walking.
- Use Phase 3 facing rules so walking direction matches horizontal movement.
- Keep the pet inside the current monitor's usable work area.
- Interrupt autonomous behavior immediately for click, drag, settings, hide,
  reload, or quit actions.
- Add a persisted `Autonomous behavior` setting, enabled by default.
- Pause scheduling while the pet is hidden or the settings panel is open.
- Resume from idle after an interruption rather than continuing a stale action.

Phase 4 does not add path finding around application windows, cross-monitor
travel, speech, notifications, AI decisions, cloud services, or new assets.

## Behavior model

### States

The runtime state model expands to:

- `idle`: loop the manifest idle animation and wait for the next behavior.
- `walking`: loop the walk animation and move toward a bounded destination.
- `sitting`: play or loop the sit animation for a bounded duration.
- `sleeping`: loop the sleep animation after extended user inactivity.
- Existing `loading`, `interacting`, `dragging`, and `error` states remain.

### Priority

Behavior priority, highest first:

1. shutdown and runtime cleanup;
2. user dragging;
3. user interaction;
4. settings, hide, show, and character reload commands;
5. autonomous behavior;
6. idle animation.

A higher-priority event cancels the active autonomous action and all of its
timers or animation-frame callbacks before transitioning.

### Timing defaults

- Begin an ambient action after 20–45 seconds without user input.
- Choose between a short walk and sitting using a weighted local random source.
- Walk 120–320 physical pixels at 60–90 physical pixels per second.
- Sit for 8–20 seconds, then return to idle.
- Enter sleep after 3 minutes without user input.
- Sleep continues until user input or a runtime command wakes the pet.

The scheduler must accept injected clock and random functions so timing and
behavior selection can be tested without real waits or flaky randomness.

## Motion and screen safety

- Query the current monitor and use its work area rather than total screen size.
- Compute destinations in physical screen coordinates, matching Tauri window
  positions and cursor positions.
- Account for the native window size when clamping a destination.
- Never teleport the window as part of autonomous movement.
- Animate window position from elapsed time, not frame count.
- Clamp large frame gaps so suspend/resume cannot cause a large jump.
- Cancel movement when the monitor cannot be resolved instead of guessing.
- Preserve the last valid facing direction for vertical or negligible movement.

## Animation contract

Character manifests add optional autonomous animation names:

```json
{
  "animations": {
    "idle": "Relax",
    "interact": "Interact",
    "drag": "Move",
    "walk": "Move",
    "sit": "Sit",
    "sleep": "Sleep"
  }
}
```

Fallback rules:

- `walk` falls back to `drag`, then `idle`.
- Missing `sit` skips the sitting behavior.
- Missing `sleep` keeps the pet idle instead of entering a false sleeping state.
- A missing optional animation must never put the runtime into `error`.

## Settings contract

Phase 4 extends persisted settings with:

```ts
{
  autonomousBehavior: boolean
}
```

- Default: `true`.
- Turning it off cancels the current autonomous action immediately and returns
  to idle.
- Turning it on schedules a fresh idle delay; it does not start walking at once.
- Older Phase 2 settings must migrate without losing scale, FPS,
  always-on-top, or debug visibility values.

## Lifecycle and cleanup

- At most one autonomous action and one scheduler timer may be active.
- Character reload cancels behavior before destroying the current Spine object.
- Hide pauses behavior and show begins a fresh idle delay.
- Opening settings pauses behavior and closing it begins a fresh idle delay.
- Runtime destruction removes every timeout and animation-frame callback.
- Repeated enable/disable and hide/show cycles must not multiply callbacks.

## Acceptance criteria

1. With autonomous behavior enabled, an idle pet selects a valid ambient action
   after the configured delay.
2. Autonomous walking uses `Move`, faces the destination, moves smoothly, and
   stays inside the current monitor work area.
3. Sitting uses `Sit` and returns to idle after its bounded duration.
4. Three minutes of inactivity enters `Sleep`; click or drag wakes immediately.
5. Dragging during any autonomous action cancels it before drag movement starts.
6. Opening settings or hiding the pet stops movement and pauses scheduling.
7. Disabling autonomous behavior immediately returns the pet to idle and
   prevents new autonomous actions.
8. Existing settings migrate with their previous values intact.
9. Missing optional animations fall back or skip without entering `error`.
10. Fake-clock tests cover selection, interruption, sleep, pause/resume, and
    cleanup without real-time waits.
11. Repeated scheduler cycles leave one Spine canvas, one character instance,
    and no accumulating timers or ticker callbacks.
12. Phase 1–3 reload, tray, settings, drag smoothness, direction, passthrough,
    and cleanup behavior remains intact.
13. TypeScript build, lint, native Tauri build, and a real runtime smoke test
    pass.
