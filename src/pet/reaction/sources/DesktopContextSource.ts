import type { ContextEventBus } from '../ContextEventBus'
import type { DesktopActivityCategory, DesktopIdleBucket } from '../types'

export type DesktopCapabilityState = 'available' | 'unsupported' | 'denied' | 'error'
export interface DesktopAwarenessCapabilities {
  readonly foregroundCategory: DesktopCapabilityState
  readonly systemIdle: DesktopCapabilityState
  readonly sessionLock: DesktopCapabilityState
}
export type DesktopAwarenessSourceStatus = 'off' | 'starting' | 'active' | 'paused' | 'unsupported' | 'error'
export interface CoarseDesktopSample {
  readonly category?: DesktopActivityCategory
  readonly idleState?: 'active' | 'idle'
  readonly idleBucket?: DesktopIdleBucket
  readonly sessionState?: 'available' | 'locked'
  readonly errorCode?: string
}
export interface DesktopAwarenessPort {
  start(): Promise<DesktopAwarenessCapabilities>
  stop(): Promise<void>
  subscribe(listener: (sample: CoarseDesktopSample) => void): () => void
}
export interface DesktopAwarenessSnapshot {
  readonly enabled: boolean
  readonly consented: boolean
  readonly status: DesktopAwarenessSourceStatus
  readonly capabilities: DesktopAwarenessCapabilities
  readonly category: DesktopActivityCategory
  readonly idleState: 'active' | 'idle' | 'unavailable'
  readonly idleBucket: DesktopIdleBucket | null
  readonly sessionState: 'available' | 'locked' | 'unavailable'
  readonly lastEventType: string | null
  readonly blockedReason: string | null
  readonly generation: number
  readonly errorCode: string | null
}

const UNAVAILABLE: DesktopAwarenessCapabilities = {
  foregroundCategory: 'unsupported', systemIdle: 'unsupported', sessionLock: 'unsupported',
}

export class DesktopContextSource {
  private readonly bus: ContextEventBus
  private readonly port: DesktopAwarenessPort
  private readonly publishSnapshot: (snapshot: DesktopAwarenessSnapshot) => void
  private readonly now: () => number
  private readonly debounceMs: number
  private snapshot: DesktopAwarenessSnapshot = {
    enabled: false, consented: false, status: 'off', capabilities: UNAVAILABLE,
    category: 'unknown', idleState: 'unavailable', idleBucket: null,
    sessionState: 'unavailable', lastEventType: null, blockedReason: 'awareness disabled',
    generation: 0, errorCode: null,
  }
  private enabled = false
  private consented = false
  private ready = false
  private visible = true
  private destroyed = false
  private running = false
  private generation = 0
  private stableCategory: DesktopActivityCategory = 'unknown'
  private pendingCategory: DesktopActivityCategory | null = null
  private categoryTimer: ReturnType<typeof setTimeout> | null = null
  private idleState: 'active' | 'idle' | null = null
  private lastIdleBucket: DesktopIdleBucket = 'short'
  private locked = false
  private readonly unsubscribe: () => void

  constructor(
    bus: ContextEventBus,
    port: DesktopAwarenessPort,
    publishSnapshot: (snapshot: DesktopAwarenessSnapshot) => void = () => {},
    now: () => number = () => performance.now(),
    debounceMs = 2000,
  ) {
    this.bus = bus
    this.port = port
    this.publishSnapshot = publishSnapshot
    this.now = now
    this.debounceMs = debounceMs
    this.unsubscribe = port.subscribe((sample) => this.receive(sample, this.generation))
    this.publish()
  }

  getSnapshot() { return { ...this.snapshot, capabilities: { ...this.snapshot.capabilities } } }

  async configure(options: { enabled: boolean; consented: boolean; ready: boolean; visible: boolean }) {
    if (this.destroyed) return
    this.enabled = options.enabled
    this.consented = options.consented
    this.ready = options.ready
    this.visible = options.visible
    const shouldRun = this.enabled && this.consented && this.ready && this.visible
    if (!shouldRun) {
      await this.stop(this.enabled && this.consented ? 'paused' : 'off', this.enabled ? 'runtime not ready or hidden' : 'awareness disabled')
      return
    }
    if (this.running) return
    const generation = ++this.generation
    // Native observers may publish their initial minimized sample before the
    // start command resolves, so accept samples for this starting generation.
    this.running = true
    this.patch({ enabled: this.enabled, consented: this.consented, status: 'starting', blockedReason: null, generation, errorCode: null })
    try {
      const capabilities = await this.port.start()
      if (this.destroyed || generation !== this.generation) { await this.port.stop(); return }
      const supported = Object.values(capabilities).some((value) => value === 'available')
      this.running = supported
      this.patch({
        capabilities,
        status: supported ? 'active' : 'unsupported',
        blockedReason: supported ? null : 'platform capabilities unavailable',
      })
    } catch {
      if (generation !== this.generation) return
      this.running = false
      this.patch({ status: 'error', errorCode: 'observer-start-failed', blockedReason: 'native observer could not start' })
    }
  }

