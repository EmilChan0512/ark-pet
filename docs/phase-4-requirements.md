# Phase 4 Requirements: Behavior Architecture Foundation

## Goal

Establish an extensible behavior architecture before adding autonomous pet
features. Phase 4 separates behavior definitions, selection, execution,
platform effects, and diagnostics so future walking, sitting, sleeping,
notifications, or local integrations can be added without expanding
`PetRuntime` into a monolith.

This phase is architecture-first. It does not enable random roaming, sleeping,
AI decisions, cloud services, third-party APIs, or a public plugin system.

## Design principles

- Core behavior code is independent of React, Pixi, Spine, Tauri, and browser
  globals.
- Dependencies point inward through explicit ports; behavior code never imports
  a concrete renderer or native window implementation.
- One engine owns the active behavior and its lifecycle.
- Behavior definitions are registered rather than hard-coded into engine
  conditionals.
- Priority and interruption rules are data, not scattered event-handler logic.
- Time and randomness are injected so future policies are deterministic in
  tests.
- Cancellation and cleanup are mandatory parts of every behavior lifecycle.
- A behavior failure is contained and reported without crashing the pet.
- Existing Phase 1–3 behavior remains the compatibility baseline.

## Target dependency direction

```text
React / Tray
    -> PetRuntime (composition root)
        -> BehaviorEngine
            -> BehaviorRegistry
            -> BehaviorPolicy
            -> BehaviorDefinition
            -> BehaviorPorts (interfaces)
                <- Pixi/Spine adapter
                <- Tauri window adapter
                <- diagnostics adapter
```

The behavior layer must not import from `src/app`, `pixi.js`,
`@pixi-spine/*`, or `@tauri-apps/*`.

## Core contracts

### Behavior definition

Each behavior declares:

- stable string `id`;
- numeric `priority`;
- optional tags such as `manual`, `ambient`, or `blocking`;
- a synchronous eligibility predicate over an immutable context snapshot;
- an `enter` lifecycle hook;
- an optional `update` hook driven by the single engine tick;
- an `exit` lifecycle hook that receives a typed cancellation reason.

Definitions must not retain mutable engine state between activations. Per-run
state belongs to a behavior instance created for that activation.

### Registry

The registry:

- rejects duplicate IDs;
- exposes immutable lookup and listing;
- preserves no runtime activation state;
- allows future feature modules to contribute definitions at the composition
  root without modifying `BehaviorEngine`.

### Engine

The engine:

- owns zero or one active behavior;
- evaluates priority before replacement;
- gives explicit manual requests precedence over ambient requests;
- guarantees `exit` is invoked at most once for an entered behavior;
- uses an activation generation to ignore stale asynchronous completions;
- contains hook failures and returns to a safe idle state;
- exposes a read-only snapshot for debug UI and tests;
- is idempotently destroyable.

The engine must not create independent animation loops. `PetRuntime` forwards
one existing ticker or frame callback to `engine.update(now)`.

### Policy

A policy selects a behavior ID from registered eligible candidates. It does not
execute behaviors or call platform APIs. Future ambient policy can use injected
clock and random ports without changing the engine.

Phase 4 includes a deterministic no-random policy sufficient to verify the
contract. Weighted autonomous selection is deferred.

### Ports

The behavior layer defines narrow capability interfaces, initially:

- `AnimationPort`: play an animation and query availability;
- `WindowMotionPort`: read and move the native window;
- `BehaviorDiagnosticsPort`: publish engine snapshots and contained errors;
- `ClockPort`: monotonic time only;
- `RandomPort`: normalized random value for future policies.

Ports may be grouped into a runtime context, but definitions must request only
the capabilities they use.

## Lifecycle and interruption model

Typed exit reasons:

- `completed`;
- `replaced`;
- `user-input`;
- `paused`;
- `reload`;
- `hidden`;
- `disabled`;
- `destroyed`;
- `failed`.

Minimum priority order:

1. destroy and reload cleanup;
2. manual dragging;
3. manual interaction;
4. runtime commands and settings UI;
5. future autonomous behavior;
6. idle.

Opening settings, hiding, or reloading pauses/cancels the active behavior at the
engine boundary. Closing settings or showing the pet returns through a fresh
idle request rather than resuming stale behavior state.

## Phase 4 implementation slice

Phase 4 implements and verifies:

1. behavior types and typed lifecycle reasons;
2. duplicate-safe registry;
3. single-active-behavior engine with priority, replacement, cancellation,
   stale-completion protection, snapshots, and failure containment;
4. injected clock and deterministic policy contracts;
5. a small runtime adapter that maps existing idle, interaction, and drag
   lifecycle signals into the engine without changing their visible behavior;
6. debug snapshot fields for active behavior and last behavior error;
7. focused unit tests using fake definitions and ports.
8. a maintenance-oriented architecture document, public-contract TSDoc, and
   reason-focused comments for concurrency and cleanup invariants.

Autonomous walking, sitting, sleeping, monitor bounds, and persisted autonomous
settings are deferred to Phase 5. They must be implemented as registered
behavior modules and policies on top of this foundation.

## File boundaries

Expected structure:

```text
src/pet/behavior/
  types.ts
  BehaviorRegistry.ts
  BehaviorEngine.ts
  policies/
    DeterministicPolicy.ts
  adapters/
    RuntimeBehaviorAdapter.ts
```

Exact filenames may change, but contracts, engine, policy, and concrete
platform adapters must remain separable.

## Compatibility constraints

- Keep Tauri 2, React/TypeScript/Vite, PixiJS 7.4.3, and Spine 3.8 runtime.
- Do not migrate renderer or Spine major versions.
- Do not remount React or reload Spine to switch behavior.
- Do not add network or Wiki API dependencies.
- Preserve local settings format unless an actual new persisted setting exists.
- Preserve smooth physical-coordinate dragging and Phase 3 facing behavior.

## Acceptance criteria

1. The behavior core has no imports from React, Pixi, Spine, Tauri, or browser
   APIs.
2. Duplicate behavior registration fails with a clear error.
3. An eligible higher-priority request replaces the active behavior exactly
   once and provides `replaced` to its exit hook.
4. A lower-priority ambient request cannot interrupt manual interaction.
5. Cancellation, pause, reload, hide, and destroy invoke cleanup at most once.
6. A stale asynchronous enter completion cannot mutate the current activation.
7. An enter, update, or exit failure is reported through diagnostics and does
   not leave the engine active or unusable.
8. Engine destroy is idempotent and rejects future activation.
9. Fake-clock tests require no real waits and contain no randomness.
10. Existing idle, click interaction, dragging, direction, tray, settings,
    passthrough, reload, and cleanup behavior remains visually unchanged.
11. Debug output identifies the active behavior and the last contained behavior
    error.
12. TypeScript build, lint, unit tests, native Tauri build, and a real runtime
    smoke test pass.
13. README links to the architecture entry point, and a future maintainer can
    add a behavior by following the documented extension steps.
