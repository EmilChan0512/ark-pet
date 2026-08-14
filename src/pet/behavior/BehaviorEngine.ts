import { BehaviorRegistry } from './BehaviorRegistry'
import type {
  BehaviorDefinition,
  BehaviorDiagnosticsPort,
  BehaviorEngineSnapshot,
  BehaviorExitReason,
  BehaviorInstance,
  BehaviorPhase,
  BehaviorRequestOptions,
  BehaviorRunState,
} from './types'

interface Activation<Context> {
  definition: BehaviorDefinition<Context>
  instance: BehaviorInstance
  controller: AbortController
  generation: number
  runState: BehaviorRunState
  exited: boolean
}

interface PendingRequest {
  id: string
  priority: number
  generation: number
}

const NULL_DIAGNOSTICS: BehaviorDiagnosticsPort = {
  publish: () => {},
  reportError: () => {},
}

/**
 * Owns the single active behavior and all lifecycle transitions.
 *
 * Request calls intentionally are not serialized behind an enter hook. A user
 * action must be able to abort a slow asynchronous ambient enter immediately.
 * The generation check below prevents that stale enter completion from
 * becoming active after its replacement has already started.
 */
export class BehaviorEngine<Context> {
  private active: Activation<Context> | null = null
  private pending: PendingRequest | null = null
  private generation = 0
  private destroyed = false
  private lastError: string | null = null
  private readonly registry: BehaviorRegistry<Context>
  private readonly diagnostics: BehaviorDiagnosticsPort

  constructor(
    registry: BehaviorRegistry<Context>,
    diagnostics: BehaviorDiagnosticsPort = NULL_DIAGNOSTICS,
  ) {
    this.registry = registry
    this.diagnostics = diagnostics
    this.publishSnapshot()
  }

  /** Returns a detached diagnostic view; callers cannot mutate engine state. */
  getSnapshot(): BehaviorEngineSnapshot {
    return {
      activeBehaviorId: this.active?.definition.id ?? null,
      activePriority: this.active?.definition.priority ?? null,
      runState: this.active?.runState ?? null,
      generation: this.generation,
      destroyed: this.destroyed,
      lastError: this.lastError,
    }
  }

  /**
   * Requests activation and resolves after the winning enter hook completes.
   * `false` means ineligible, rejected by priority, stale, failed, or destroyed.
   */
  async request(
    id: string,
    context: Readonly<Context>,
    options: BehaviorRequestOptions = {},
  ): Promise<boolean> {
    if (this.destroyed) return false

    const definition = this.registry.get(id)
    if (!definition) {
      this.reportError(id, 'create', new Error(`Behavior is not registered: ${id}`))
      return false
    }

    if (!this.isEligible(definition, context)) return false
    if (this.active?.definition.id === id) return true
    if (this.pending?.id === id) return true
    const protectedPriority = Math.max(
      this.active?.definition.priority ?? Number.NEGATIVE_INFINITY,
      this.pending?.priority ?? Number.NEGATIVE_INFINITY,
    )
    if (!options.force && definition.priority < protectedPriority) {
      return false
    }

    const requestGeneration = ++this.generation
    this.pending = { id, priority: definition.priority, generation: requestGeneration }
    const previous = this.detachActive()
    if (previous) {
      await this.exitActivation(previous, options.replaceReason ?? 'replaced')
    }

    // Another request/cancel may have won while the previous exit was awaited.
    if (this.destroyed || requestGeneration !== this.generation) return false

    let instance: BehaviorInstance
    try {
      instance = definition.create(context)
    } catch (error) {
      if (this.pending?.generation === requestGeneration) this.pending = null
      this.reportError(id, 'create', error)
      return false
    }

    const activation: Activation<Context> = {
      definition,
      instance,
      controller: new AbortController(),
      generation: requestGeneration,
      runState: 'entering',
      exited: false,
    }
    this.pending = null
    this.active = activation
    this.publishSnapshot()

    try {
      await instance.enter?.(activation.controller.signal)
    } catch (error) {
      if (this.active !== activation || activation.controller.signal.aborted) return false
      this.active = null
      await this.exitActivation(activation, 'failed')
      this.reportError(id, 'enter', error)
      return false
    }

    if (
      this.destroyed ||
      this.active !== activation ||
      activation.generation !== this.generation
    ) {
      return false
    }

    activation.runState = 'active'
    this.publishSnapshot()
    return true
  }

  /** Advances the active behavior from the runtime's single existing ticker. */
  update(now: number) {
    const activation = this.active
    if (!activation || activation.runState !== 'active' || !activation.instance.update) return

    try {
      const result = activation.instance.update(now)
      if (result === 'completed') void this.finishActivation(activation)
    } catch (error) {
      void this.failActivation(activation, 'update', error)
    }
  }

  /** Cancels pending and active work with a typed lifecycle reason. */
  async cancel(reason: BehaviorExitReason) {
    if (this.destroyed && reason !== 'destroyed') return
    ++this.generation
    this.pending = null
    const activation = this.detachActive()
    if (activation) await this.exitActivation(activation, reason)
    this.publishSnapshot()
  }

  /** Permanently stops the engine. Safe to call repeatedly. */
  async destroy() {
    if (this.destroyed) return
    this.destroyed = true
    ++this.generation
    this.pending = null
    const activation = this.detachActive()
    if (activation) await this.exitActivation(activation, 'destroyed')
    this.publishSnapshot()
  }

  private isEligible(definition: BehaviorDefinition<Context>, context: Readonly<Context>) {
    try {
      return definition.isEligible?.(context) ?? true
    } catch (error) {
      this.reportError(definition.id, 'eligibility', error)
      return false
    }
  }

  private detachActive() {
    const activation = this.active
    this.active = null
    activation?.controller.abort()
    return activation
  }

  private async finishActivation(activation: Activation<Context>) {
    if (this.active !== activation) return
    ++this.generation
    this.active = null
    activation.controller.abort()
    await this.exitActivation(activation, 'completed')
    this.publishSnapshot()
  }

  private async failActivation(
    activation: Activation<Context>,
    phase: BehaviorPhase,
    error: unknown,
  ) {
    if (this.active !== activation) return
    ++this.generation
    this.active = null
    activation.controller.abort()
    await this.exitActivation(activation, 'failed')
    this.reportError(activation.definition.id, phase, error)
  }

  private async exitActivation(
    activation: Activation<Context>,
    reason: BehaviorExitReason,
  ) {
    // Exit-at-most-once is the cleanup invariant. Mark before awaiting so a
    // concurrent cancel cannot invoke the same extension hook twice.
    if (activation.exited) return
    activation.exited = true
    activation.controller.abort()

    try {
      await activation.instance.exit?.(reason)
    } catch (error) {
      this.reportError(activation.definition.id, 'exit', error)
    }
  }

  private reportError(id: string, phase: BehaviorPhase, error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    this.lastError = `[${id}:${phase}] ${message}`
    try {
      this.diagnostics.reportError(id, phase, error)
    } catch {
      // Diagnostics must never become a second failure path for the engine.
    }
    this.publishSnapshot()
  }

  private publishSnapshot() {
    try {
      this.diagnostics.publish(this.getSnapshot())
    } catch {
      // Snapshot consumers are observational and cannot control engine health.
    }
  }
}
