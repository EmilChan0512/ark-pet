# Phase 10 Requirements: Privacy-Preserving Desktop Awareness

## Goal

Phase 10 lets the pet respond to a small set of coarse desktop states while
keeping observation local, opt-in, inspectable, ephemeral, and incapable of
capturing user content.

The phase extends the Phase 8 context path rather than creating an autonomous
monitoring or agent system:

```text
OS state adapters
    -> native minimization/classification
    -> coarse DesktopContextEvent
    -> ContextEventBus
    -> ReactionEngine + active CharacterPersona
    -> existing behavior / animation / speech boundaries
```

The primary product outcome is that a character can notice safe state changes
such as the user returning after system-level idle, entering a broad activity
category, or locking/unlocking the session, without reading window titles,
documents, URLs, messages, keystrokes, clipboard data, screen pixels, or raw
activity history.

Phase 10 is desktop awareness, not desktop surveillance. Any implementation
that requires content capture, broad accessibility control, screen recording,
or persistent activity logging is outside this phase.

## Product principles

1. **Off by default.** Desktop awareness requires explicit user enablement.
   Upgrading the app must not silently begin observing foreground state.
2. **Coarse before specific.** Personas receive broad categories and state
   transitions, never raw process paths, window handles, titles, bundle IDs,
   executable names, URLs, document names, or typed content.
3. **Minimize at the native edge.** Raw OS identifiers exist only long enough
   inside the platform adapter/classifier to derive an allowed category. They
   do not cross into JavaScript, diagnostics, persona data, or persistence.
4. **State changes, not timelines.** Emit bounded transition events. Do not
   build an activity log, session replay, per-application duration database, or
   analytics stream.
5. **Transparent control.** Settings explain exactly what is observed, expose
   the current coarse state, and provide an immediate pause/disable control.
6. **No permission inflation.** Do not request Accessibility, screen-recording,
   input-monitoring, browser-history, or automation permission when foreground
   application identity and system idle APIs suffice.
7. **Personality remains deterministic.** Awareness events feed the existing
   local reaction policy. No LLM, cloud classifier, autonomous agent loop, or
   generated dialogue is added.
8. **Manual interaction wins.** Drag, click, settings, hide, reload, character
   switch, disable, lock, and destroy cancel or suppress lower-priority desktop
   reactions.
9. **Degrade privately.** Missing platform support, denied access, or classifier
   uncertainty yields `unknown`/unavailable, not broader inspection.

## Scope and terminology

Phase 10 supports three awareness families:

1. **System idle state** — elapsed time since aggregate local user input,
   obtained from an OS idle-duration API. No individual key or pointer event is
   captured.
2. **Foreground activity category** — a local mapping from the current
   foreground application's stable OS identity to a broad category. Only the
   category leaves the native boundary.
3. **Session availability** — coarse locked/unlocked or suspended/resumed state
   when reliably available from the OS lifecycle boundary.

Optional fullscreen/busy state may be included only if it can be determined
without title/content/screen capture and has deterministic cross-platform
semantics. It is not required for acceptance.

The term **raw application identity** means process ID, executable path or
name, bundle identifier, application user model ID, window handle, signing
identity, or equivalent OS value. It is sensitive implementation input and is
never a persona/context field.

## Existing architecture to preserve

Phase 10 must preserve Phase 4–9 invariants:

- `ContextEventBus` remains the single typed local path for reaction context.
- `ReactionEngine` remains deterministic and character-agnostic.
- Character packages may declare reactions only against the public coarse
  event vocabulary; packages never receive native identifiers.
- `BehaviorEngine` remains the active behavior lifecycle owner.
- `SpeechSessionCoordinator` remains the speech lifecycle owner.
- `RuntimeCommandCoordinator` remains the ordered application command entrance.
- `PetRuntime` remains the composition root and owns source readiness,
  cancellation, and generation changes.
- Native adapters observe/minimize OS state; React is only settings and
  diagnostics UI.
- Core desktop policy and classification interfaces must not import React,
  Pixi, Spine, DOM, browser globals, or concrete platform APIs.

Do not place reaction copy or character-specific rules in native platform
code. Do not place raw platform samples on `ContextEventBus`.

## Consent and user experience

Add a clear settings section before any native observer starts.

