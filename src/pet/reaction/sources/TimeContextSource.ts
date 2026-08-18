import { ContextEventBus } from '../ContextEventBus'
import type { LocalTimePeriod } from '../types'

export function periodForHour(hour: number): LocalTimePeriod {
  if (hour >= 23 || hour < 6) return 'late-night'
  if (hour < 11) return 'morning'
  if (hour < 18) return 'day'
  return 'evening'
}

export class TimeContextSource {
  private readonly bus: ContextEventBus
  private readonly getHour: () => number
  private current: LocalTimePeriod | null = null
  private ready = false
  private nextCheckAt = 0
  constructor(bus: ContextEventBus, getHour: () => number = () => new Date().getHours()) { this.bus = bus; this.getHour = getHour }
  setReady(ready: boolean) {
    this.ready = ready
    if (!ready) {
      this.current = null
      this.nextCheckAt = 0
    }
  }
  update(now: number) {
    if (!this.ready || now < this.nextCheckAt) return
    this.nextCheckAt = now + 60_000
    const period = periodForHour(this.getHour())
    if (period === this.current) return
    this.current = period
    this.bus.publish({ type: 'time.period-entered', at: now, period })
  }
  getPeriod() { return this.current }
}
