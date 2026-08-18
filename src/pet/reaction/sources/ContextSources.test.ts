import { describe, expect, it } from 'vitest'
import { ContextEventBus } from '../ContextEventBus'
import type { ContextEvent } from '../types'
import { InteractionContextSource } from './InteractionContextSource'
import { SessionContextSource } from './SessionContextSource'
import { TimeContextSource } from './TimeContextSource'

describe('reaction context sources', () => {
  it('aggregates repeated clicks into one event', () => {
    const events: ContextEvent[] = []; const bus = new ContextEventBus(); bus.subscribe((event) => events.push(event))
    const source = new InteractionContextSource(bus, { clickAggregationMs: 10 })
    source.recordClick(0); source.recordClick(5); source.update(14); expect(events).toHaveLength(0)
    source.update(15); expect(events).toEqual([{ type: 'pet.clicked', at: 15, clickCount: 2 }])
  })

  it('discards a pending click when a drag starts', () => {
    const events: ContextEvent[] = []; const bus = new ContextEventBus(); bus.subscribe((event) => events.push(event))
    const source = new InteractionContextSource(bus, { clickAggregationMs: 10 })
    source.recordClick(0); source.dragStarted(5); source.update(10); source.dragEnded(15)
    expect(events).toEqual([
      { type: 'pet.drag-started', at: 5 },
      { type: 'pet.drag-ended', at: 15, durationMs: 10 },
    ])
  })

  it('emits first meeting once per date, returned only past idle, and long-active with spacing', () => {
    const events: ContextEvent[] = []; const bus = new ContextEventBus(); bus.subscribe((event) => events.push(event))
    let marker: string | null = null
    const source = new SessionContextSource(bus, { getLastDate: () => marker, setLastDate: (v) => { marker = v }, clear: () => { marker = null } }, { idleThresholdMs: 10, longActiveThresholdMs: 20, longActiveRepeatMs: 30 })
    source.characterReady(0, '2026-01-01'); source.recordActivity(5); source.recordActivity(15); source.update(20); source.update(30); source.update(50)
    expect(events.filter((event) => event.type === 'session.first-meeting-today')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'session.user-returned')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'session.long-active')).toHaveLength(2)
    source.reset(); source.characterReady(60, '2026-01-01')
    expect(events.filter((event) => event.type === 'session.first-meeting-today')).toHaveLength(1)
  })

  it('emits time periods only on entry, including late-night startup', () => {
    const events: ContextEvent[] = []; const bus = new ContextEventBus(); bus.subscribe((event) => events.push(event))
    let hour = 23; const source = new TimeContextSource(bus, () => hour); source.setReady(true)
    source.update(0); source.update(60_000); hour = 9; source.update(120_000)
    expect(events).toEqual([
      { type: 'time.period-entered', at: 0, period: 'late-night' },
      { type: 'time.period-entered', at: 120_000, period: 'morning' },
    ])
  })

  it('checks the current period immediately after becoming ready again', () => {
    const events: ContextEvent[] = []; const bus = new ContextEventBus(); bus.subscribe((event) => events.push(event))
    let hour = 23; const source = new TimeContextSource(bus, () => hour)
    source.setReady(true); source.update(100)
    source.setReady(false); hour = 9; source.setReady(true); source.update(200)
    expect(events).toEqual([
      { type: 'time.period-entered', at: 100, period: 'late-night' },
      { type: 'time.period-entered', at: 200, period: 'morning' },
    ])
  })

  it('does not block startup when first-meeting persistence fails', () => {
    const events: ContextEvent[] = []; const bus = new ContextEventBus(); bus.subscribe((event) => events.push(event))
    const source = new SessionContextSource(bus, {
      getLastDate: () => { throw new Error('read denied') },
      setLastDate: () => { throw new Error('write denied') },
      clear: () => {},
    })
    expect(() => source.characterReady(0, '2026-01-01')).not.toThrow()
    expect(events.some((event) => event.type === 'session.first-meeting-today')).toBe(true)
  })
})
