import { describe, expect, it, vi } from 'vitest'
import { BehaviorEngine } from './BehaviorEngine'
import { BehaviorRegistry } from './BehaviorRegistry'
import { DeterministicPolicy } from './policies/DeterministicPolicy'
import type {
  BehaviorDefinition,
  BehaviorDiagnosticsPort,
  BehaviorEngineSnapshot,
  BehaviorExitReason,
} from './types'

interface TestContext {
  allowed: boolean
}

function definition(
  id: string,
  priority: number,
  hooks: {
    enter?: (signal: AbortSignal) => void | Promise<void>
    update?: () => 'continue' | 'completed' | void
    exit?: (reason: BehaviorExitReason) => void | Promise<void>
  } = {},
): BehaviorDefinition<TestContext> {
  return {
    id,
    priority,
    isEligible: (context) => context.allowed,
    create: () => hooks,
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('BehaviorRegistry', () => {
  it('rejects duplicate behavior ids', () => {
    const registry = new BehaviorRegistry<TestContext>().register(definition('core.idle', 0))
    expect(() => registry.register(definition('core.idle', 1))).toThrow(
      'Behavior already registered: core.idle',
    )
  })
})

describe('BehaviorEngine', () => {
  it('replaces a lower-priority behavior and exits it exactly once', async () => {
    const exits: BehaviorExitReason[] = []
    const registry = new BehaviorRegistry<TestContext>()
      .register(
        definition('ambient.idle', 0, {
          exit: (reason) => {
            exits.push(reason)
          },
        }),
      )
      .register(definition('manual.drag', 200))
    const engine = new BehaviorEngine(registry)

    await engine.request('ambient.idle', { allowed: true })
    await engine.request('manual.drag', { allowed: true })
    await engine.cancel('user-input')

    expect(exits).toEqual(['replaced'])
    expect(engine.getSnapshot().activeBehaviorId).toBeNull()
  })

  it('does not allow ambient behavior to interrupt a manual behavior', async () => {
    const registry = new BehaviorRegistry<TestContext>()
      .register(definition('ambient.walk', 20))
      .register(definition('manual.interaction', 100))
    const engine = new BehaviorEngine(registry)

    await engine.request('manual.interaction', { allowed: true })
    const accepted = await engine.request('ambient.walk', { allowed: true })

    expect(accepted).toBe(false)
    expect(engine.getSnapshot().activeBehaviorId).toBe('manual.interaction')
  })

  it('ignores a stale asynchronous enter after a replacement', async () => {
    const slowEnter = deferred()
    const registry = new BehaviorRegistry<TestContext>()
      .register(definition('ambient.slow', 10, { enter: () => slowEnter.promise }))
      .register(definition('manual.drag', 200))
    const engine = new BehaviorEngine(registry)

    const staleRequest = engine.request('ambient.slow', { allowed: true })
    await engine.request('manual.drag', { allowed: true })
    slowEnter.resolve()

    expect(await staleRequest).toBe(false)
    expect(engine.getSnapshot()).toMatchObject({
      activeBehaviorId: 'manual.drag',
      runState: 'active',
    })
  })

  it('reserves pending priority while a previous exit is still running', async () => {
    const slowExit = deferred()
    const registry = new BehaviorRegistry<TestContext>()
      .register(definition('ambient.current', 10, { exit: () => slowExit.promise }))
      .register(definition('manual.pending', 200))
      .register(definition('ambient.opportunistic', 20))
    const engine = new BehaviorEngine(registry)

    await engine.request('ambient.current', { allowed: true })
    const manualRequest = engine.request('manual.pending', { allowed: true })
    const ambientAccepted = await engine.request('ambient.opportunistic', { allowed: true })
    slowExit.resolve()

    expect(ambientAccepted).toBe(false)
    expect(await manualRequest).toBe(true)
    expect(engine.getSnapshot().activeBehaviorId).toBe('manual.pending')
  })

  it('allows an explicit lifecycle transition to move back to idle', async () => {
    const registry = new BehaviorRegistry<TestContext>()
      .register(definition('core.idle', 0))
      .register(definition('manual.drag', 200))
    const engine = new BehaviorEngine(registry)

    await engine.request('manual.drag', { allowed: true })
    const accepted = await engine.request('core.idle', { allowed: true }, { force: true })

    expect(accepted).toBe(true)
    expect(engine.getSnapshot().activeBehaviorId).toBe('core.idle')
  })

  it('waits for natural-completion cleanup before activating a replacement', async () => {
    const slowExit = deferred()
    const registry = new BehaviorRegistry<TestContext>()
      .register(
        definition('ambient.walk', 20, {
          update: () => 'completed',
          exit: () => slowExit.promise,
        }),
      )
      .register(definition('core.idle', 0))
    const engine = new BehaviorEngine(registry)

    await engine.request('ambient.walk', { allowed: true })
    engine.update(100)
    const idleRequest = engine.request('core.idle', { allowed: true }, { force: true })
    await Promise.resolve()
    expect(engine.getSnapshot().activeBehaviorId).toBeNull()

    slowExit.resolve()
    expect(await idleRequest).toBe(true)
    expect(engine.getSnapshot().activeBehaviorId).toBe('core.idle')
  })

  it('contains update failures and remains reusable', async () => {
    const snapshots: BehaviorEngineSnapshot[] = []
    const diagnostics: BehaviorDiagnosticsPort = {
      publish: (snapshot) => snapshots.push(snapshot),
      reportError: vi.fn(),
    }
    const registry = new BehaviorRegistry<TestContext>()
      .register(
        definition('broken.update', 10, {
          update: () => {
            throw new Error('update exploded')
          },
        }),
      )
      .register(definition('core.idle', 0))
    const engine = new BehaviorEngine(registry, diagnostics)

    await engine.request('broken.update', { allowed: true })
    engine.update(100)
    await vi.waitFor(() =>
      expect(engine.getSnapshot().lastError).toContain('update exploded'),
    )

    expect(engine.getSnapshot().activeBehaviorId).toBeNull()
    expect(await engine.request('core.idle', { allowed: true })).toBe(true)
    expect(snapshots.at(-1)?.activeBehaviorId).toBe('core.idle')
  })

  it('contains exit failures and still activates the replacement', async () => {
    const diagnostics: BehaviorDiagnosticsPort = {
      publish: vi.fn(),
      reportError: vi.fn(),
    }
    const registry = new BehaviorRegistry<TestContext>()
      .register(
        definition('broken.exit', 0, {
          exit: () => {
            throw new Error('exit exploded')
          },
        }),
      )
      .register(definition('manual.drag', 200))
    const engine = new BehaviorEngine(registry, diagnostics)

    await engine.request('broken.exit', { allowed: true })
    expect(await engine.request('manual.drag', { allowed: true })).toBe(true)

    expect(engine.getSnapshot().activeBehaviorId).toBe('manual.drag')
    expect(engine.getSnapshot().lastError).toContain('exit exploded')
    expect(diagnostics.reportError).toHaveBeenCalledOnce()
  })

  it('destroys idempotently and rejects later activation', async () => {
    const exit = vi.fn()
    const registry = new BehaviorRegistry<TestContext>().register(
      definition('core.idle', 0, { exit }),
    )
    const engine = new BehaviorEngine(registry)

    await engine.request('core.idle', { allowed: true })
    await engine.destroy()
    await engine.destroy()

    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith('destroyed')
    expect(await engine.request('core.idle', { allowed: true })).toBe(false)
    expect(engine.getSnapshot().destroyed).toBe(true)
  })
})

describe('DeterministicPolicy', () => {
  it('selects by priority and then stable id order', () => {
    const policy = new DeterministicPolicy<TestContext>()
    const candidates = [
      definition('ambient.zeta', 10),
      definition('ambient.alpha', 10),
      definition('ambient.low', 1),
    ]

    expect(policy.select(candidates, { allowed: true })).toBe('ambient.alpha')
  })
})