Minimum setting:

```ts
desktopAwarenessEnabled: boolean // default false
```

The first enable action must present concise disclosure stating:

- Ark Pet reads only system idle duration, lock/unlock state, and the current
  app's broad local category;
- it does not read titles, URLs, screen contents, files, keyboard input,
  clipboard data, messages, or document text;
- raw application identity is minimized inside the native process and not
  stored or sent to personas;
- awareness is local, has no telemetry, and can be disabled immediately.

The UI must offer **Enable** and **Not now** without dark patterns. Declining
leaves the feature off. If a platform requires a permission prompt, request it
only after the user enables the related capability and explain why first.

While enabled, settings/debug UI should show:

- awareness status: off, starting, active, paused, unsupported, or error;
- currently exposed category: one of the public coarse values;
- idle state: active or idle, optionally rounded duration bucket;
- session state: available/locked when supported;
- a plain-language list of data that is explicitly not collected;
- an immediate disable/pause action.

Do not show raw application identity even in development diagnostics. Native
debug logging must redact it by default; temporary local developer logging, if
ever needed, requires a separate compile-time flag and must not ship.

## Public context vocabulary

Extend the serializable `ContextEvent` union with a deliberately small public
surface. Suggested shape:

```ts
type DesktopActivityCategory =
  | 'development'
  | 'browsing'
  | 'communication'
  | 'productivity'
  | 'creative'
  | 'media'
  | 'gaming'
  | 'system'
  | 'other'
  | 'unknown'

type DesktopContextEvent =
  | {
      type: 'desktop.activity-category-entered'
      at: number
      category: DesktopActivityCategory
    }
  | {
      type: 'desktop.system-idle-entered'
      at: number
      idleBucket: 'short' | 'medium' | 'long'
    }
  | {
      type: 'desktop.system-idle-returned'
      at: number
      idleBucket: 'short' | 'medium' | 'long'
    }
  | { type: 'desktop.session-locked'; at: number }
  | { type: 'desktop.session-unlocked'; at: number }
```

Exact names may change, but these minimization rules are mandatory:

- no raw application identity;
- no window/document/tab/title/URL fields;
- no precise foreground dwell time;
- no process ID, path, handle, or hash that can act as a stable fingerprint;
- no raw input event or key/pointer details;
- idle duration is bucketed before it reaches persona policy;
- timestamps are monotonic runtime values used for ordering/cooldowns, not a
  persisted wall-clock activity record.

`unknown` is a normal category. It must not trigger increasingly invasive
fallback inspection.

### Event semantics

- `desktop.activity-category-entered` fires only after a stable category change
  passes a debounce window. Switching between two applications in the same
  category does not emit an event.
- The pet's own windows and transient system surfaces should map to `system` or
  be ignored to avoid feedback loops.
- Idle entry fires once when the configured threshold is crossed.
- Idle return fires once on the first observed transition back to active.
- Lock suppresses foreground-category and ordinary idle reactions.
- Unlock emits once and restarts observation from a clean generation; it must
  not replay category transitions accumulated while locked.
- Startup may emit the current stable category only after consent, character
  readiness, source readiness, and debounce.

## Native observation boundary

Define narrow native ports rather than exposing a general process API:

```ts
interface DesktopAwarenessPort {
  start(options: DesktopAwarenessOptions): Promise<void>
  stop(): Promise<void>
  getStatus(): DesktopAwarenessStatus
  subscribe(listener: (sample: CoarseDesktopSample) => void): () => void
}
```

The actual Tauri event/command representation may differ. The frontend-visible
sample contains only public coarse state. There must be no generic command such
as `list_processes`, `get_window_title`, `get_foreground_process_path`, or
`read_active_window`.

Native responsibilities:

- obtain the minimum OS data required for foreground app identity, aggregate
  idle duration, and lock/lifecycle state;
- classify application identity locally using a bounded built-in table;
- discard raw identity immediately after classification;
- debounce and deduplicate state changes;
- stop observation promptly on disable, hide if configured, lock, shutdown,
  permission loss, or subscriber teardown;
- publish only bounded coarse samples;
- contain platform failures and report safe error codes;
- never enumerate all processes or windows when the foreground API suffices.

Frontend responsibilities:

