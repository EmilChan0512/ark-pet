import type { ContextEventBus } from '../reaction/ContextEventBus'
import type { PerceptionScene } from '../reaction/types'
import type { CoarseDesktopSample, DesktopAwarenessPort } from '../reaction/sources/DesktopContextSource'

export type CharacterMood = 'calm' | 'curious' | 'concerned' | 'engaged'
export type InitiativeStyle = 'quiet' | 'balanced' | 'expressive'

export interface PerceptionObservation {
  readonly moduleId: string
  readonly kind: 'foreground-title'
  readonly at: number
  readonly text: string
}

export interface PerceptionModule {
  readonly id: string
  subscribe(listener: (observation: PerceptionObservation) => void): () => void
}

/** Static built-in registry: deliberately no dynamic code loading in the MVP. */
export class PerceptionModuleRegistry {
  private readonly modules: readonly PerceptionModule[]
  constructor(modules: readonly PerceptionModule[]) { this.modules = modules }

  subscribe(listener: (observation: PerceptionObservation) => void) {
    const cleanups = this.modules.map((module) => module.subscribe(listener))
    return () => { for (const cleanup of cleanups) cleanup() }
  }
}

export class DesktopTitlePerceptionModule implements PerceptionModule {
  readonly id = 'desktop.foreground-title'
  private readonly port: DesktopAwarenessPort
  private readonly now: () => number
  constructor(port: DesktopAwarenessPort, now: () => number = () => performance.now()) {
    this.port = port
    this.now = now
  }
  subscribe(listener: (observation: PerceptionObservation) => void) {
    return this.port.subscribe((sample: CoarseDesktopSample) => {
      const text = sample.windowTitle?.trim()
      if (!text) return
      listener({ moduleId: this.id, kind: 'foreground-title', at: this.now(), text })
    })
  }
}

export interface CharacterMindSnapshot {
  readonly status: 'off' | 'observing' | 'thinking' | 'ready' | 'paused' | 'destroyed'
  readonly mood: CharacterMood
  readonly scene: PerceptionScene | null
  readonly attention: number
  readonly lastObservation: string | null
  readonly currentThought: string | null
  readonly currentIntent: string | null
  readonly lastAction: string | null
  readonly blockedReason: string | null
  readonly generation: number
}

const INITIAL_SNAPSHOT: CharacterMindSnapshot = {
  status: 'off', mood: 'calm', scene: null, attention: 0,
  lastObservation: null, currentThought: null, currentIntent: null,
  lastAction: null, blockedReason: 'content perception disabled', generation: 0,
}

function interpretTitle(title: string): { scene: PerceptionScene; mood: CharacterMood; attention: number; thought: string } {
  const normalized = title.toLocaleLowerCase()
  if (/error|failed|failure|exception|bug|错误|失败|异常|报错/.test(normalized)) {
    return { scene: 'coding-problem', mood: 'concerned', attention: 0.92, thought: '她注意到工作似乎遇到了问题。' }
  }
  if (/youtube|bilibili|netflix|spotify|music|video|音乐|视频|直播/.test(normalized)) {
    return { scene: 'media', mood: 'calm', attention: 0.58, thought: '她注意到用户正在看或听一些内容。' }
  }
  if (/chat|discord|slack|teams|微信|聊天|消息/.test(normalized)) {
    return { scene: 'conversation', mood: 'curious', attention: 0.5, thought: '她察觉到用户正在与人交流。' }
  }
  if (/docs|document|read|pdf|notion|文档|阅读|笔记/.test(normalized)) {
    return { scene: 'focused-reading', mood: 'engaged', attention: 0.62, thought: '她注意到用户正在专心阅读。' }
  }
  return { scene: 'general', mood: 'curious', attention: 0.28, thought: '她看到了一个新的窗口场景。' }
}

