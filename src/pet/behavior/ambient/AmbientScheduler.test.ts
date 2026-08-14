import { describe, expect, it } from 'vitest'
import { AmbientScheduler } from './AmbientScheduler'
import type { RandomPort } from '../types'

const IDS = {
  idle: 'core.idle',
  walk: 'ambient.walk',
  sit: 'ambient.sit',
  sleep: 'ambient.sleep',
}

function randomSequence(...values: number[]): RandomPort {
  let index = 0
  return { next: () => values[index++] ?? values.at(-1) ?? 0 }
}

function scheduler(random: RandomPort) {
  return new AmbientScheduler(IDS, random, {
    ambientDelayMinMs: 20_000,
    ambientDelayMaxMs: 45_000,
    sleepAfterMs: 180_000,
    walkWeight: 0.65,
  })
}

describe('AmbientScheduler', () => {
  it('arms a deterministic bounded delay when enabled and resumed', () => {
    const policy = scheduler(randomSequence(0.5))
    policy.setEnabled(true, 0)
    policy.resume(1_000)

    expect(policy.getSnapshot(IDS.idle)).toMatchObject({
      status: 'waiting',
      nextActionAt: 33_500,
      lastActivityAt: 1_000,
    })
  })

  it('selects walk or sit deterministically after the delay', () => {
    const walkPolicy = scheduler(randomSequence(0, 0.2))
    walkPolicy.setEnabled(true, 0)
    walkPolicy.resume(0)

    const eligible = new Set([IDS.walk, IDS.sit, IDS.sleep])
    expect(walkPolicy.update(19_999, IDS.idle, eligible)).toBeNull()
    expect(walkPolicy.update(20_000, IDS.idle, eligible)).toBe(IDS.walk)

    const sitPolicy = scheduler(randomSequence(0, 0.9))
    sitPolicy.setEnabled(true, 0)
    sitPolicy.resume(0)
    expect(sitPolicy.update(20_000, IDS.idle, eligible)).toBe(IDS.sit)
  })

  it('gives sleep priority after prolonged inactivity', () => {
    const policy = scheduler(randomSequence(0))
    policy.setEnabled(true, 0)
    policy.resume(0)

    expect(policy.update(180_000, IDS.idle, new Set([IDS.sleep]))).toBe(IDS.sleep)
  })

  it('pauses, resumes with a fresh delay, and resets on activity', () => {
    const policy = scheduler(randomSequence(0, 0, 0))
    policy.setEnabled(true, 0)
    policy.resume(0)
    policy.pause()

    expect(policy.update(30_000, IDS.idle, new Set([IDS.walk]))).toBeNull()
    expect(policy.getSnapshot(IDS.idle).status).toBe('paused')

    policy.resume(30_000)
    expect(policy.getSnapshot(IDS.idle).nextActionAt).toBe(50_000)
    policy.recordActivity(40_000)
    expect(policy.getSnapshot(IDS.idle).nextActionAt).toBe(60_000)
  })

  it('disables and destroys idempotently without future requests', () => {
    const policy = scheduler(randomSequence(0))
    policy.setEnabled(true, 0)
    policy.resume(0)
    policy.setEnabled(false, 1)

    expect(policy.update(999_999, IDS.idle, new Set([IDS.walk, IDS.sleep]))).toBeNull()
    expect(policy.getSnapshot(IDS.idle).status).toBe('disabled')

    policy.destroy()
    policy.destroy()
    policy.setEnabled(true, 1_000_000)
    expect(policy.getSnapshot(IDS.idle).status).toBe('destroyed')
  })
})
