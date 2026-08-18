import { ContextEventBus } from '../ContextEventBus'

export interface FirstMeetingPersistencePort { getLastDate(): string | null; setLastDate(date: string): void; clear(): void }
export interface SessionContextOptions { idleThresholdMs: number; longActiveThresholdMs: number; longActiveRepeatMs: number }

export class SessionContextSource {
  private readonly bus: ContextEventBus
  private readonly persistence: FirstMeetingPersistencePort
  private readonly options: SessionContextOptions
  private startedAt: number | null = null
  private lastActivityAt: number | null = null
  private lastLongActiveAt: number | null = null
  private ready = false

  constructor(bus: ContextEventBus, persistence: FirstMeetingPersistencePort, options: Partial<SessionContextOptions> = {}) {
    this.bus = bus; this.persistence = persistence
    this.options = { idleThresholdMs: 5 * 60_000, longActiveThresholdMs: 90 * 60_000, longActiveRepeatMs: 60 * 60_000, ...options }
  }

  characterReady(at: number, localDate: string) {
    if (this.ready) return
    this.ready = true; this.startedAt = at; this.lastActivityAt = at
    this.bus.publish({ type: 'session.started', at })
    let lastDate: string | null = null
    try { lastDate = this.persistence.getLastDate() } catch { /* persistence is best effort */ }
    if (lastDate !== localDate) {
      this.bus.publish({ type: 'session.first-meeting-today', at })
      try { this.persistence.setLastDate(localDate) } catch { /* startup remains available */ }
    }
  }

  recordActivity(at: number) {
    if (!this.ready) return
    const idleMs = this.lastActivityAt === null ? 0 : at - this.lastActivityAt
    this.lastActivityAt = at
    if (idleMs >= this.options.idleThresholdMs) this.bus.publish({ type: 'session.user-returned', at, idleMs })
  }

  update(now: number) {
    if (!this.ready || this.startedAt === null) return
    const activeMs = now - this.startedAt
    if (activeMs < this.options.longActiveThresholdMs) return
    if (this.lastLongActiveAt !== null && now - this.lastLongActiveAt < this.options.longActiveRepeatMs) return
    this.lastLongActiveAt = now
    this.bus.publish({ type: 'session.long-active', at: now, activeMs })
  }

  reset() { this.ready = false; this.startedAt = null; this.lastActivityAt = null; this.lastLongActiveAt = null }
  clearFirstMeetingMarker() { this.persistence.clear() }
}