export class PerceptionAgency {
  private readonly bus: ContextEventBus
  private readonly publishSnapshot: (snapshot: CharacterMindSnapshot) => void
  private readonly now: () => number
  private readonly stableMs: number
  private snapshot: CharacterMindSnapshot = INITIAL_SNAPSHOT
  private enabled = false
  private ready = false
  private initiativeEnabled = true
  private style: InitiativeStyle = 'balanced'
  private generation = 0
  private destroyed = false
  private pendingTimer: ReturnType<typeof setTimeout> | null = null
  private pendingTitle: string | null = null
  private lastStableTitle: string | null = null
  private lastInitiativeAt = Number.NEGATIVE_INFINITY
  private readonly unsubscribe: () => void

  constructor(
    bus: ContextEventBus,
    registry: PerceptionModuleRegistry,
    publishSnapshot: (snapshot: CharacterMindSnapshot) => void = () => {},
    now: () => number = () => performance.now(),
    stableMs = 3000,
  ) {
    this.bus = bus
    this.publishSnapshot = publishSnapshot
    this.now = now
    this.stableMs = stableMs
    this.unsubscribe = registry.subscribe((observation) => this.observe(observation))
    this.publish()
  }

  getSnapshot() { return { ...this.snapshot } }

  configure(options: { enabled: boolean; ready: boolean; initiativeEnabled: boolean; style: InitiativeStyle }) {
    if (this.destroyed) return
    const invalidated = this.enabled !== options.enabled || this.ready !== options.ready
    this.enabled = options.enabled
    this.ready = options.ready
    this.initiativeEnabled = options.initiativeEnabled
    this.style = options.style
    if (invalidated) { ++this.generation; this.clearPending() }
    const active = this.enabled && this.ready
    this.patch({
      status: active ? 'observing' : this.enabled ? 'paused' : 'off',
      blockedReason: active ? null : this.enabled ? 'runtime not ready' : 'content perception disabled',
      generation: this.generation,
    })
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    ++this.generation
    this.clearPending()
    this.unsubscribe()
    this.patch({ status: 'destroyed', generation: this.generation })
  }

  private observe(observation: PerceptionObservation) {
    if (this.destroyed || !this.enabled || !this.ready || observation.kind !== 'foreground-title') return
    const title = observation.text.slice(0, 512)
    if (!title || title === this.pendingTitle || title === this.lastStableTitle || /desktop pet/i.test(title)) return
    this.clearPending()
    const generation = this.generation
    this.pendingTitle = title
    this.patch({ status: 'thinking', lastObservation: 'Foreground window title changed', blockedReason: null })
    this.pendingTimer = setTimeout(() => {
      if (this.destroyed || generation !== this.generation || !this.pendingTitle) return
      const stableTitle = this.pendingTitle
      this.pendingTitle = null
      this.lastStableTitle = stableTitle
      this.consider(stableTitle)
    }, this.stableMs)
  }

  private consider(title: string) {
    const interpretation = interpretTitle(title)
    const now = this.now()
    const cooldown = this.style === 'quiet' ? 60 * 60_000 : this.style === 'expressive' ? 8 * 60_000 : 20 * 60_000
    const minimumAttention = this.style === 'quiet' ? 0.8 : this.style === 'expressive' ? 0.2 : 0.45
    const eligible = this.initiativeEnabled && interpretation.attention >= minimumAttention && now - this.lastInitiativeAt >= cooldown
    const intent = eligible ? `Respond to ${interpretation.scene}` : null
    this.patch({
      status: 'ready', mood: interpretation.mood, scene: interpretation.scene,
      attention: interpretation.attention, currentThought: interpretation.thought,
      currentIntent: intent,
      blockedReason: eligible ? null : !this.initiativeEnabled ? 'initiative disabled'
        : interpretation.attention < minimumAttention ? 'attention below personality threshold' : 'initiative cooldown',
    })
    if (!eligible) return
    this.lastInitiativeAt = now
    this.bus.publish({ type: 'perception.scene-noticed', at: now, scene: interpretation.scene })
    this.patch({ lastAction: `Published perception.scene-noticed (${interpretation.scene})` })
  }

  private clearPending() {
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer)
    this.pendingTimer = null
    this.pendingTitle = null
  }
  private patch(partial: Partial<CharacterMindSnapshot>) { this.snapshot = { ...this.snapshot, ...partial }; this.publish() }
  private publish() { this.publishSnapshot(this.getSnapshot()) }
}
