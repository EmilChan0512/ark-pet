# Phase 5 Requirements: Ambient Behavior Modules

## Goal

Deliver the first visible autonomous behavior slice on top of the Phase 4
engine without coupling scheduling, behavior selection, animation playback, or
native window movement. The pet may walk, sit, and sleep while idle, and every
action remains deterministic in tests and immediately interruptible by users.

No network, AI, Wiki API, cross-monitor pathfinding, application-window
avoidance, notifications, or dynamic third-party plugins are included.

## Architecture additions

### Behavior module contribution

Ambient features contribute definitions through a module factory. The runtime
adapter composes core and ambient definitions; `BehaviorEngine` must not gain
IDs or conditionals for walk, sit, or sleep.

A module contribution declares:

- registered behavior definitions;
- required narrow ports;
- behavior IDs and priorities;
- optional eligibility based on available animations;
- no global timers or platform imports.

### Ambient scheduler

`AmbientScheduler` is pure TypeScript and ticker-driven. It owns scheduling
state but never executes animation or window APIs. It receives:

- monotonic `now` values;
- injected normalized random values;
- current active behavior snapshot;
- callbacks that request registered behavior IDs.

It supports enable, disable, pause, resume, user activity, and destroy. These
operations are idempotent. It creates no `setTimeout`, `setInterval`, or
independent animation-frame loop.

### Platform ports

- `AnimationPort`: query and play named character animations.
- `WindowMotionPort`: obtain current window geometry and monitor work area, and
  request coalesced physical-position updates.
- Existing diagnostics, clock, and random ports remain technology-neutral.

Tauri imports stay in `src/services`; Spine imports stay in
`src/pet/character`. Ambient behavior modules depend only on ports.

## Visible behavior

### Idle scheduling

- After 20–45 seconds of inactivity, select a short walk or sitting behavior.
- Selection uses injected randomness and registered eligibility.
- Completing or skipping an ambient action returns through a fresh idle
  activation and schedules a new delay.

### Walking

- Use manifest `walk`, falling back to `drag`, then `idle`.
- Choose a destination 120–320 physical pixels away on the horizontal axis.
- Move at 60–90 physical pixels per second using elapsed monotonic time.
- Clamp destinations to the current monitor work area, accounting for native
  window size.
- Face the actual horizontal movement direction using Phase 3 rules.
- Clamp frame gaps to prevent jumps after suspend or debugger pauses.
- If window or monitor geometry is unavailable, skip walking safely.

### Sitting

- Use manifest `sit` when available.
- Remain seated for 8–20 seconds, then complete.
- If `sit` is unavailable, the scheduler excludes it rather than entering a
  false sitting state.

### Sleeping

- After 3 minutes without user activity, sleep takes precedence over ambient
  walk/sit selection.
- Use manifest `sleep` and remain active until interrupted.
- If `sleep` is unavailable, remain idle and retry only after new user activity.

## User priority and lifecycle

Pointer down, drag, click interaction, settings, hide, reload, disabling
autonomy, and destroy cancel ambient behavior before their own effects run.

- Opening settings pauses scheduling; closing starts a fresh idle delay.
- Hiding pauses scheduling; showing starts a fresh idle delay.
- Reload cancels movement before destroying the character.
- Drag and click count as user activity and reset sleep timing.
- An interrupted behavior is never resumed from stale progress.
- At most one engine behavior and one coalesced native move may be in flight.

## Manifest extension

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

All new fields are optional for existing character packages.

## Settings and migration

Persist:

```ts
{
  autonomousBehavior: boolean
}
```

- Default: `true`.
- Disabling cancels ambient work immediately and keeps core interaction active.
- Enabling starts a fresh idle delay rather than an immediate action.
- Migrate valid Phase 2 settings without losing scale, FPS, always-on-top, or
  debug visibility.
- Corrupt old or new storage still falls back safely to defaults.

## Documentation and comments

- Add an ambient-module architecture guide linked from README.
- Document extension steps and port ownership for future maintainers and AI
  agents.
- Add TSDoc to public scheduler/module contracts.
- Comment coordinate systems, elapsed-time clamping, cancellation ownership,
  and coalescing invariants; avoid comments that only restate code.

## Acceptance criteria

1. Ambient scheduler and modules contain no React, Pixi, Spine, Tauri, DOM, or
   browser-global dependency.
2. Fake-clock/random tests cover delay bounds, deterministic selection, sleep
   priority, pause/resume, disable, interruption, and destroy.
3. Ambient definitions register without modifying `BehaviorEngine`.
4. Walk, sit, and sleep eligibility follows manifest animation availability.
5. Walking uses physical screen coordinates, stays in the monitor work area,
   faces correctly, and does not jump after large frame gaps.
6. User input interrupts every ambient state before manual behavior starts.
7. Settings and hide pause scheduling and stop movement; resume starts fresh.
8. Settings migration preserves every existing value and adds the default
   autonomy value.
9. Repeated ambient cycles, enable/disable, settings, hide/show, and reload do
   not accumulate timers, ticker callbacks, move requests, or Spine instances.
10. Existing reload, tray, settings, dragging, direction, passthrough, and error
    containment behavior remains intact.
11. Debug state exposes scheduler status and active behavior ID.
12. README and architecture docs explain how to add the next behavior module.
13. Unit tests, TypeScript build, lint, native Tauri build, and real runtime
    smoke tests pass.