- gate source startup on consent and runtime readiness;
- convert coarse native samples into public context events;
- apply generation/cancellation guards;
- integrate with personality enablement and lifecycle commands;
- expose only coarse diagnostics.

## Platform approach

Phase 10 targets the repository's Windows and macOS desktop paths.

### Windows

Use narrow Win32 APIs where practical:

- foreground window only, followed by owning process identity needed for local
  classification;
- `GetLastInputInfo` or equivalent aggregate idle-duration API;
- session lock/unlock notifications through a scoped window/session lifecycle
  integration when reliable.

Do not read window text, UI Automation trees, browser data, command lines,
loaded modules, or other processes' memory. Do not enumerate background
processes for classification.

### macOS

Prefer `NSWorkspace.frontmostApplication` and workspace/session notifications,
plus a supported aggregate idle-duration mechanism that does not install an
event tap. The implementation must not request Accessibility, Input Monitoring,
Automation, or Screen Recording permission merely for Phase 10.

If an idle or lock signal cannot be obtained without a broader permission, mark
that sub-capability unsupported and preserve the remaining narrow features.

### Other platforms

Linux and additional desktop environments are deferred unless the repository
adds them with an equally narrow, documented adapter. Unsupported platforms
must compile and expose a stable `unsupported` capability result.

## Local application classifier

Classification is a pure, deterministic native policy module (or equivalent
generated mapping with the same reviewed specification) fed only by a
platform-normalized identity inside native code. Raw identity never crosses
IPC merely to reuse a TypeScript classifier.

Requirements:

- a bounded, versioned built-in mapping from known stable app identifiers to
  public categories;
- exact normalized matches, not fuzzy title/path/content heuristics;
- unknown identifiers return `unknown`;
- no network lookup, remote reputation service, analytics, or learned model;
- no category inference from window title, URL, document extension, command
  line, or user content;
- tests contain synthetic identifiers rather than machine-specific paths;
- mapping updates are ordinary reviewed application updates.

User-defined per-app mappings are deferred. If added later, they require a
separate privacy design because showing raw app identity to the frontend would
weaken this boundary.

## Desktop context source

Introduce a source such as `DesktopContextSource` that consumes only coarse
native samples and publishes typed context events.

It owns:

- readiness and enabled state;
- stable-category debounce;
- idle threshold/bucket transitions;
- lock suppression and unlock reset;
- duplicate transition suppression;
- generation invalidation;
- bounded diagnostics snapshot.

It does not own:

- character dialogue or reaction weights;
- native OS calls;
- behavior, animation, speech, or UI state;
- raw identifier classification;
- persistent history.

Use event callbacks or a coarse native interval. Do not add a frontend
high-frequency polling loop. A 1–2 second foreground sampling interval is a
reasonable upper bound when event notifications are unavailable; idle checks
may be similarly coarse.

## Idle thresholds and buckets

Avoid publishing precise activity durations. Suggested internal semantics:

```text
short   5–14 minutes
medium 15–59 minutes
long   60+ minutes
```

The exact thresholds may be tuned with tests, but they must be code-configured,
documented, monotonic, and shared across platforms. The public event contains a
bucket only.

Phase 8 application-pointer inactivity remains a separate fallback signal. If
system idle capability is active, it becomes the authoritative source for
desktop return reactions to prevent duplicate greetings. The two sources must
not independently enqueue the same semantic reaction.

## Reaction policy and persona integration

Character personas may match only public desktop events and categories.

Include a deliberately small first set for Pepe:

1. **Return from long system idle** — a medium-priority welcome-back reaction
   with a strong cooldown.
2. **Development category entered** — a low-priority, short work-oriented line
   after debounce, never on every editor/window switch.
3. **Gaming category entered** — a low-priority playful line with a daily or
   long cooldown.
4. **Media category entered** — optional low-priority quiet/listening reaction.
5. **Session unlocked** — an eligible greeting only when it will not duplicate
   first-meeting or idle-return reactions.

Category reactions must be sparse. The feature should feel situational, not
like a narrator announcing every application change.

Policy rules:

- drag and explicit click interaction preempt desktop reactions;
- return/unlock may preempt ambient speech but not manual interaction;
- category transitions are low priority and cannot interrupt active manual or
  return reactions;
