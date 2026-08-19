import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextEventBus } from '../ContextEventBus'
import { DesktopContextSource, type CoarseDesktopSample, type DesktopAwarenessPort } from './DesktopContextSource'

class FakeDesktopPort implements DesktopAwarenessPort {
  starts = 0
  stops = 0
  listener: ((sample: CoarseDesktopSample) => void) | null = null
  async start() {
    this.starts += 1
    return { foregroundCategory: 'available', systemIdle: 'available', sessionLock: 'available' } as const
  }
  async stop() { this.stops += 1 }
  subscribe(listener: (sample: CoarseDesktopSample) => void) { this.listener = listener; return () => { this.listener = null } }
  emit(sample: CoarseDesktopSample) { this.listener?.(sample) }
}

describe('DesktopContextSource', () => {
  afterEach(() => vi.useRealTimers())

  it('stays off until enabled, consented, ready, and visible', async () => {
    const port = new FakeDesktopPort()
    const source = new DesktopContextSource(new ContextEventBus(), port)
    await source.configure({ enabled: false, consented: false, ready: true, visible: true })
    await source.configure({ enabled: true, consented: false, ready: true, visible: true })
    expect(port.starts).toBe(0)
    await source.configure({ enabled: true, consented: true, ready: true, visible: true })
    expect(port.starts).toBe(1)
    expect(source.getSnapshot().status).toBe('active')
    await source.destroy()
  })

  it('debounces categories and deduplicates the same coarse category', async () => {
    vi.useFakeTimers()
    const port = new FakeDesktopPort()
    const events: string[] = []
    const bus = new ContextEventBus()
    bus.subscribe((event) => events.push(event.type))
    const source = new DesktopContextSource(bus, port, () => {}, () => 42, 2000)
    await source.configure({ enabled: true, consented: true, ready: true, visible: true })
    port.emit({ category: 'development' })
    port.emit({ category: 'development' })
    await vi.advanceTimersByTimeAsync(1999)
    expect(events).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(events).toEqual(['desktop.activity-category-entered'])
    port.emit({ category: 'development' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(events).toHaveLength(1)
    await source.destroy()
  })

  it('emits one bucketed idle return and suppresses desktop samples while locked', async () => {
    vi.useFakeTimers()
    const port = new FakeDesktopPort()
    const events: unknown[] = []
    const bus = new ContextEventBus()
    bus.subscribe((event) => events.push(event))
    const source = new DesktopContextSource(bus, port, () => {}, () => 100, 10)
    await source.configure({ enabled: true, consented: true, ready: true, visible: true })
    port.emit({ idleState: 'idle', idleBucket: 'long', sessionState: 'available' })
    port.emit({ idleState: 'active', sessionState: 'available' })
    port.emit({ idleState: 'active', sessionState: 'available' })
    port.emit({ sessionState: 'locked', category: 'gaming' })
    await vi.advanceTimersByTimeAsync(20)
    port.emit({ sessionState: 'available', category: 'development' })
    await vi.advanceTimersByTimeAsync(10)
    expect(events).toEqual([
      { type: 'desktop.system-idle-returned', at: 100, idleBucket: 'long' },
      { type: 'desktop.session-locked', at: 100 },
      { type: 'desktop.session-unlocked', at: 100 },
      { type: 'desktop.activity-category-entered', at: 100, category: 'development' },
    ])
    await source.destroy()
  })

  it('invalidates pending samples on hide and destroy idempotently', async () => {
    vi.useFakeTimers()
    const port = new FakeDesktopPort()
    const events: string[] = []
    const bus = new ContextEventBus()
    bus.subscribe((event) => events.push(event.type))
    const source = new DesktopContextSource(bus, port, () => {}, () => 0, 50)
    await source.configure({ enabled: true, consented: true, ready: true, visible: true })
    port.emit({ category: 'gaming' })
    await source.configure({ enabled: true, consented: true, ready: true, visible: false })
    await vi.advanceTimersByTimeAsync(100)
    expect(events).toEqual([])
    await source.destroy()
    await source.destroy()
    expect(port.stops).toBeGreaterThanOrEqual(1)
  })

  it('frontend coarse payload cannot contain raw identity fields', () => {
    const payload: CoarseDesktopSample = { category: 'unknown', idleState: 'active', sessionState: 'available' }
    expect(Object.keys(payload).sort()).toEqual(['category', 'idleState', 'sessionState'])
    expect(JSON.stringify(payload)).not.toMatch(/process|path|title|url|identity|window/i)
  })
})
