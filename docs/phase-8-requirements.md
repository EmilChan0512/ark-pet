# Phase 8 Requirements: Contextual Personality and Reactions

## Goal

Phase 8 moves `ark-pet` from a technically capable desktop-pet runtime to a pet that feels responsive and characterful.

The goal is to add a deterministic, local, event-driven reaction system that turns user and runtime context into character reactions composed from the capabilities already built in Phase 1–7:

```text
Context Event
    -> Reaction Policy
    -> Reaction Plan
    -> Behavior + Animation + Speech
```

The phase must reuse the existing Behavior Engine, Runtime Command boundary, Spine character runtime, ambient scheduler, settings, and Speech Session Coordinator. It must not introduce a second lifecycle engine or let reaction definitions directly manipulate Tauri, Pixi, Spine, DOM, or a concrete TTS implementation.

The primary product outcome is that Pepe begins reacting differently to clicks, repeated interactions, drag lifecycle, inactivity, session timing, first meeting of the day, and late-night usage instead of behaving like a fixed animation player.

## Product principles

1. **Personality before intelligence.** Phase 8 is deterministic and local. Do not add an LLM, cloud AI, network dialogue generation, embeddings, vector storage, or an autonomous agent loop.
2. **Reactions compose existing capabilities.** A reaction may request a behavior, animation, speech, delay, or sequence, but it must use existing runtime boundaries rather than bypass them.
3. **Character-specific content is data.** Pepe dialogue and reaction weights must not be hard-coded across runtime policy files.
4. **Runtime policy remains character-agnostic.** The core reaction engine understands event categories, priorities, cooldowns, eligibility, and plans. It does not know who Pepe is.
5. **Manual interaction wins.** Dragging and explicit interaction must preempt ambient personality reactions.
6. **No stale reactions.** Hide, reload, character replacement, settings changes, or destroy must invalidate old reactions and prevent late speech/animation from resurfacing.
7. **Deterministic tests.** Time and randomness must be injected through ports so the full policy can be tested without real timers, WebGL, Tauri, audio, or wall-clock time.

## Existing architecture to preserve

Phase 8 must preserve these Phase 4–7 invariants:

- `BehaviorEngine` remains the single owner of active behavior lifecycle.
- Ambient behavior modules remain independent from the speech implementation.
- `RuntimeCommandCoordinator` remains the ordered application-level command entrance.
- `SpeechSessionCoordinator` remains the owner of speech queueing, priority, timeout, interruption, cancellation, and playback lifecycle.
- `PetRuntime` remains the composition root.
- Core policy layers must not import React, Pixi, Spine, Tauri, DOM, browser globals, or a concrete voice engine.

Do not merge ReactionPolicy into `BehaviorEngine`. Behavior answers **how an action runs**; reaction policy answers **what the character wants to do in response to context**.

## High-level architecture

Introduce a narrow Phase 8 layer with roughly this responsibility map:

```text
User input / runtime lifecycle / local clock / idle tracker
                         |
                         v
                   ContextEventBus
                         |
                         v
                    ReactionEngine
                   /      |       \
             cooldown   policy   persona
                   \      |       /
                         v
                    ReactionPlan
                         |
                         v
                RuntimeReactionAdapter
                  /       |        \
         BehaviorEngine  Speech   Runtime commands
```

Recommended source layout:

```text
src/pet/reaction/
  types.ts
  ContextEventBus.ts
  ReactionEngine.ts
  ReactionPolicy.ts
  ReactionCooldownStore.ts
  adapters/
    RuntimeReactionAdapter.ts
  sources/
    InteractionContextSource.ts
    SessionContextSource.ts
    TimeContextSource.ts

src/pet/persona/
  types.ts
  CharacterPersona.ts
  CharacterPersonaLoader.ts
```

Exact filenames may change if a simpler structure fits the repository better, but dependency direction and ownership must remain equivalent.

## Context events

Define typed, serializable context events. The first version must support at least:

```ts
type ContextEvent =
  | { type: 'pet.clicked'; at: number; clickCount: number }
  | { type: 'pet.drag-started'; at: number }
  | { type: 'pet.drag-ended'; at: number; durationMs: number }
  | { type: 'session.started'; at: number }
  | { type: 'session.first-meeting-today'; at: number }
  | { type: 'session.user-returned'; at: number; idleMs: number }
  | { type: 'session.long-active'; at: number; activeMs: number }
  | { type: 'time.period-entered'; at: number; period: 'morning' | 'day' | 'evening' | 'late-night' }
```

The implementation may add internal events when useful, but avoid creating dozens of speculative event types.

### Event semantics