- shared cooldown groups dedupe semantically equivalent Phase 8 and Phase 10
  return events;
- lock, disable, hide, reload, character switch, persona replacement, and
  destroy cancel pending desktop reaction plans;
- character packages from Phase 9 can opt into categories but cannot request
  raw identifiers or unsupported actions.

## Lifecycle and cancellation

Desktop observation has its own generation, separate from reaction execution
generation but coordinated by `PetRuntime`.

Start only after:

1. settings and consent are loaded;
2. native capability is known;
3. the character and persona are ready;
4. runtime is visible and not being destroyed.

Stop/invalidate on:

- awareness disable or consent withdrawal;
- hide when no background observation is needed;
- session lock;
- settings UI if observation details are being changed;
- character reload/replacement where persona rules change;
- native permission/capability loss;
- runtime destroy.

Late samples from an old subscription/generation must not publish events,
change diagnostics, restart observation, or enqueue reactions. Stop and destroy
are idempotent. Shutdown must unsubscribe native listeners before destroying
the webview/runtime consumers.

Whether hide pauses observation is an explicit product decision for Phase 10;
the privacy-preserving default is to pause while the pet is hidden. Showing the
pet starts a fresh debounce and does not replay hidden transitions.

## Settings and migration

Add only settings that are user-comprehensible:

```ts
desktopAwarenessEnabled: boolean // default false
desktopAwarenessConsentVersion: number | null
```

The consent version records which local disclosure the user accepted; it is
not telemetry. A material expansion of observed data requires a new version and
fresh opt-in. Disabling the feature does not erase the fact that the disclosure
was previously shown, but it stops observation immediately.

Migrate the Phase 9 settings schema deterministically while preserving active
character, personality, speech, autonomous behavior, rendering, and window
settings. Invalid prior data falls back safely with awareness disabled.

Do not store current category, idle buckets, transitions, raw identifiers, or
daily activity summaries in settings.

## Data retention and privacy invariants

Permitted ephemeral state:

- current public category;
- previous public category for dedupe;
- current idle/active and lock state;
- monotonic transition times needed for debounce/cooldown;
- bounded error/status diagnostics;
- existing reaction cooldown markers with clear product meaning.

Prohibited collection or retention:

- raw keyboard or pointer events;
- typed text, shortcuts, key counts, or mouse trajectories;
- clipboard contents or metadata;
- screen pixels, screenshots, OCR, webcam, or microphone;
- window, tab, document, workspace, project, or file titles;
- URLs, browser history, page contents, or extension data;
- message/email/calendar content;
- full process/window lists, command lines, file paths, or loaded modules;
- per-app dwell histories, daily timelines, productivity scores, or behavioral
  profiles;
- telemetry or upload of any awareness state;
- stable hashes of raw app identity exposed as a workaround.

Awareness data must not be written to application logs in normal builds.

## Capability and failure model

Expose capabilities independently:

```ts
interface DesktopAwarenessCapabilities {
  foregroundCategory: 'available' | 'unsupported' | 'denied' | 'error'
  systemIdle: 'available' | 'unsupported' | 'denied' | 'error'
  sessionLock: 'available' | 'unsupported' | 'denied' | 'error'
}
```

One unavailable capability must not force broader access or crash the others.
The UI and source subscribe only to available families. Errors are bounded,
rate-limited, and represented by safe codes. Repeated failures back off or stop
the source instead of polling/logging every tick.

No fallback may invoke a shell command, enumerate processes, read window
titles, use screen capture, or query a remote service.

## Debug and privacy verification support

Development diagnostics should expose only:

- enabled/consented/source status;
- capability matrix;
- current coarse category;
- current idle bucket/state;
- lock state;
- last public desktop event type;
- debounce/cooldown block reason;
- observer generation and safe error code;
- simulation controls for public coarse events.

Simulation must use the same `ContextEventBus` and reaction path as real
events. It must not require the native observer and must remain development
only.

Add a privacy verification view or test snapshot proving that frontend payloads
contain no raw identity fields. Do not add a hidden raw-data debug panel.

## Tests

Tests must use fake adapters, clocks, samples, and platform APIs. Core tests
must not require access to real process/window/input state, accessibility
permissions, Tauri windows, WebGL, audio, or wall-clock waiting.

### Classifier tests

