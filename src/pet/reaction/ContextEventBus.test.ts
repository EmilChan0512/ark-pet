import { describe, expect, it, vi } from 'vitest'
import { ContextEventBus } from './ContextEventBus'

describe('ContextEventBus', () => {
  it('delivers synchronously in subscription order and supports unsubscribe', () => {
    const bus = new ContextEventBus()
    const calls: number[] = []
    const unsubscribe = bus.subscribe(() => calls.push(1))
    bus.subscribe(() => calls.push(2))
    bus.publish({ type: 'session.started', at: 0 })
    unsubscribe()
    bus.publish({ type: 'session.started', at: 1 })
    expect(calls).toEqual([1, 2, 2])
  })

  it('contains subscriber failures and stops delivery after idempotent destroy', () => {
    const reportSubscriberError = vi.fn()
    const bus = new ContextEventBus({ reportSubscriberError })
    const healthy = vi.fn()
    bus.subscribe(() => { throw new Error('broken') })
    bus.subscribe(healthy)
    bus.publish({ type: 'session.started', at: 0 })
    expect(reportSubscriberError).toHaveBeenCalledOnce()
    expect(healthy).toHaveBeenCalledOnce()
    bus.destroy(); bus.destroy()
    bus.publish({ type: 'session.started', at: 1 })
    expect(healthy).toHaveBeenCalledOnce()
  })
})
