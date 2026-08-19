# Desktop Awareness Architecture and Privacy Contract

## Purpose and consent

Phase 10 adds optional, local reactions to a deliberately small set of desktop
state transitions. `desktopAwarenessEnabled` defaults to `false`; the native
observer cannot start until settings are loaded, disclosure version 1 has been
accepted, the persona is ready, personality is enabled, and the pet is visible.
Opening settings, hiding, disabling, character replacement, reload, and destroy
stop the observer or invalidate its generation. Declining the disclosure does
not change settings or start native work.

The disclosure states that Ark Pet observes only aggregate system idle state,
session availability, and a broad category for the foreground application. It
also lists the excluded data and provides immediate disablement. The consent
version is local migration state, not telemetry.

## Collected and prohibited data

Permitted ephemeral frontend state is limited to:

- one public application category;
- active/idle plus `short`, `medium`, or `long` idle bucket;
- available/locked session state when supported;
- source status, capability states, generation, last public event type, and a
  bounded safe error code.

The implementation does not collect or retain window titles, URLs, browser
history or content, screen pixels, files, document/project names, clipboard,
typed input or individual pointer events, messages, process/window lists,
command lines, per-app dwell time, activity timelines, telemetry, or stable
hashes of application identity. Awareness state is not persisted. Normal native
logging contains neither raw identity nor coarse samples.

## Native minimization boundary

The webview exposes only two narrow commands: start and stop desktop awareness.
There is no process-list, foreground-process, executable-path, window-title, or
screen API. Native sampling runs every 1.5 seconds and emits only when the
coarse sample changes.

On Windows, the adapter asks `GetForegroundWindow` for the single foreground
window, obtains its owning PID, uses `PROCESS_QUERY_LIMITED_INFORMATION` only
long enough to read the executable identity, reduces it to a normalized exact
basename, classifies it, and drops both path and basename before IPC.
`GetLastInputInfo` supplies aggregate idle duration without input hooks.
`OpenInputDesktop` provides a narrow available/locked signal; while locked the
adapter does not inspect a foreground identity.

On macOS, `NSWorkspace.frontmostApplication.bundleIdentifier` supplies a stable
identity that is classified and dropped within the adapter.
`CGEventSourceSecondsSinceLastEventType` supplies aggregate idle duration and
does not install an event tap. The current adapter reports session lock as
unsupported rather than infer it unreliably. It requests no Accessibility,
Input Monitoring, Automation, or Screen Recording permission. Other platforms
report all three capabilities unsupported.

## Classifier policy (version 1)

The native mappings are bounded reviewed match tables. Windows matches a
lowercase executable basename; macOS matches a lowercase bundle identifier.
Matches are exact. Unknown values return `unknown`; the adapter never falls back
to titles, paths, fuzzy matching, process enumeration, a shell command, or a
network lookup. Mapping changes are normal reviewed releases. Tests use only
synthetic identifiers.

Public categories are:

`development`, `browsing`, `communication`, `productivity`, `creative`,
`media`, `gaming`, `system`, `other`, and `unknown`.

Character packages can match only these enum values through the strict persona
schema. Unknown fields—including identity, title, URL, path, or free-form
metadata on a condition—are rejected.

## Public events and source semantics

`DesktopContextSource` converts coarse samples into the existing
`ContextEventBus` vocabulary:

- `desktop.activity-category-entered(category)` after a two-second stable
  debounce; transitions within the same category emit nothing;
- `desktop.system-idle-entered(idleBucket)` once when crossing from active;
- `desktop.system-idle-returned(idleBucket)` once on return;
- `desktop.session-locked` and `desktop.session-unlocked` once per transition.

Buckets are code-configured and shared: short is 5–14 minutes, medium is 15–59
minutes, and long is 60 minutes or more. Precise duration never crosses IPC.
Event timestamps come from the webview monotonic clock and are not persisted.

Lock clears pending category work and suppresses category/idle processing.
Unlock starts from clean category and idle state, so no locked transitions are
replayed. The source has an observer generation; late start completions,
timers, or stopped subscriptions cannot publish into a newer generation.
Stop/destroy and listener teardown are idempotent.

When native system idle is active, `SessionContextSource` disables its Phase 8
pointer-idle return emission. Phase 8 and Phase 10 return reactions also share
the `pepe.return` cooldown group. This provides one authoritative greeting path.

## Reaction lifecycle

Desktop events use `ContextEventBus`, the active strict persona,
`ReactionEngine`, `RuntimeReactionAdapter`, `BehaviorEngine`, and
`SpeechSessionCoordinator`. Desktop rules do not call animation, speech, or
native APIs directly. Manual click and drag reactions have higher priority and
cancel active lower-priority work. Return/unlock rules are medium priority;
category rules are deliberately low priority with long cooldowns.

Hide, settings interaction, disable, personality disable, reload, character
switch, persona replacement, and destroy cancel pending reaction execution and
invalidate desktop observation. Showing or closing settings starts a fresh
source generation and category debounce without replay.

To add a safe persona reaction, select one public desktop event, use only the
strict `desktop-category` or `idle-bucket` condition where applicable, keep
category priority below manual interaction, and assign a long cooldown. Adding
new categories or native fields requires a separate privacy review and schema
change.

## Capability and failure behavior

Foreground category, system idle, and session lock are reported independently
as `available`, `unsupported`, `denied`, or `error`. Current adapters report
only states they can support without broader permission. Start failures become
the bounded code `observer-start-failed`; raw native values are never included.
Unknown classification is a normal result and never causes broader inspection.
Unsupported platforms remain stable and do not start a polling thread.

## Verification checklist

- Confirm an upgrade migrates with awareness disabled and null consent.
- Confirm Not now starts no observer and Enable records disclosure version 1.
- Inspect emitted JSON: only category, bucketed idle state, and optional session
  state are allowed.
- Search Tauri commands for generic process, title, window-list, screen, input,
  clipboard, shell, or network operations; none may exist for awareness.
- Verify known exact synthetic identities and unknown/fuzzy identities in Rust
  classifier tests.
- Verify source gating, debounce, dedupe, idle return, lock suppression,
  generation invalidation, privacy payload, and idempotent destroy tests.
- Verify hide/settings/disable stop observation and show starts fresh.
- Verify Phase 8 pointer idle cannot duplicate an authoritative system-idle
  return and both persona rules share `pepe.return`.
- Confirm no awareness values are persisted or written to production logs.
- Run frontend tests/build/lint, Rust tests/check, a Windows smoke test, and
  `git diff --check` before acceptance.