- known synthetic normalized identities map deterministically;
- unknown identity maps to `unknown`;
- case/normalization rules are explicit per platform;
- no classifier input/output type contains title, URL, content, or path fields
  beyond the short-lived native input boundary;
- mapping has bounded size and no fuzzy/content heuristics.

### Desktop context source tests

- disabled/off-by-default source does not start native observation;
- enable starts only after consent and readiness;
- category debounce and same-category dedupe;
- pet/system surfaces do not create feedback loops;
- idle entry and single return with correct bucket;
- lock suppresses samples and unlock starts fresh;
- hide/disable/reload/character switch/destroy invalidate late samples;
- partial capability support works;
- repeated native errors back off without unbounded logs/events;
- destroy and unsubscribe are idempotent.

### Privacy contract tests

- serialized frontend samples and context events contain only public fields;
- raw app identity never reaches event bus, persona matcher, settings,
  diagnostics, or normal logs;
- no settings migration stores category/history;
- unsupported/denied paths do not invoke broader fallback APIs;
- Tauri commands/capabilities expose no generic process enumeration or window
  title operation.

### Product scenarios

1. Upgrade leaves desktop awareness disabled.
2. Declining consent starts no observer.
3. Enabling with full capability emits one stable category event after
   readiness/debounce.
4. Switching between applications in the same category emits nothing.
5. Unknown applications expose only `unknown`.
6. A long system idle produces one return reaction and suppresses the duplicate
   Phase 8 pointer-idle greeting.
7. Development/gaming/media category reactions obey low priority and long
   cooldowns.
8. Drag/click preempts a pending desktop reaction.
9. Lock, hide, disable, reload, character switch, and destroy prevent stale
   desktop speech/animation.
10. Denied or unsupported capability remains stable without requesting a
    broader permission.
11. A Phase 9 persona can use public categories but cannot reference raw app
    identity.
12. Settings migrate deterministically with awareness off.

## Documentation

Implementation must add an architecture/privacy guide such as:

```text
docs/architecture/desktop-awareness.md
```

Document:

- consent and enablement flow;
- exact collected and prohibited data;
- native minimization boundary;
- public event schema;
- Windows/macOS adapter APIs and permissions;
- classifier mapping rules;
- debounce, idle buckets, and duplicate suppression;
- source/reaction generations and cancellation;
- capability/failure model;
- how a persona safely adds a category reaction;
- privacy contract testing and review checklist.

Update `README.md` status only after Phase 10 is implemented and privacy
acceptance is complete.

## Performance and resource rules

- Prefer OS notifications; otherwise sample foreground state no faster than the
  documented coarse interval.
- Publish only state changes, not every sample.
- Do not poll from the render ticker at frame rate.
- Native sampling/classification must be lightweight and bounded.
- Stop or pause observation when disabled, destroyed, locked, and by default
  while hidden.
- Back off repeated errors.
- Keep no unbounded context/event/error history.
- Add no network calls, models, embeddings, databases, or large mappings.
- Do not regress rendering frame pacing, window passthrough, dragging, voice,
  or character switching.

## Security review requirements

Before Phase 10 is accepted, review must verify:

- no generic foreground-window/process API is exposed to the webview;
- Tauri capabilities are the minimum needed and scoped to the main window;
- native raw identity lifetime is limited to classification;
- no raw values appear in errors, panic messages, diagnostics, or production
  logs;
- event payloads cannot smuggle raw identity through free-form metadata;
- character packages cannot add categories or conditions outside the public
  enum/schema;
- disable/consent withdrawal closes native subscriptions promptly;
- platform adapters do not require content-oriented permissions;
- no network/telemetry path exists;
- privacy statements match tested behavior.

Any required expansion beyond these boundaries blocks the phase and requires a
new explicit privacy design rather than an undocumented exception.

## Explicitly deferred

Do **not** implement in Phase 10:

- window/tab/document titles or active file/project names;
- URLs, browser history, browser extensions, or page contents;
- raw keyboard/mouse hooks, key counts, shortcuts, or input recording;
- clipboard monitoring;
- screenshots, OCR, screen recording, Accessibility/UI Automation trees, or
  visual understanding;
