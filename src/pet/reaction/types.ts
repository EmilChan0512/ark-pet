export type LocalTimePeriod = 'morning' | 'day' | 'evening' | 'late-night'

export type DesktopActivityCategory =
  | 'development' | 'browsing' | 'communication' | 'productivity'
  | 'creative' | 'media' | 'gaming' | 'system' | 'other' | 'unknown'

export type DesktopIdleBucket = 'short' | 'medium' | 'long'

export type ContextEvent =
  | { readonly type: 'pet.clicked'; readonly at: number; readonly clickCount: number }
  | { readonly type: 'pet.drag-started'; readonly at: number }
  | { readonly type: 'pet.drag-ended'; readonly at: number; readonly durationMs: number }
  | { readonly type: 'session.started'; readonly at: number }
  | { readonly type: 'session.first-meeting-today'; readonly at: number }
  | { readonly type: 'session.user-returned'; readonly at: number; readonly idleMs: number }
  | { readonly type: 'session.long-active'; readonly at: number; readonly activeMs: number }
  | { readonly type: 'time.period-entered'; readonly at: number; readonly period: LocalTimePeriod }
  | { readonly type: 'desktop.activity-category-entered'; readonly at: number; readonly category: DesktopActivityCategory }
  | { readonly type: 'desktop.system-idle-entered'; readonly at: number; readonly idleBucket: DesktopIdleBucket }
  | { readonly type: 'desktop.system-idle-returned'; readonly at: number; readonly idleBucket: DesktopIdleBucket }
  | { readonly type: 'desktop.session-locked'; readonly at: number }
  | { readonly type: 'desktop.session-unlocked'; readonly at: number }

export type ReactionCondition =
  | { readonly type: 'click-count'; readonly min?: number; readonly max?: number }
  | { readonly type: 'idle-ms'; readonly min: number }
  | { readonly type: 'active-ms'; readonly min: number }
  | { readonly type: 'period'; readonly value: LocalTimePeriod }
  | { readonly type: 'desktop-category'; readonly value: DesktopActivityCategory }
  | { readonly type: 'idle-bucket'; readonly value: DesktopIdleBucket }

export type ReactionPlanStep =
  | { readonly type: 'behavior'; readonly id: string }
  | { readonly type: 'animation'; readonly name: string }
  | {
      readonly type: 'speak'
      readonly text: string
      readonly source: 'interaction' | 'ambient'
      readonly cue?: string
      readonly dedupeKey?: string
    }
  | { readonly type: 'wait'; readonly durationMs: number }

export interface ReactionPlan {
  readonly reactionId: string
  readonly priority: number
  readonly steps: readonly ReactionPlanStep[]
}

export interface PersonaReaction {
  readonly id: string
  readonly event: ContextEvent['type']
  readonly priority: number
  readonly weight?: number
  readonly cooldownMs?: number
  readonly cooldownGroup?: string
  readonly oncePerLocalDay?: boolean
  readonly conditions?: readonly ReactionCondition[]
  readonly plan: readonly ReactionPlanStep[]
}

export interface ReactionClockPort {
  now(): number
}

export interface ReactionRandomPort {
  next(): number
}

export interface ReactionDailyCooldownPort {
  currentDate(): string
  getDate(key: string): string | null
  setDate(key: string, date: string): void
}

export interface ReactionExecutionToken {
  readonly generation: number
  isValid(): boolean
}

export interface ReactionExecutionPort {
  supports(plan: ReactionPlan): boolean
  execute(plan: ReactionPlan, token: ReactionExecutionToken): void | Promise<void>
  cancel(reason: string): void
}

export interface ReactionEngineSnapshot {
  readonly lastEvent: ContextEvent | null
  readonly selectedReactionId: string | null
  readonly activeReactionId: string | null
  readonly activeState: 'idle' | 'running' | 'blocked' | 'disabled' | 'destroyed'
  readonly blockedReason: string | null
  readonly decisionLog: readonly string[]
  readonly generation: number
}

export interface ReactionDiagnosticsPort {
  publish(snapshot: ReactionEngineSnapshot): void
  reportError(reactionId: string, error: unknown): void
}
