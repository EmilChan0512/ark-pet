import { describe, expect, it, vi } from 'vitest'
import type { BehaviorEngineSnapshot } from '../types'
import { RuntimeBehaviorAdapter, type RuntimeBehaviorPorts } from './RuntimeBehaviorAdapter'

describe('RuntimeBehaviorAdapter', () => {
  it('composes an eligible ambient module without engine-specific branches', async () => {
    const entered: string[] = []
    const engineSnapshots: BehaviorEngineSnapshot[] = []
    const randomValues = [0, 0, 0, 0, 0]
    let randomIndex = 0
    const ports: RuntimeBehaviorPorts = {
      enterIdle: () => entered.push('idle'),
      enterInteraction: () => entered.push('interaction'),
      enterDrag: () => entered.push('drag'),
      ambientAnimation: {
        has: () => true,
        enter: (kind) => entered.push(kind),
        setFacing: vi.fn(),
      },
      windowMotion: {
        getGeometry: async () => ({
          position: { x: 400, y: 200 },
          size: { width: 200, height: 300 },
          workArea: {
            position: { x: 0, y: 0 },
            size: { width: 1_000, height: 800 },
          },
        }),
        requestPosition: vi.fn(),
        cancel: vi.fn(async () => {}),
      },
      random: { next: () => randomValues[randomIndex++] ?? 0 },
    }
    const adapter = new RuntimeBehaviorAdapter(
      ports,
      true,
      {
        publish: (snapshot) => engineSnapshots.push(snapshot),
        reportError: vi.fn(),
      },
    )

    adapter.refreshAmbientCapabilities()
    await adapter.resume(0)
    adapter.update(20_000)
    await vi.waitFor(() => expect(entered).toContain('walk'))

    expect(engineSnapshots.at(-1)?.activeBehaviorId).toBe('ambient.walk')
    await adapter.interruptForUser(20_001)
    await adapter.requestInteraction(20_001)
    expect(entered.at(-1)).toBe('interaction')
  })
})
