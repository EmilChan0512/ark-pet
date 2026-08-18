# Ambient Behavior Modules

This guide describes the Phase 5 extension layer built on the behavior engine.
Read [Behavior Engine Architecture](behavior-engine.md) first.

## Separation of responsibilities

```text
AmbientScheduler       decides when and which ID to request
BehaviorEngine         owns activation, priority, cancellation, and failures
Ambient definitions    implement one action through narrow ports
Runtime adapter        composes definitions and connects application lifecycle
Platform services      implement Spine animation and Tauri window effects
```

The scheduler never moves a window or plays an animation. A behavior never
chooses the next behavior. Platform services never decide lifecycle priority.

## Adding an ambient behavior

1. Add a stable namespaced ID.
2. Define only the ports needed by the behavior.
3. Implement a definition factory returning fresh per-activation state.
4. Add manifest capability fields when the behavior needs character assets.
5. Register the definition through the ambient module contribution.
6. Add the behavior to policy candidates only when eligible.
7. Test normal completion, every interruption path, port failure, and cleanup.
8. Update Phase requirements and this guide when contracts change.

Do not add behavior-specific branches to `BehaviorEngine` or import
`PetRuntime` into a definition.

## Time ownership

All timing uses the existing Pixi ticker's monotonic timestamp. The scheduler
and behavior instances store deadlines or previous timestamps and receive
`update(now)`. They do not create timers. This guarantees one update owner and
makes tests advance instantly with fake numeric time.

Large elapsed gaps must be clamped at the action boundary. Laptop sleep,
debugger pauses, and a blocked native call must not teleport the window.

## Coordinate ownership

Tauri cursor, window, monitor work area, and window size values are physical
pixels. Autonomous motion stays entirely in that space. Pixi and DOM logical
coordinates are not accepted by `WindowMotionPort`.

The native adapter coalesces position requests. Behavior updates may arrive
faster than Tauri IPC; only the newest target should remain queued, otherwise
the pet visibly trails stale positions.

## Cancellation ownership

The behavior engine owns `AbortSignal` and calls `exit` once. Each module owns
cleanup for subscriptions or in-flight port operations it started. Platform
ports must tolerate cancellation and late completion without mutating a newer
activation.

Scheduler pause and disable prevent new ambient requests. The runtime adapter
also cancels any active ambient definition through the engine. Both halves are
necessary: one prevents future work, the other stops current work.
