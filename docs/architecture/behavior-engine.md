# Behavior Engine Architecture

This document is the maintenance entry point for `src/pet/behavior`. Read it
before adding a behavior or changing lifecycle code.

## Why this layer exists

`PetRuntime` originally handled input, state transitions, animations, native
window movement, tray commands, and cleanup directly. That is acceptable for a
small MVP, but autonomous actions would multiply timers and interruption paths.
The behavior engine provides one lifecycle owner before those features arrive.

The engine is deliberately small. It is not a generic workflow framework and
does not discover code dynamically. The application composition root registers
trusted definitions and supplies their capabilities through typed ports.

## Non-negotiable invariants

1. There is zero or one active behavior.
2. Every activation receives a new behavior instance and `AbortSignal`.
3. An entered instance receives `exit` at most once.
4. A newer request or cancellation invalidates every older asynchronous enter.
5. Lower-priority requests cannot replace higher-priority behavior unless a
   lifecycle transition explicitly uses `force`.
6. Extension failures are reported and contained; diagnostics failures are
   ignored by design.
7. Destroy is idempotent and no later request may activate behavior.
8. The core folder has no React, Pixi, Spine, Tauri, DOM, or browser-global
   dependency.

If a change weakens one of these invariants, update the Phase 4 requirements and
tests in the same commit and explain why.

## Lifecycle sequence

```text
request(id)
  -> registry lookup
  -> eligibility check
  -> priority check
  -> abort + exit previous activation
  -> create a fresh instance
  -> enter(signal)
  -> active
  -> update(now) from the existing runtime ticker
  -> exit(reason)
```

Requests are intentionally allowed to overlap while `enter` is awaiting. A
manual drag must not wait for a slow future ambient behavior. The monotonically
increasing generation is a logical cancellation token: only the latest
generation is allowed to finish entering.

`AbortSignal` tells extension code to stop its own asynchronous work. The
generation check protects engine state even when extension code ignores that
signal. Both mechanisms are required.

## Priority versus forced transitions

Priority handles competing requests. Manual drag can replace interaction, and
future ambient behavior cannot replace either.

`force` is reserved for explicit lifecycle transitions that intentionally move
down the priority ladder—for example, drag release returning to idle. Policies
and ambient behavior modules must never use it.

## Adding a behavior

1. Define the smallest port interface for required capabilities. Do not pass
   `PetRuntime`, a Pixi application, or a Tauri window into core behavior code.
2. Create a `BehaviorDefinition` with a stable namespaced ID and documented
   priority.
3. Return a fresh per-run instance from `create`.
4. Put mutable run state inside that instance.
5. Observe `AbortSignal` in every asynchronous operation.
6. Release timers, subscriptions, and motion callbacks in `exit` regardless of
   exit reason.
7. Register the definition in a composition adapter.
8. Add tests for normal completion, interruption, failure, and repeated cleanup.

Example shape:

```ts
const walkBehavior: BehaviorDefinition<WalkPorts> = {
  id: 'ambient.walk',
  priority: 20,
  tags: ['ambient'],
  isEligible: (ports) => ports.animation.has('Move'),
  create: (ports) => {
    let unsubscribe: (() => void) | null = null
    return {
      enter(signal) {
        unsubscribe = ports.motion.start(signal)
      },
      exit() {
        unsubscribe?.()
        unsubscribe = null
      },
    }
  },
}
```

## Where platform code belongs

- Core contracts, registry, engine, and policies: `src/pet/behavior`.
- Composition code that maps runtime methods to ports:
  `src/pet/behavior/adapters`.
- Spine animation implementation: `src/pet/character`.
- Tauri window implementation: `src/services/tauri.ts`.
- UI controls and persistence: `src/app` and `src/settings`.

Adapters may import outward-facing technology. Core files may not.

## Testing strategy

Behavior engine tests use fake definitions and deferred promises. They should
not mount React, initialize WebGL, start Tauri, use real time, or rely on random
values. Test lifecycle calls as ordered data and assert snapshots after every
transition.

Platform adapters are validated separately through build checks and real Tauri
smoke tests. Future time-based policies must receive fake `ClockPort` and
`RandomPort` implementations.

## Comments for future maintainers and AI agents

Add comments for invariants, ordering constraints, coordinate systems,
ownership, and counterintuitive failure handling. Avoid comments that only
repeat the next line of code. When behavior contracts change, update this file,
the phase requirements, tests, and public TSDoc together.
