import type { RandomPort } from '../types'

export type AmbientSchedulerStatus =
  | 'disabled'
  | 'paused'
  | 'waiting'
  | 'behavior-active'
  | 'destroyed'

export interface AmbientBehaviorIds {
  idle: string
  walk: string
  sit: string
  sleep: string
}

export interface AmbientSchedulerConfig {
  ambientDelayMinMs: number
  ambientDelayMaxMs: number
  sleepAfterMs: number
  walkWeight: number
}

export interface AmbientSchedulerSnapshot {
  status: AmbientSchedulerStatus
  nextActionAt: number | null
  lastActivityAt: number
  enabled: boolean
  paused: boolean
  destroyed: boolean
}

export const DEFAULT_AMBIENT_SCHEDULER_CONFIG: AmbientSchedulerConfig = {
  ambientDelayMinMs: 20_000,
  ambientDelayMaxMs: 45_000,
  sleepAfterMs: 180_000,
  walkWeight: 0.65,
}

/**
 * Pure, ticker-driven policy state. It returns behavior IDs but never executes
 * behaviors, touches platform APIs, or creates independent timers.
 */
export class AmbientScheduler {
  private enabled = false
  private paused = true
  private destroyed = false
  private nextActionAt: number | null = null
  private lastActivityAt = 0
  private sleepAttemptedSinceActivity = false
  private readonly ids: AmbientBehaviorIds
  private readonly random: RandomPort
  private readonly config: AmbientSchedulerConfig

  constructor(
    ids: AmbientBehaviorIds,
    random: RandomPort,
    config: AmbientSchedulerConfig = DEFAULT_AMBIENT_SCHEDULER_CONFIG,
  ) {
    this.ids = ids
    this.random = random
    this.config = config
  }

  getSnapshot(activeBehaviorId: string | null): AmbientSchedulerSnapshot {
    let status: AmbientSchedulerStatus
    if (this.destroyed) status = 'destroyed'
    else if (!this.enabled) status = 'disabled'
    else if (this.paused) status = 'paused'
    else if (activeBehaviorId !== this.ids.idle) status = 'behavior-active'
    else status = 'waiting'

    return {
      status,
      nextActionAt: this.nextActionAt,
      lastActivityAt: this.lastActivityAt,
      enabled: this.enabled,
      paused: this.paused,
      destroyed: this.destroyed,
    }
  }

  setEnabled(enabled: boolean, now: number) {
    if (this.destroyed || this.enabled === enabled) return
    this.enabled = enabled
    if (enabled && !this.paused) this.resetFromActivity(now)
    else this.nextActionAt = null
  }

  pause() {
    if (this.destroyed || this.paused) return
    this.paused = true
    this.nextActionAt = null
  }

  resume(now: number) {
    if (this.destroyed || !this.paused) return
    this.paused = false
    if (this.enabled) this.resetFromActivity(now)
  }

  recordActivity(now: number) {
    if (this.destroyed) return
    this.resetFromActivity(now)
  }

  ambientCompleted(now: number) {
    if (this.destroyed || !this.enabled || this.paused) return
    this.armAmbient(now)
  }

  /** Returns one requested ID, or null when no transition is due. */
  update(
    now: number,
    activeBehaviorId: string | null,
    eligibleBehaviorIds: ReadonlySet<string>,
  ): string | null {
    if (this.destroyed || !this.enabled || this.paused) return null
    if (activeBehaviorId !== this.ids.idle) return null

    const sleepDue = now - this.lastActivityAt >= this.config.sleepAfterMs
    if (sleepDue && !this.sleepAttemptedSinceActivity) {
      this.sleepAttemptedSinceActivity = true
      if (eligibleBehaviorIds.has(this.ids.sleep)) {
        this.nextActionAt = null
        return this.ids.sleep
      }
    }

    if (this.nextActionAt === null) this.armAmbient(now)
    if (this.nextActionAt === null || now < this.nextActionAt) return null

    const candidates = [this.ids.walk, this.ids.sit].filter((id) =>
      eligibleBehaviorIds.has(id),
    )
    if (candidates.length === 0) {
      this.armAmbient(now)
      return null
    }

    this.nextActionAt = null
    if (candidates.length === 1) return candidates[0]
    return this.random.next() < this.config.walkWeight ? this.ids.walk : this.ids.sit
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.nextActionAt = null
  }

  private resetFromActivity(now: number) {
    this.lastActivityAt = now
    this.sleepAttemptedSinceActivity = false
    if (this.enabled && !this.paused) this.armAmbient(now)
  }

  private armAmbient(now: number) {
    const range = this.config.ambientDelayMaxMs - this.config.ambientDelayMinMs
    this.nextActionAt = now + this.config.ambientDelayMinMs + range * this.random.next()
  }
}
