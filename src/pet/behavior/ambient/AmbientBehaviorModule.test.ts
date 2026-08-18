import { describe, expect, it, vi } from 'vitest'
import {
  AMBIENT_BEHAVIOR_IDS,
  createAmbientBehaviorDefinitions,
  type AmbientAnimationKind,
  type AmbientBehaviorContext,
  type PhysicalWindowGeometry,
} from './AmbientBehaviorModule'
import type { FacingDirection } from '../../../types/character'

function context(options: {
  random?: number[]
  geometry?: PhysicalWindowGeometry | null
  available?: AmbientAnimationKind[]
} = {}) {
  const randomValues = options.random ?? [0]
  let randomIndex = 0
  const entered: AmbientAnimationKind[] = []
  const facings: FacingDirection[] = []
  const positions: Array<{ x: number; y: number }> = []
  const cancel = vi.fn(async () => {})
  const available = new Set(options.available ?? ['walk', 'sit', 'sleep'])

  const ports: AmbientBehaviorContext = {
    ambientAnimation: {
      has: (kind) => available.has(kind),
      enter: (kind) => entered.push(kind),
      setFacing: (direction) => facings.push(direction),
    },
    windowMotion: {
      getGeometry: async () =>
        options.geometry === undefined
          ? {
              position: { x: 750, y: 100 },
              size: { width: 200, height: 300 },
              workArea: {
                position: { x: 0, y: 0 },
                size: { width: 1_000, height: 800 },
              },
            }
          : options.geometry,
      requestPosition: (x, y) => positions.push({ x, y }),
      cancel,
    },
    random: {
      next: () => randomValues[randomIndex++] ?? randomValues.at(-1) ?? 0,
    },
  }

  return { ports, entered, facings, positions, cancel }
}

function findDefinition(id: string) {
  const definition = createAmbientBehaviorDefinitions<AmbientBehaviorContext>().find(
    (candidate) => candidate.id === id,
  )
  if (!definition) throw new Error(`Missing test definition: ${id}`)
  return definition
}

describe('ambient behavior definitions', () => {
  it('clamps walking to the work area and limits large frame gaps', async () => {
    const test = context({ random: [0.9, 0.999, 0] })
    const instance = findDefinition(AMBIENT_BEHAVIOR_IDS.walk).create(test.ports)

    await instance.enter?.(new AbortController().signal)
    expect(test.entered).toEqual(['walk'])
    expect(test.facings).toEqual(['right'])

    expect(instance.update?.(0)).toBe('continue')
    expect(instance.update?.(10_000)).toBe('continue')
    expect(test.positions[0]?.x).toBeCloseTo(753)

    let result = instance.update?.(10_050)
    for (let now = 10_100; result !== 'completed' && now < 20_000; now += 50) {
      result = instance.update?.(now)
    }
    expect(result).toBe('completed')
    expect(test.positions.at(-1)?.x).toBe(800)
    await instance.exit?.('completed')
    expect(test.cancel).toHaveBeenCalledOnce()
  })

  it('completes safely when monitor geometry is unavailable', async () => {
    const test = context({ geometry: null })
    const instance = findDefinition(AMBIENT_BEHAVIOR_IDS.walk).create(test.ports)

    await instance.enter?.(new AbortController().signal)
    expect(instance.update?.(0)).toBe('completed')
    expect(test.entered).toEqual([])
  })

  it('runs sitting for a deterministic bounded duration', async () => {
    const test = context({ random: [0] })
    const instance = findDefinition(AMBIENT_BEHAVIOR_IDS.sit).create(test.ports)

    await instance.enter?.(new AbortController().signal)
    expect(test.entered).toEqual(['sit'])
    expect(instance.update?.(1_000)).toBe('continue')
    expect(instance.update?.(8_999)).toBe('continue')
    expect(instance.update?.(9_000)).toBe('completed')
  })

  it('exposes eligibility through animation capabilities', () => {
    const test = context({ available: ['sleep'] })
    const definitions = createAmbientBehaviorDefinitions<AmbientBehaviorContext>()

    expect(definitions.find((item) => item.id === AMBIENT_BEHAVIOR_IDS.walk)?.isEligible?.(test.ports)).toBe(false)
    expect(definitions.find((item) => item.id === AMBIENT_BEHAVIOR_IDS.sit)?.isEligible?.(test.ports)).toBe(false)
    expect(definitions.find((item) => item.id === AMBIENT_BEHAVIOR_IDS.sleep)?.isEligible?.(test.ports)).toBe(true)
  })
})