- microphone, camera, notification, email, calendar, or message content;
- complete process/window enumeration or background process monitoring;
- per-app timers, productivity scoring, focus analytics, activity history, or
  timeline UI;
- user-defined app rules requiring raw identity exposure;
- desktop automation, clicking/typing, application control, or agent actions;
- LLMs, embeddings, cloud classification, network dialogue generation, or
  telemetry;
- background startup behavior unrelated to the visible pet;
- Linux desktop-environment matrix unless separately designed and tested;
- fullscreen/content-sensitive reactions that require broader permissions.

## Implementation order

Codex should implement Phase 10 in this order unless concrete platform evidence
requires a documented adjustment:

1. Preserve and baseline Phase 4–9 lifecycle, reaction, package, and privacy
   invariants.
2. Freeze the public coarse event schema, prohibited fields, consent copy, idle
   buckets, and capability model.
3. Add pure classifier and `DesktopContextSource` contracts with fake-clock and
   privacy tests.
4. Implement Windows adapter with foreground-only, aggregate idle, and scoped
   session-state APIs.
5. Implement macOS adapter without Accessibility/Input Monitoring/Screen
   Recording permissions; mark unavailable sub-capabilities honestly.
6. Add native minimization, debounce/dedupe, error backoff, and safe capability
   reporting.
7. Wire source readiness and generation cancellation through `PetRuntime` and
   `RuntimeCommandCoordinator`.
8. Reconcile Phase 8 pointer idle with authoritative system idle to prevent
   duplicate returns.
9. Extend persona schemas with only the public category/event vocabulary and
   add a small Pepe reaction set.
10. Add off-by-default settings migration, consent UX, status UI, and coarse
    development simulations.
11. Complete platform privacy/security review and architecture documentation.
12. Run frontend/native tests, build, lint, Rust checks, platform smoke tests,
    privacy payload inspection, and `git diff --check` before stopping.

## Acceptance criteria

Phase 10 is complete only when all of the following are true:

1. Desktop awareness is off by default and no observer starts before explicit,
   versioned consent.
2. The public event path contains only broad category, bucketed idle, and
   lock/unlock transitions; it contains no raw identity or user content.
3. Raw foreground identity is minimized inside native classification and never
   reaches JavaScript, persona data, settings, diagnostics, persistence, or
   normal logs.
4. The implementation reads no titles, URLs, screen pixels, typed input,
   clipboard data, files, messages, document content, or full process lists.
5. Windows and macOS use the narrowest supported APIs and do not request
   content-oriented permissions; unsupported sub-capabilities degrade safely.
6. Category changes are debounced/deduped, idle/return/lock events are
   transition-based, and no high-frequency frontend polling or activity log is
   created.
7. System idle and Phase 8 pointer idle have one authoritative return semantic
   and cannot duplicate greetings.
8. Desktop events reuse `ContextEventBus`, `ReactionEngine`, `BehaviorEngine`,
   Runtime Command, and Speech Coordinator boundaries.
9. Drag/click/lifecycle commands preempt desktop reactions, and all stale native
   samples/reaction work are generation-guarded.
10. Phase 9 character personas may opt into public categories but cannot access
    or infer raw app identity.
11. Settings migrate deterministically with awareness disabled and store no
    current category or activity history.
12. UI disclosure, capability/status display, and disable controls accurately
    describe and control tested behavior.
13. Privacy contract, classifier, source, lifecycle, partial-capability, and
    product scenario tests pass without observing the real desktop.
14. `pnpm test`, `pnpm build`, `pnpm lint`, Rust tests, `cargo check`, platform
    smoke tests, and `git diff --check` all pass.
15. `docs/architecture/desktop-awareness.md` provides enough detail for a
    future agent and privacy reviewer to extend categories without chat history.

## Delivery expectation for Codex

Codex should treat this document as the Phase 10 execution and privacy
contract.

Do not stop after detecting the foreground process or adding a settings toggle.
Deliver consent, native minimization, coarse classifier, typed source,
generation-safe lifecycle, sparse persona reactions, settings migration,
platform capability handling, privacy tests, security review, diagnostics, and
architecture documentation together.

If a desired reaction requires window titles, URLs, screen content, raw input,
Accessibility, process enumeration, persistent history, or broader permissions,
do not improvise a workaround. Defer it to a separately approved phase with a
new privacy design.
