# Phase 6 Requirements: Runtime Command Boundary

## Goal

Establish one deterministic command boundary for application-level runtime
operations before adding more integrations. Tray actions, React settings,
visibility, character reload, and shutdown must no longer call asynchronous
runtime methods independently and race each other.

This phase is architecture-first. It adds no network service, Wiki API, AI
dependency, notification integration, public plugin loader, or new pet action.

## Command architecture

All external runtime operations are expressed as typed commands and dispatched
through a pure TypeScript coordinator:

- initialize;
- show or hide;
- reload character;
- request settings;
- apply the latest settings snapshot;
- enter or leave UI interaction mode;
- destroy.

The coordinator owns ordering only. `PetRuntime` continues to own rendering,
character, behavior, input, and native-window effects. React and Tauri remain
adapters at the outside edge.

## Ordering and coalescing

- At most one command handler may execute at a time.
- FIFO order is preserved for commands that are not superseded.
- Pending settings snapshots use latest-wins coalescing.
- Pending UI interaction state uses latest-wins coalescing.
- Pending show/hide commands share a visibility key; only the final intent runs.
- Duplicate pending reload and settings-request commands are coalesced.
- An already executing operation is never silently cancelled.
- Every dispatch resolves with `executed`, `superseded`, `failed`, or
  `rejected-destroyed`; callers do not hang when a command is replaced.

## Shutdown invariant

Requesting destroy closes the input boundary immediately, supersedes all
pending non-destroy commands, waits for the one in-flight command, and executes
destroy exactly once. Commands arriving afterward are rejected without calling
runtime ports.

This does not forcibly abort native APIs already in progress. Their ownership
remains with `PetRuntime` and its behavior/platform adapters.

## Failure containment and diagnostics

A failed command:

- is reported through an injected diagnostic callback;
- resolves as `failed` instead of creating an unhandled rejection;
- does not block later commands, except that destroy still closes the boundary;
- updates a detached snapshot containing active command, queue depth, terminal
  state, generation, and last error.

Snapshot consumers are observational. Their own failures cannot break command
processing.

## Dependency constraints

The coordinator must not import React, Pixi, Spine, Tauri, browser globals, or
`PetRuntime`. It receives a narrow handler port. Command payloads may use pure
application data types such as `PetSettings`.

## Documentation and comments

- Add a command-boundary architecture guide linked from README.
- Document queue ownership, latest-wins semantics, terminal shutdown, and the
  rule for adding future command sources.
- Add TSDoc to public contracts and comments only where concurrency or
  ownership would otherwise be ambiguous.

## Acceptance criteria

1. The coordinator is pure TypeScript with no UI, renderer, platform, timer, or
   browser dependency.
2. Tests prove FIFO execution and at-most-one active handler.
3. Tests prove all coalescing keys and that superseded dispatches resolve.
4. Destroy closes input immediately, drains the in-flight operation, runs once,
   and rejects later commands.
5. Handler and diagnostic failures are contained and do not stall the queue.
6. React effects and tray callbacks dispatch commands rather than calling
   asynchronous `PetRuntime` lifecycle methods directly.
7. Opening settings is idempotent and cannot accidentally toggle closed from a
   repeated tray event.
8. Debug state exposes active command, queue depth, and last command error.
9. Existing pet interaction, autonomous behavior, settings, reload, hide/show,
   tray, and cleanup behavior remains intact.
10. Unit tests, lint, TypeScript build, native Tauri build, and runtime smoke
    test pass.