- `pet.clicked` must support repeated-click aggregation within a small configurable window so triple-click reactions are possible without three unrelated speech sessions.
- Drag events describe user interaction context; they do not replace the existing drag behavior lifecycle.
- `session.started` fires once per runtime start.
- `session.first-meeting-today` fires at most once per local calendar day and persists across application restart.
- `session.user-returned` requires a local idle threshold; Phase 8 may derive this from application-level pointer/interaction inactivity if native OS idle time is not already available.
- `session.long-active` must be threshold-based and cooldown-protected. It must not repeatedly nag the user every update tick.
- `time.period-entered` fires only when entering a new configured period, not continuously while inside that period.

## ContextEventBus

`ContextEventBus` is a small typed event transport, not a global application framework.

Required properties:

- synchronous publish order;
- safe subscribe/unsubscribe;
- idempotent destroy;
- no event delivery after destroy;
- subscriber failure must be contained and reported through diagnostics without preventing other subscribers from receiving the event;
- no React context dependency;
- no browser `EventTarget` requirement in core tests.

Do not put personality rules inside the event bus.

## Reaction engine

`ReactionEngine` converts a `ContextEvent` plus character persona and runtime capabilities into zero or one selected `ReactionPlan`.

It owns:

- rule matching;
- eligibility checks;
- weighted selection;
- reaction priority;
- cooldown checks;
- dedupe / anti-spam policy;
- cancellation generation;
- dispatch of the selected plan through an adapter.

It does **not** directly:

- call Spine APIs;
- move a Tauri window;
- render a speech bubble;
- play audio;
- set React state;
- create native timers.

### Determinism

Inject narrow ports such as:

```ts
interface ReactionClockPort {
  now(): number
}

interface ReactionRandomPort {
  next(): number // [0, 1)
}
```

Tests must use fake implementations.

Weighted choice must be deterministic given the same rules and random sequence.

## Reaction definitions

A persona reaction definition should remain data-oriented. A suggested shape:

```ts
interface PersonaReaction {
  id: string
  event: ContextEvent['type']
  priority: number
  weight?: number
  cooldownMs?: number
  conditions?: ReactionCondition[]
  plan: ReactionPlanDefinition
}
```

Do not require this exact TypeScript shape if another typed representation is cleaner, but the same concepts must exist.

### Reaction plans

A reaction plan is a small declarative composition of existing runtime capabilities.

Minimum supported steps:

- request an existing behavior;
- play or request a named character animation when supported;
- enqueue speech using the existing speech boundary;
- wait using runtime/ticker-owned time rather than unmanaged `setTimeout` chains;
- sequentially execute a short bounded series of steps.

Example conceptual data:

```json
{
  "id": "pepe.click.greeting",
  "event": "pet.clicked",
  "priority": 200,
  "weight": 3,
  "cooldownMs": 10000,
  "plan": [
    { "type": "animation", "name": "Touch" },
    { "type": "speak", "text": "博士？", "source": "interaction" }
  ]
}
```

Do not create a generic scripting language. Phase 8 needs only the smallest plan vocabulary required for the included reactions.

## Character Persona

Introduce a character-level data boundary that groups personality data separately from low-level Spine loading.

The current Pepe character becomes the first persona implementation.

A persona should provide at least:

- character ID;
- display name;
- reaction definitions;
- dialogue text used by reactions;
- optional personality metadata useful for diagnostics;
- compatibility/version field if persisted external JSON is introduced.

The runtime must be capable of loading the default Pepe persona without scattering Pepe-specific strings through reaction-engine source files.

Recommended resource direction:

```text
public/characters/demo/
  manifest.json
  persona.json        # preferred if practical in this phase
  ... existing Spine assets
```

A TypeScript persona module is acceptable temporarily if runtime JSON validation would add disproportionate complexity, but all Pepe-specific reaction content must still be centralized behind `CharacterPersona`.

If `persona.json` is introduced, validate it with the repository's existing schema-validation approach and surface clear load errors without crashing the pet runtime.

## Included Pepe reactions

Implement a deliberately small but noticeable first personality set.

### 1. Normal click

On a single click when not dragging:

- select from at least three weighted reaction variants;
- variants may combine `Touch` or another supported interaction animation with short Pepe text;
- do not speak every click if speech cooldown is active;
- repeated clicks must not create a large speech backlog.

Example text may include concise Pepe-style lines such as:

- `博士？`
- `有什么事吗？`
- `我在哦。`

Exact final copy can be adjusted during implementation, but keep the first set short and reusable.

### 2. Repeated click

When multiple clicks occur in the aggregation window:

- choose a distinct reaction pool from the normal single-click pool;
- enforce a stronger cooldown;
- higher interaction priority may replace lower ambient speech;
- do not interrupt an active drag lifecycle.

### 3. First meeting today

At most once per local day:

