/** Why an active behavior stopped. Exit reasons are part of the extension API. */
export type BehaviorExitReason =
  | 'completed'
  | 'replaced'
  | 'user-input'
  | 'paused'
  | 'reload'
  | 'hidden'
  | 'disabled'
  | 'destroyed'
  | 'failed'

export type BehaviorTag = 'manual' | 'ambient' | 'blocking'
export type BehaviorPhase = 'eligibility' | 'create' | 'enter' | 'update' | 'exit'
export type BehaviorRunState = 'entering' | 'active'
export type BehaviorUpdateResult = 'continue' | 'completed' | void

export interface ClockPort {
  /** Returns monotonic milliseconds. It must not use wall-clock time. */
  now(): number
}

export interface RandomPort {
  /** Returns a normalized value in the range [0, 1). */
  next(): number
}

export interface BehaviorEngineSnapshot {
  activeBehaviorId: string | null
  activePriority: number | null
  runState: BehaviorRunState | null
  generation: number
  destroyed: boolean
  lastError: string | null
}

export interface BehaviorDiagnosticsPort {
  publish(snapshot: BehaviorEngineSnapshot): void
  reportError(behaviorId: string, phase: BehaviorPhase, error: unknown): void
}

/**
 * Per-activation behavior object. A new instance is created for every run so
 * definitions remain reusable and never leak mutable state between runs.
 */
export interface BehaviorInstance {
  enter?(signal: AbortSignal): void | Promise<void>
  update?(now: number): BehaviorUpdateResult
  exit?(reason: BehaviorExitReason): void | Promise<void>
}

/**
 * Declarative behavior extension point. Context is supplied by the composition
 * root and should expose only ports needed by registered definitions.
 */
export interface BehaviorDefinition<Context> {
  readonly id: string
  readonly priority: number
  readonly tags?: readonly BehaviorTag[]
  isEligible?(context: Readonly<Context>): boolean
  create(context: Readonly<Context>): BehaviorInstance
}

export interface BehaviorRequestOptions {
  /**
   * Bypasses priority checks for explicit lifecycle transitions such as drag
   * release returning to idle. Ambient policies must never set this flag.
   */
  force?: boolean
  replaceReason?: BehaviorExitReason
}

export interface BehaviorPolicy<Context> {
  select(
    candidates: readonly BehaviorDefinition<Context>[],
    context: Readonly<Context>,
  ): string | null
}
