# Runtime Command Boundary

Phase 6 gives every application-level runtime operation one ordered entrance.
This guide is for maintainers and future AI agents adding command sources.

## Responsibility map

```text
React effects / tray / future local integrations
                    |
                    v
          RuntimeCommandCoordinator
          ordering, coalescing, terminal state
                    |
                    v
             RuntimeCommandHandler
                    |
                    v
                PetRuntime
     renderer, behavior, input, native effects
```

The coordinator does not know how a command is implemented. `PetRuntime` does
not know whether intent originated from React, the tray, or a future local
integration.

## Queue ownership

One coordinator owns one runtime instance. It executes only the queue head and
does not start another handler until that handler settles. Do not add a second
queue inside a tray or UI adapter; doing so would make cross-source ordering
undefined.

Coalescing applies only to commands still waiting in the queue. The coordinator
does not abort an executing native operation. Latest-wins commands resolve the
older dispatch as `superseded`, so no caller is left waiting forever.

## Terminal ownership

Destroy is a terminal command. Dispatch closes the boundary synchronously,
before the asynchronous handler runs. This prevents an unmount, quit, or late
React effect from enqueueing work behind destruction. The current handler is
allowed to settle, pending work is superseded, and runtime cleanup runs once.

## Adding a command

1. Add a discriminated command variant with a stable type.
2. Decide explicitly whether it is FIFO-only or has a latest-wins key.
3. Add the handler case at the application composition root.
4. Route every source through `dispatch`; do not expose a parallel direct call.
5. Test ordering, coalescing, failure, and destroy interaction.
6. Extend debug fields only when they help diagnose ownership or queue health.
7. Update this guide and the current phase requirements.

High-frequency pointer and ticker updates do not belong here. They already have
specialized single-owner paths with stricter latency requirements.
