import { describe, expect, it, vi } from 'vitest'
import type { CharacterPersona } from '../persona/types'
import { ReactionEngine } from './ReactionEngine'
import type { ReactionExecutionPort } from './types'

function setup(reactions: CharacterPersona['reactions'], random = 0) {
  let now = 0
  const executed: string[] = []
  let resolveActive: (() => void) | null = null
  const port: ReactionExecutionPort = {
    supports: (plan) => !plan.steps.some((step) => step.type === 'animation' && step.name === 'Missing'),
    execute: (plan) => { executed.push(plan.reactionId); return new Promise<void>((resolve) => { resolveActive = resolve }) },
    cancel: vi.fn(),
  }
  const persona: CharacterPersona = { version: 1, characterId: 'test', displayName: 'Test', reactions }
  const engine = new ReactionEngine(persona, { now: () => now }, { next: () => random }, port)
  return { engine, port, executed, setNow: (value: number) => { now = value }, finish: () => resolveActive?.() }
}

describe('ReactionEngine', () => {
  it('matches rules and makes deterministic weighted selections', () => {
    const rules: CharacterPersona['reactions'] = [
      { id: 'a', event: 'pet.clicked', priority: 2, weight: 1, conditions: [{ type: 'click-count', max: 1 }], plan: [{ type: 'wait', durationMs: 1 }] },
      { id: 'b', event: 'pet.clicked', priority: 2, weight: 3, conditions: [{ type: 'click-count', max: 1 }], plan: [{ type: 'wait', durationMs: 1 }] },
    ]
    expect(setup(rules, 0).engine.handle({ type: 'pet.clicked', at: 0, clickCount: 1 })).toBe('a')
    expect(setup(rules, 0.5).engine.handle({ type: 'pet.clicked', at: 0, clickCount: 1 })).toBe('b')
    expect(setup(rules).engine.handle({ type: 'pet.clicked', at: 0, clickCount: 2 })).toBeNull()
  })

  it('blocks cooldowns and unsupported capabilities', () => {
    const { engine, setNow } = setup([
      { id: 'cool', event: 'session.started', priority: 1, cooldownMs: 100, plan: [{ type: 'wait', durationMs: 1 }] },
      { id: 'missing', event: 'pet.clicked', priority: 1, plan: [{ type: 'animation', name: 'Missing' }] },
    ])
    expect(engine.handle({ type: 'session.started', at: 0 })).toBe('cool')
    expect(engine.handle({ type: 'session.started', at: 1 })).toBeNull()
    expect(engine.getSnapshot().blockedReason).toContain('cooldown')
    setNow(101)
    expect(engine.handle({ type: 'session.started', at: 101 })).toBe('cool')
    expect(engine.handle({ type: 'pet.clicked', at: 101, clickCount: 1 })).toBeNull()
  })

  it('replaces lower priority, rejects lower priority, and ignores stale completion', async () => {
    const { engine, port, finish } = setup([
      { id: 'low', event: 'session.started', priority: 1, plan: [{ type: 'wait', durationMs: 1 }] },
      { id: 'high', event: 'pet.clicked', priority: 10, plan: [{ type: 'wait', durationMs: 1 }] },
    ])
    engine.handle({ type: 'session.started', at: 0 })
    expect(engine.handle({ type: 'pet.clicked', at: 1, clickCount: 1 })).toBe('high')
    expect(port.cancel).toHaveBeenCalledWith('replaced')
    finish(); await Promise.resolve()
    expect(engine.getSnapshot().activeReactionId).toBeNull()
    engine.handle({ type: 'pet.clicked', at: 2, clickCount: 1 })
    expect(engine.handle({ type: 'session.started', at: 3 })).toBeNull()
  })

  it('cancels for disable and destroy idempotently', () => {
    const { engine, port } = setup([{ id: 'x', event: 'session.started', priority: 1, plan: [{ type: 'wait', durationMs: 1 }] }])
    engine.handle({ type: 'session.started', at: 0 })
    engine.setEnabled(false)
    expect(engine.handle({ type: 'session.started', at: 1 })).toBeNull()
    engine.destroy(); engine.destroy()
    expect(port.cancel).toHaveBeenCalled()
    expect(engine.getSnapshot().activeState).toBe('destroyed')
  })

  it('persists explicit once-per-local-day cooldowns', () => {
    let stored: string | null = null
    const persona: CharacterPersona = {
      version: 1, characterId: 'test', displayName: 'Test',
      reactions: [{ id: 'night', event: 'time.period-entered', priority: 1, oncePerLocalDay: true, plan: [{ type: 'wait', durationMs: 1 }] }],
    }
    const engine = new ReactionEngine(
      persona, { now: () => 0 }, { next: () => 0 },
      { supports: () => true, execute: () => {}, cancel: () => {} },
      undefined, undefined,
      { currentDate: () => '2026-01-01', getDate: () => stored, setDate: (_key, date) => { stored = date } },
    )
    const event = { type: 'time.period-entered', at: 0, period: 'late-night' } as const
    expect(engine.handle(event)).toBe('night')
    expect(engine.handle(event)).toBeNull()
    expect(engine.getSnapshot().blockedReason).toBe('daily cooldown')
    expect(engine.getSnapshot().decisionLog.at(-1)).toContain('Blocked time.period-entered: daily cooldown')
  })
})
