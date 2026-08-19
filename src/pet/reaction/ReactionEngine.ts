import type { CharacterPersona } from '../persona/types'
import { ReactionCooldownStore } from './ReactionCooldownStore'
import type {
  ContextEvent, PersonaReaction, ReactionClockPort, ReactionDiagnosticsPort,
  ReactionDailyCooldownPort, ReactionEngineSnapshot, ReactionExecutionPort, ReactionPlan, ReactionRandomPort,
} from './types'

const NULL_DIAGNOSTICS: ReactionDiagnosticsPort = { publish: () => {}, reportError: () => {} }

function matchesCondition(rule: PersonaReaction, event: ContextEvent) {
  return (rule.conditions ?? []).every((condition) => {
    if (condition.type === 'click-count') {
      return event.type === 'pet.clicked' &&
        (condition.min === undefined || event.clickCount >= condition.min) &&
        (condition.max === undefined || event.clickCount <= condition.max)
    }
    if (condition.type === 'idle-ms') return event.type === 'session.user-returned' && event.idleMs >= condition.min
    if (condition.type === 'active-ms') return event.type === 'session.long-active' && event.activeMs >= condition.min
    if (condition.type === 'period') return event.type === 'time.period-entered' && event.period === condition.value
    if (condition.type === 'desktop-category') {
      return event.type === 'desktop.activity-category-entered' && event.category === condition.value
    }
    if (condition.type === 'idle-bucket') {
      return (event.type === 'desktop.system-idle-entered' || event.type === 'desktop.system-idle-returned') &&
        event.idleBucket === condition.value
    }
    return event.type === 'perception.scene-noticed' && event.scene === condition.value
  })
}

export class ReactionEngine {
  private persona: CharacterPersona
  private readonly clock: ReactionClockPort
  private readonly random: ReactionRandomPort
  private readonly execution: ReactionExecutionPort
  private readonly cooldowns: ReactionCooldownStore
  private readonly diagnostics: ReactionDiagnosticsPort
  private readonly dailyCooldowns: ReactionDailyCooldownPort | null
  private enabled = true
  private destroyed = false
  private generation = 0
  private active: { id: string; priority: number; generation: number } | null = null
  private decisionLog: string[] = []
  private snapshot: ReactionEngineSnapshot = {
    lastEvent: null, selectedReactionId: null, activeReactionId: null,
    activeState: 'idle', blockedReason: null, decisionLog: [], generation: 0,
  }

  constructor(persona: CharacterPersona, clock: ReactionClockPort, random: ReactionRandomPort,
    execution: ReactionExecutionPort, diagnostics: ReactionDiagnosticsPort = NULL_DIAGNOSTICS,
    cooldowns = new ReactionCooldownStore(), dailyCooldowns: ReactionDailyCooldownPort | null = null) {
    this.persona = persona
    this.clock = clock
    this.random = random
    this.execution = execution
    this.diagnostics = diagnostics
    this.cooldowns = cooldowns
    this.dailyCooldowns = dailyCooldowns
    this.publish()
  }

  getSnapshot() { return { ...this.snapshot } }

  setPersona(persona: CharacterPersona) {
    this.cancel('persona-changed')
    this.persona = persona
    this.cooldowns.reset()
  }

  setEnabled(enabled: boolean) {
    if (this.destroyed || this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) this.cancel('disabled')
    this.patch({ activeState: enabled ? 'idle' : 'disabled', blockedReason: enabled ? null : 'personality disabled' })
  }