  async destroy() {
    if (this.destroyed) return
    this.destroyed = true
    ++this.generation
    this.clearCategoryTimer()
    this.unsubscribe()
    await this.port.stop()
    this.running = false
  }

  private async stop(status: 'off' | 'paused', reason: string) {
    const wasRunning = this.running || this.snapshot.status === 'starting'
    ++this.generation
    this.running = false
    this.resetTransitions()
    if (wasRunning) await this.port.stop()
    this.patch({
      enabled: this.enabled, consented: this.consented, status, blockedReason: reason,
      category: 'unknown', idleState: 'unavailable', idleBucket: null,
      sessionState: 'unavailable', generation: this.generation,
    })
  }

  private receive(sample: CoarseDesktopSample, generation: number) {
    if (!this.running || this.destroyed || generation !== this.generation) return
    if (sample.errorCode) {
      this.patch({ errorCode: sample.errorCode, blockedReason: 'native sample unavailable' })
      return
    }
    const at = this.now()
    if (sample.sessionState) {
      const nextLocked = sample.sessionState === 'locked'
      if (nextLocked !== this.locked) {
        ++this.generation
        this.locked = nextLocked
        this.clearCategoryTimer()
        this.pendingCategory = null
        this.stableCategory = 'unknown'
        this.idleState = null
        const type = nextLocked ? 'desktop.session-locked' : 'desktop.session-unlocked'
        this.bus.publish({ type, at })
        this.patch({ lastEventType: type, sessionState: sample.sessionState, generation: this.generation })
      } else this.patch({ sessionState: sample.sessionState })
    }
    if (this.locked) return
    if (sample.idleState) this.receiveIdle(sample.idleState, sample.idleBucket, at)
    if (sample.category) this.receiveCategory(sample.category, this.generation)
  }

  private receiveIdle(state: 'active' | 'idle', bucket: DesktopIdleBucket | undefined, at: number) {
    const previous = this.idleState
    if (bucket) this.lastIdleBucket = bucket
    this.idleState = state
    this.patch({ idleState: state, idleBucket: state === 'idle' ? this.lastIdleBucket : null })
    if (previous === null || previous === state) return
    const type = state === 'idle' ? 'desktop.system-idle-entered' : 'desktop.system-idle-returned'
    this.bus.publish({ type, at, idleBucket: this.lastIdleBucket })
    this.patch({ lastEventType: type })
  }

  private receiveCategory(category: DesktopActivityCategory, generation: number) {
    this.patch({ category })
    if (category === this.stableCategory || category === this.pendingCategory) return
    this.clearCategoryTimer()
    this.pendingCategory = category
    this.categoryTimer = setTimeout(() => {
      if (!this.running || this.destroyed || generation !== this.generation || this.locked) return
      const stable = this.pendingCategory
      this.pendingCategory = null
      if (!stable || stable === this.stableCategory) return
      this.stableCategory = stable
      const type = 'desktop.activity-category-entered' as const
      this.bus.publish({ type, at: this.now(), category: stable })
      this.patch({ category: stable, lastEventType: type, blockedReason: null })
    }, this.debounceMs)
  }

  private resetTransitions() {
    this.clearCategoryTimer(); this.pendingCategory = null; this.stableCategory = 'unknown'
    this.idleState = null; this.lastIdleBucket = 'short'; this.locked = false
  }
  private clearCategoryTimer() { if (this.categoryTimer !== null) { clearTimeout(this.categoryTimer); this.categoryTimer = null } }
  private patch(partial: Partial<DesktopAwarenessSnapshot>) { this.snapshot = { ...this.snapshot, ...partial }; this.publish() }
  private publish() { this.publishSnapshot(this.getSnapshot()) }
}
