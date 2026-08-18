# Contextual Reaction System

Phase 8 adds a local, deterministic policy layer between context signals and the
capabilities delivered in Phases 4–7. It does not add another behavior
lifecycle.

```text
interaction / session / local time
              |
       ContextEventBus
              |
       ReactionEngine + CharacterPersona
              |
       RuntimeReactionAdapter
          /          \
  BehaviorEngine   SpeechSessionCoordinator
```

## Ownership and dependency direction

- Context sources own signal semantics. `InteractionContextSource` aggregates
  clicks and describes drag lifecycle; `SessionContextSource` owns coarse idle,
  long-session, and once-per-day greeting signals; `TimeContextSource` owns
  period-entry detection.
- `ContextEventBus` only transports typed serializable events synchronously. It
  contains subscriber failures and has no policy or browser dependency.
- `ReactionEngine` answers what should happen. It owns matching, eligibility,
  weighting, reaction priority, transient cooldowns, and cancellation
  generations. Injected clock and random ports make selection deterministic.
- `BehaviorEngine` still answers how behavior runs and remains the only active
  behavior lifecycle owner. A reaction requesting `ambient.sleep`, for example,
  goes through its existing registry and priority rules.
- `SpeechSessionCoordinator` still owns speech priority, dedupe, queue bounds,
  interruption, audio, timeout, and cleanup. Reaction code only submits a
  `SpeakRequest`.
- `PetRuntime` is the composition root. React can only simulate events through
  `RuntimeCommandCoordinator`; it does not call policy or character APIs.

Core reaction and persona files must not import React, DOM, Pixi, Spine, Tauri,
or a concrete voice engine.

## Persona boundary

Character-specific copy and weights live in
`public/characters/<id>/persona.json`. `CharacterPersonaLoader` validates this
resource with a strict schema and rejects duplicate reaction IDs. Load failure
is reported in diagnostics but does not destroy an otherwise valid character.

A definition declares an event, priority, optional weight/cooldown/conditions,
and a bounded plan of at most eight behavior, animation, speech, or ticker-time
wait steps. This is deliberately not a scripting language. Unknown animations
or behavior IDs make a definition ineligible through adapter capability checks.

## Priority translation and cooldowns

Current intent is: drag (Behavior priority 200) and pointer interruption;
explicit reactions (Reaction/Speech 200–220); returned/first greeting
(150–160); long-active (60); late-night (50); ordinary ambient scheduling
(Behavior 10–30). The adapter passes reaction priority into `SpeakRequest` and
submits behavior IDs to the existing engine, so neither subsystem is bypassed.

Transient cooldowns use `performance.now()` through `ReactionClockPort` and a
bounded 128-entry LRU-like map. A stable `cooldownGroup` lets weighted variants
share anti-spam state. The first-meeting marker and reactions explicitly marked
`oncePerLocalDay` (currently late-night) persist a local date because those
rules have cross-restart product meaning. Persona replacement clears transient
cooldowns.

## Cancellation and generations

Every selected plan receives a monotonically increasing generation token.
Replacement, drag/manual input, hide, reload, UI interaction, personality
disable, persona change, and destroy invalidate that token and cancel adapter
work. Waits advance only from the existing Pixi ticker. Late promise completion
cannot clear or enqueue work for a newer generation. Cancellation is
idempotent, while the behavior and speech owners clean up their own state.

## Extending the system

To add a context event:

1. Add its serializable union member to `reaction/types.ts`.
2. Publish it from the smallest appropriate source; do not add rules to the bus.
3. Add only the condition matcher needed by real persona data.
4. Cover timing and repeated-event semantics with fake values in source and
   engine tests.

To add a Pepe reaction, edit `persona.json`. Prefer an existing behavior ID or
manifest animation and short reusable dialogue. Assign a stable ID, share a
cooldown group for variants, and confirm the runtime adapter reports every plan
capability as supported.

Tests never use wall-clock waiting, WebGL, Tauri, or audio. Supply fake
`ReactionClockPort`/`ReactionRandomPort` values and advance adapter/source
`update(now)` explicitly.
