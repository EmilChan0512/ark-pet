import type { SpeakRequest } from '../../speech/types'
import type { ReactionExecutionPort, ReactionExecutionToken, ReactionPlan } from '../types'

export interface RuntimeReactionPorts {
  hasAnimation(name: string): boolean
  hasBehavior(id: string): boolean
  requestAnimation(name: string): void
  requestBehavior(id: string): void | Promise<unknown>
  enqueueSpeech(request: SpeakRequest): void
}

interface ActiveExecution {
  readonly plan: ReactionPlan
  readonly token: ReactionExecutionToken
  readonly resolve: () => void
  index: number
  waitUntil: number | null
}

export class RuntimeReactionAdapter implements ReactionExecutionPort {
  private readonly ports: RuntimeReactionPorts
  private active: ActiveExecution | null = null
  private sequence = 0
  private lastNow = 0

  constructor(ports: RuntimeReactionPorts) { this.ports = ports }

  supports(plan: ReactionPlan) {
    return plan.steps.every((step) =>
      (step.type !== 'animation' || this.ports.hasAnimation(step.name)) &&
      (step.type !== 'behavior' || this.ports.hasBehavior(step.id)),
    )
  }

  execute(plan: ReactionPlan, token: ReactionExecutionToken) {
    this.cancel('replaced')
    return new Promise<void>((resolve) => {
      this.active = { plan, token, resolve, index: 0, waitUntil: null }
      this.advance(this.lastNow)
    })
  }

  update(now: number) {
    this.lastNow = now
    if (!this.active) return
    if (!this.active.token.isValid()) { this.cancel('invalidated'); return }
    if (this.active.waitUntil !== null && now < this.active.waitUntil) return
    this.active.waitUntil = null
    this.advance(now)
  }

  cancel(_reason: string) {
    const active = this.active
    this.active = null
    active?.resolve()
  }

  private advance(now: number) {
    while (this.active && this.active.token.isValid()) {
      const step = this.active.plan.steps[this.active.index++]
      if (!step) {
        const finished = this.active
        this.active = null
        finished.resolve()
        return
      }
      if (step.type === 'wait') {
        this.active.waitUntil = now + step.durationMs
        return
      }
      if (step.type === 'animation') this.ports.requestAnimation(step.name)
      else if (step.type === 'behavior') void this.ports.requestBehavior(step.id)
      else {
        this.ports.enqueueSpeech({
          id: `reaction-${step.dedupeKey ?? this.active.plan.reactionId}-${++this.sequence}`,
          source: step.source,
          text: step.text,
          cue: step.cue,
          priority: this.active.plan.priority,
          dedupeKey: step.dedupeKey ?? this.active.plan.reactionId,
          expiresAt: now + 5_000,
        })
      }
    }
  }
}
