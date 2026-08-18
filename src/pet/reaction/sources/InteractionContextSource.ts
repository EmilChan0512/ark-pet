import { ContextEventBus } from '../ContextEventBus'

export interface InteractionContextOptions { readonly clickAggregationMs: number }

export class InteractionContextSource {
  private readonly bus: ContextEventBus
  private readonly aggregationMs: number
  private clickCount = 0
  private clickDeadline: number | null = null
  private dragStartedAt: number | null = null

  constructor(bus: ContextEventBus, options: Partial<InteractionContextOptions> = {}) {
    this.bus = bus
    this.aggregationMs = options.clickAggregationMs ?? 320
  }

  recordClick(at: number) { this.clickCount += 1; this.clickDeadline = at + this.aggregationMs }
  dragStarted(at: number) {
    // A drag gesture is not a delayed click. Discard any click aggregation
    // still pending from the preceding pointer sequence before announcing the
    // blocking manual interaction.
    this.clickCount = 0
    this.clickDeadline = null
    this.dragStartedAt = at
    this.bus.publish({ type: 'pet.drag-started', at })
  }
  dragEnded(at: number) {
    const started = this.dragStartedAt
    this.dragStartedAt = null
    if (started !== null) this.bus.publish({ type: 'pet.drag-ended', at, durationMs: Math.max(0, at - started) })
  }
  update(now: number) { if (this.clickDeadline !== null && now >= this.clickDeadline) this.flushClicks(now) }
  cancel() { this.clickCount = 0; this.clickDeadline = null; this.dragStartedAt = null }

  private flushClicks(at: number) {
    if (this.clickCount > 0) this.bus.publish({ type: 'pet.clicked', at, clickCount: this.clickCount })
    this.clickCount = 0
    this.clickDeadline = null
  }
}
