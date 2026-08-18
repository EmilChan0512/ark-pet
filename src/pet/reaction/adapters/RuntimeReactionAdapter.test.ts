import { describe, expect, it, vi } from 'vitest'
import { RuntimeReactionAdapter } from './RuntimeReactionAdapter'

describe('RuntimeReactionAdapter', () => {
  it('executes bounded steps in order and advances waits from ticker time', async () => {
    const calls: string[] = []
    const adapter = new RuntimeReactionAdapter({
      hasAnimation: () => true, hasBehavior: () => true,
      requestAnimation: (name) => calls.push(`animation:${name}`),
      requestBehavior: (id) => { calls.push(`behavior:${id}`) },
      enqueueSpeech: (request) => calls.push(`speak:${request.text}`),
    })
    let valid = true
    adapter.update(100)
    const completion = adapter.execute({ reactionId: 'plan', priority: 1, steps: [
      { type: 'animation', name: 'Touch' }, { type: 'wait', durationMs: 20 },
      { type: 'speak', text: 'Hello', source: 'interaction' },
    ] }, { generation: 1, isValid: () => valid })
    expect(calls).toEqual(['animation:Touch'])
    adapter.update(119); expect(calls).toHaveLength(1)
    adapter.update(120); await completion
    expect(calls).toEqual(['animation:Touch', 'speak:Hello'])
    valid = false
  })

  it('rejects unsupported plans and prevents stale steps after cancellation', async () => {
    const speak = vi.fn()
    const adapter = new RuntimeReactionAdapter({
      hasAnimation: (name) => name !== 'Missing', hasBehavior: () => true,
      requestAnimation: vi.fn(), requestBehavior: vi.fn(), enqueueSpeech: speak,
    })
    expect(adapter.supports({ reactionId: 'bad', priority: 1, steps: [{ type: 'animation', name: 'Missing' }] })).toBe(false)
    adapter.update(0)
    const completion = adapter.execute({ reactionId: 'wait', priority: 1, steps: [
      { type: 'wait', durationMs: 10 }, { type: 'speak', text: 'stale', source: 'ambient' },
    ] }, { generation: 1, isValid: () => true })
    adapter.cancel('hidden'); adapter.update(20); await completion
    expect(speak).not.toHaveBeenCalled()
  })
})
