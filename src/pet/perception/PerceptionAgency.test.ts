import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextEventBus } from '../reaction/ContextEventBus'
import type {
  CoarseDesktopSample,
  DesktopAwarenessCapabilities,
  DesktopAwarenessPort,
  DesktopAwarenessStartOptions,
} from '../reaction/sources/DesktopContextSource'
import {
  DesktopTitlePerceptionModule,
  PerceptionAgency,
  PerceptionModuleRegistry,
} from './PerceptionAgency'

class FakeDesktopPort implements DesktopAwarenessPort {
  private listener: ((sample: CoarseDesktopSample) => void) | null = null
  start(_options: DesktopAwarenessStartOptions): Promise<DesktopAwarenessCapabilities> {
    return Promise.resolve({
      foregroundCategory: 'available', foregroundTitle: 'available',
      systemIdle: 'available', sessionLock: 'available',
    })
  }
  stop() { return Promise.resolve() }
  subscribe(listener: (sample: CoarseDesktopSample) => void) {
    this.listener = listener
    return () => { this.listener = null }
  }
  emit(windowTitle: string) { this.listener?.({ windowTitle }) }
}

function createSubject(options: { now?: () => number; stableMs?: number } = {}) {
  const port = new FakeDesktopPort()
  const bus = new ContextEventBus()
  const events: unknown[] = []
  bus.subscribe((event) => events.push(event))
  const agency = new PerceptionAgency(
    bus,
    new PerceptionModuleRegistry([new DesktopTitlePerceptionModule(port, options.now)]),
    () => {},
    options.now,
    options.stableMs ?? 100,
  )
  return { port, events, agency }
}

describe('PerceptionAgency', () => {
  afterEach(() => vi.useRealTimers())

  it('waits for a stable title, interprets it locally, and publishes initiative', async () => {
    vi.useFakeTimers()
    const { port, events, agency } = createSubject({ now: () => 42 })
    agency.configure({ enabled: true, ready: true, initiativeEnabled: true, style: 'balanced' })
    port.emit('build FAILED — private-client-name')
    await vi.advanceTimersByTimeAsync(99)
    expect(events).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(events).toEqual([{ type: 'perception.scene-noticed', at: 42, scene: 'coding-problem' }])
    expect(agency.getSnapshot()).toMatchObject({
      status: 'ready', scene: 'coding-problem', mood: 'concerned',
      lastObservation: 'Foreground window title changed',
    })
    expect(JSON.stringify(agency.getSnapshot())).not.toContain('private-client-name')
    agency.destroy()
  })

  it('invalidates pending observations when permission is disabled', async () => {
    vi.useFakeTimers()
    const { port, events, agency } = createSubject()
    agency.configure({ enabled: true, ready: true, initiativeEnabled: true, style: 'expressive' })
    port.emit('YouTube')
    agency.configure({ enabled: false, ready: true, initiativeEnabled: true, style: 'expressive' })
    await vi.advanceTimersByTimeAsync(200)
    expect(events).toEqual([])
    expect(agency.getSnapshot()).toMatchObject({ status: 'off', blockedReason: 'content perception disabled' })
    agency.destroy()
  })

  it('uses personality thresholds instead of runtime approval controls', async () => {
    vi.useFakeTimers()
    const quiet = createSubject()
    quiet.agency.configure({ enabled: true, ready: true, initiativeEnabled: true, style: 'quiet' })
    quiet.port.emit('YouTube')
    await vi.advanceTimersByTimeAsync(100)
    expect(quiet.events).toEqual([])
    expect(quiet.agency.getSnapshot().blockedReason).toBe('attention below personality threshold')
    quiet.agency.destroy()

    const expressive = createSubject()
    expressive.agency.configure({ enabled: true, ready: true, initiativeEnabled: true, style: 'expressive' })
    expressive.port.emit('A completely ordinary window')
    await vi.advanceTimersByTimeAsync(100)
    expect(expressive.events).toHaveLength(1)
    expressive.agency.destroy()
  })

  it('deduplicates stable titles and applies an initiative cooldown', async () => {
    vi.useFakeTimers()
    let now = 1_000_000
    const { port, events, agency } = createSubject({ now: () => now })
    agency.configure({ enabled: true, ready: true, initiativeEnabled: true, style: 'expressive' })
    port.emit('Error in build')
    await vi.advanceTimersByTimeAsync(100)
    port.emit('Error in build')
    await vi.advanceTimersByTimeAsync(100)
    port.emit('YouTube')
    await vi.advanceTimersByTimeAsync(100)
    expect(events).toHaveLength(1)
    expect(agency.getSnapshot().blockedReason).toBe('initiative cooldown')
    now += 8 * 60_000
    port.emit('Chat with team')
    await vi.advanceTimersByTimeAsync(100)
    expect(events).toHaveLength(2)
    agency.destroy()
  })
})