  handle(event: ContextEvent): string | null {
    this.recordDecision(`Received ${event.type}`)
    this.patch({ lastEvent: event, selectedReactionId: null, blockedReason: null })
    if (this.destroyed || !this.enabled) {
      this.patch({ activeState: this.destroyed ? 'destroyed' : 'disabled', blockedReason: 'personality disabled' })
      this.recordDecision(`Blocked ${event.type}: personality disabled`)
      return null
    }
    const now = this.clock.now()
    const candidates = this.persona.reactions.filter((rule) => {
      if (rule.event !== event.type || !matchesCondition(rule, event)) return false
      const plan: ReactionPlan = { reactionId: rule.id, priority: rule.priority, steps: rule.plan }
      return this.execution.supports(plan)
    })
    if (candidates.length === 0) {
      this.patch({ activeState: this.active ? 'running' : 'blocked', blockedReason: 'no eligible reaction' })
      this.recordDecision(`Blocked ${event.type}: no eligible reaction or supported plan`)
      return null
    }
    const dailyBlocked = candidates.filter((rule) => this.isDailyBlocked(rule))
    const eligible = candidates.filter((rule) =>
      !this.isDailyBlocked(rule) &&
      this.cooldowns.remaining(rule.cooldownGroup ?? rule.id, rule.cooldownMs ?? 0, now) === 0,
    )
    if (eligible.length === 0) {
      if (dailyBlocked.length === candidates.length) {
        this.patch({ activeState: this.active ? 'running' : 'blocked', blockedReason: 'daily cooldown' })
        this.recordDecision(`Blocked ${event.type}: daily cooldown`)
        return null
      }
      const remaining = Math.min(...candidates.map((rule) => this.cooldowns.remaining(rule.cooldownGroup ?? rule.id, rule.cooldownMs ?? 0, now)))
      this.patch({ activeState: this.active ? 'running' : 'blocked', blockedReason: `cooldown ${Math.ceil(remaining)}ms` })
      this.recordDecision(`Blocked ${event.type}: cooldown ${Math.ceil(remaining)}ms`)
      return null
    }
    const highestPriority = Math.max(...eligible.map((rule) => rule.priority))
    const pool = eligible.filter((rule) => rule.priority === highestPriority)
    const total = pool.reduce((sum, rule) => sum + (rule.weight ?? 1), 0)
    let cursor = Math.max(0, Math.min(0.999999999, this.random.next())) * total
    const selected = pool.find((rule) => (cursor -= rule.weight ?? 1) < 0) ?? pool[pool.length - 1]
    if (!selected) return null
    if (this.active && this.active.priority > selected.priority) {
      this.patch({ activeState: 'running', blockedReason: `active priority ${this.active.priority}` })
      this.recordDecision(`Blocked ${selected.id}: active priority ${this.active.priority}`)
      return null
    }
    if (this.active) this.execution.cancel('replaced')
    const generation = ++this.generation
    const plan: ReactionPlan = { reactionId: selected.id, priority: selected.priority, steps: selected.plan }
    this.active = { id: selected.id, priority: selected.priority, generation }
    this.cooldowns.mark(selected.cooldownGroup ?? selected.id, now)
    if (selected.oncePerLocalDay && this.dailyCooldowns) {
      try { this.dailyCooldowns.setDate(selected.cooldownGroup ?? selected.id, this.dailyCooldowns.currentDate()) } catch { /* persistence is best effort */ }
    }
    this.patch({ selectedReactionId: selected.id, activeReactionId: selected.id, activeState: 'running', blockedReason: null, generation })
    this.recordDecision(`Selected ${selected.id} at priority ${selected.priority}`)
    const token = { generation, isValid: () => !this.destroyed && this.enabled && this.active?.generation === generation }
    try {
      void Promise.resolve(this.execution.execute(plan, token)).then(
        () => { if (token.isValid()) { this.active = null; this.patch({ activeReactionId: null, activeState: 'idle' }); this.recordDecision(`Completed ${selected.id}`) } },
        (error) => { if (token.isValid()) { this.report(selected.id, error); this.active = null; this.patch({ activeReactionId: null, activeState: 'idle' }); this.recordDecision(`Failed ${selected.id}`) } },
      )
    } catch (error) {
      this.report(selected.id, error)
      this.active = null
      this.patch({ activeReactionId: null, activeState: 'idle' })
      this.recordDecision(`Failed ${selected.id}`)
    }
    return selected.id
  }

  cancel(reason: string) {
    if (!this.active) { ++this.generation; this.patch({ generation: this.generation }); return }
    const cancelledId = this.active.id
    ++this.generation
    this.active = null
    this.execution.cancel(reason)
    this.patch({ activeReactionId: null, activeState: this.enabled ? 'idle' : 'disabled', generation: this.generation })
    this.recordDecision(`Cancelled ${cancelledId}: ${reason}`)
  }

  destroy() {
    if (this.destroyed) return
    this.cancel('destroyed')
    this.destroyed = true
    this.patch({ activeState: 'destroyed', blockedReason: null })
  }

  private patch(partial: Partial<ReactionEngineSnapshot>) { this.snapshot = { ...this.snapshot, ...partial }; this.publish() }
  private isDailyBlocked(rule: PersonaReaction) {
    if (!rule.oncePerLocalDay || !this.dailyCooldowns) return false
    try { return this.dailyCooldowns.getDate(rule.cooldownGroup ?? rule.id) === this.dailyCooldowns.currentDate() } catch { return false }
  }
  private publish() { try { this.diagnostics.publish(this.getSnapshot()) } catch { /* observational */ } }
  private report(id: string, error: unknown) { try { this.diagnostics.reportError(id, error) } catch { /* observational */ } }
  private recordDecision(message: string) {
    this.decisionLog.push(`[${Math.round(this.clock.now())}ms] ${message}`)
    if (this.decisionLog.length > 12) this.decisionLog.splice(0, this.decisionLog.length - 12)
    this.patch({ decisionLog: [...this.decisionLog] })
  }

  clearCooldowns() {
    if (this.destroyed) return
    this.cooldowns.reset()
    this.recordDecision('Cleared in-session reaction cooldowns')
  }
}