- present a short greeting after runtime startup and character readiness;
- do not fire before the character is successfully loaded;
- persist the last-fired local date in settings or a similarly narrow local persistence layer;
- failure to persist must not prevent startup.

### 4. User returned

After the configured idle threshold:

- emit one return reaction when activity resumes;
- short idle periods must not trigger it;
- repeated pointer noise after return must not enqueue repeated greetings.

### 5. Long active session

After a long continuous active session:

- select a low-priority reminder/rest reaction;
- ambient personality must never preempt manual interaction;
- default threshold should be configurable in code and testable with fake time;
- apply a long cooldown so the pet does not nag the user.

### 6. Late night

When entering the local `late-night` period:

- select a sleepy/rest-oriented reaction;
- fire at most once per period entry and obey a daily cooldown;
- do not repeatedly trigger every minute;
- a runtime launched already inside late-night may emit one eligible late-night reaction after character readiness.

## Priority model

Use a documented priority model consistent with existing behavior and speech priorities.

Suggested intent, not mandatory numeric values:

```text
manual drag / lifecycle commands    highest
explicit click interaction          high
user-returned reaction              medium
first-meeting greeting              medium
long-active reminder                low
late-night / ambient personality    low
ambient walk/sit/sleep              lowest
```

The ReactionEngine must not invent a competing priority system that contradicts `BehaviorEngine` or `SpeechSessionCoordinator`. Adapter code should translate reaction intent into the priorities already expected by those systems.

## Cooldowns and anti-spam

Implement a small `ReactionCooldownStore` or equivalent.

Requirements:

- cooldown keyed by stable reaction ID or cooldown group;
- monotonic runtime timestamps for in-session cooldown calculations;
- local calendar keys for once-per-day rules when required;
- deterministic tests;
- bounded memory;
- clear reset behavior on character change/reload;
- persisted values only when persistence has product meaning, such as first-meeting-today.

Do not persist every transient cooldown.

## Reaction lifecycle and cancellation

A selected reaction may outlive the original event for a short time, so stale execution must be guarded.

Required behavior:

- each running reaction receives a generation or cancellation token;
- a higher-priority replacement invalidates lower-priority pending work;
- hide, reload, character replacement, personality disable, or destroy cancels active reaction plan execution;
- late completions must not enqueue speech or animation after invalidation;
- cancellation is idempotent;
- cancellation of a reaction must not corrupt the underlying `BehaviorEngine` or speech coordinator state.

Do not introduce unmanaged recursive promises or `setTimeout` chains that survive runtime destruction.

## Settings

Add only settings that have clear user/product value.

Minimum Phase 8 setting:

```ts
personalityEnabled: boolean // default true
```

If useful for testing/debugging, thresholds may remain internal constants rather than user-facing settings.

Migrate the existing settings schema deterministically to the next version. Preserve all Phase 7 speech and autonomous-behavior settings.

Invalid previous data must continue to fall back safely.

## Debug support

Extend the development debug panel with compact diagnostics sufficient to verify Phase 8 without exposing internal implementation details in production.

Useful fields/actions:

- last context event;
- selected reaction ID;
- active reaction ID/state;
- remaining or blocked cooldown reason;
- current local time period;
- buttons to simulate representative events such as first-meeting, returned, long-active, and late-night;
- clear persisted first-meeting marker for development testing.

Debug actions must dispatch through the same event/reaction path as real sources where practical.

## Tests

Add focused unit tests. They must not require a Tauri window, WebGL, real audio, system time, or random nondeterminism.

Minimum coverage:

### ContextEventBus

- ordered delivery;
- unsubscribe;
- subscriber failure containment;
- destroy behavior.

### ReactionEngine

- rule matching;
- weighted deterministic selection;
- no eligible reaction path;
- priority replacement;
- cooldown blocking;
- repeated event dedupe/aggregation behavior;
- cancellation generation prevents stale completion;
- destroy is idempotent.

### Persona loading

- valid Pepe persona loads;
- malformed persona fails clearly;
- unknown animation/unsupported capability makes a reaction ineligible rather than crashing runtime where possible.

### Product scenarios

Prove at least:

1. single click selects from the normal click pool;
2. repeated click uses the repeated-click pool and cannot spam speech;
3. first-meeting fires once per local day;
4. user-returned fires only after threshold crossing;
5. long-active reaction obeys cooldown;
6. late-night fires on period entry rather than every tick;
7. manual drag prevents or cancels lower-priority reaction execution;
8. hide/reload/destroy prevents stale speech or animation;
9. `personalityEnabled=false` prevents new personality reactions without breaking manual pet control;
10. settings migrate deterministically from Phase 7.

## Documentation

Add an architecture guide such as:

```text
docs/architecture/reaction-system.md
```

Document:

- event ownership;
- policy versus behavior-engine responsibilities;
- persona data boundary;
- priority translation;
- cooldown ownership;
- cancellation and generation rules;
- how to add a new context event;
- how to add a new Pepe reaction;
- testing rules for clock/random behavior.

Update `README.md` Phase status once Phase 8 implementation is complete.

## Performance and resource rules

- Reuse the existing runtime ticker or event-driven callbacks; do not create a high-frequency personality polling loop.
- Time-period checks should run at a coarse interval or derive from an existing update path.
- Context history must be bounded; Phase 8 does not need a full activity log.
- No network access is added.
- Do not add large model/resource files.
- Do not regress transparent-window interaction or frame pacing.

## Security and privacy

Phase 8 must stay local and intentionally narrow.

- Do not record raw keyboard input.
- Do not record typed text.
- Do not inspect clipboard contents.
- Do not upload interaction history.
- Do not add telemetry.
- Do not inspect other application window titles or process content in this phase.
- Session activity should be represented only as coarse timestamps/durations required for reactions.

Desktop-awareness features beyond these coarse local signals belong to a later phase with a separate privacy design.

## Explicitly deferred

Do **not** implement these in Phase 8:

- LLM/chatbot integration;
- cloud AI or network dialogue generation;
- long-term conversational memory;
- RAG/vector database;
- arbitrary scripting or plugin execution;
- generic multi-character installer UI;
- full Character Package marketplace/import flow;
- native foreground-app/process awareness;
- raw keyboard monitoring;
- clipboard monitoring;
- macOS GPT-SoVITS production support;
- production packaging of the Windows CUDA voice stack;
- lip sync, phoneme timing, streaming TTS, or multi-character audio mixing.

Phase 8 should create a clean persona boundary that makes a future Character Package phase easier, but it must not expand scope into that phase.

## Implementation order

Codex should implement Phase 8 in this order unless repository constraints reveal a concrete reason to change it:

1. Inspect and preserve Phase 4–7 lifecycle invariants and existing tests.
2. Add typed context-event contracts and `ContextEventBus` with tests.
3. Add `CharacterPersona` boundary and centralize the first Pepe reaction data.
4. Add deterministic `ReactionEngine`, cooldown policy, clock/random ports, and tests.
5. Add a runtime reaction adapter that composes Behavior Engine and Speech Session Coordinator without direct platform coupling.
6. Wire click and drag interaction context sources.
7. Wire session/time sources: startup, first-meeting, returned, long-active, and late-night.
8. Add personality setting and migration.
9. Add debug diagnostics and event simulation controls.
10. Add the included Pepe reactions and tune priorities/cooldowns.
11. Add architecture documentation and update README status.
12. Run the full validation suite and fix regressions before stopping.

## Acceptance criteria

Phase 8 is complete only when all of the following are true:

1. The runtime has one typed local context-event path for all included Phase 8 signals.
2. Character-specific reaction content is centralized behind a `CharacterPersona` boundary rather than spread through runtime policy code.
3. A deterministic reaction engine maps context events to bounded reaction plans with eligibility, priority, weighting, cooldown, and cancellation.
4. Reaction execution reuses the existing Behavior Engine, Runtime Command boundary, and Speech Session Coordinator rather than bypassing them.
5. Pepe visibly has distinct reactions for normal click, repeated click, first meeting today, user return, long active session, and late-night entry.
6. Manual drag and explicit interaction preempt lower-priority personality reactions.
7. Repeated clicks and time-based events cannot create unbounded speech or reaction queues.
8. Hide, reload, character replacement, personality disable, and destroy prevent stale reaction side effects.
9. The first-meeting marker persists at most once per local calendar day and migrates safely with settings.
10. Tests use fake time/randomness and prove all product scenarios listed above without real Tauri/WebGL/audio dependencies.
11. No LLM, cloud service, raw keyboard capture, clipboard capture, telemetry, or foreground-app content inspection is introduced.
12. `pnpm test`, `pnpm build`, `pnpm lint`, `cargo check`, and `git diff --check` all pass.
13. `docs/architecture/reaction-system.md` explains extension and lifecycle rules clearly enough for a future coding agent to add a new reaction without reading implementation history.

## Delivery expectation for Codex

Codex should treat this document as the execution contract for Phase 8.

Do not stop after scaffolding interfaces. Deliver the end-to-end product behavior, tests, migration, debug verification path, architecture documentation, and README status update in one implementation branch.

When a requirement conflicts with an existing Phase 4–7 invariant, preserve the existing invariant unless this document explicitly supersedes it. If an implementation detail must differ, document the reason in the Phase 8 architecture guide and keep the same observable product and lifecycle guarantees.
