import { BehaviorEngine } from '../BehaviorEngine'
import { BehaviorRegistry } from '../BehaviorRegistry'
import {
  AMBIENT_BEHAVIOR_IDS,
  createAmbientBehaviorDefinitions,
  type AmbientBehaviorContext,
} from '../ambient/AmbientBehaviorModule'
import {
  AmbientScheduler,
  type AmbientSchedulerSnapshot,
} from '../ambient/AmbientScheduler'
import type {
  BehaviorDiagnosticsPort,
  BehaviorExitReason,
  BehaviorInstance,
} from '../types'

export const RUNTIME_BEHAVIOR_IDS = {
  idle: 'core.idle',
  interaction: 'core.interaction',
  drag: 'core.drag',
} as const

export interface RuntimeBehaviorPorts extends AmbientBehaviorContext {
  enterIdle(): void
  enterInteraction(): void
  enterDrag(): void
}

function enterOnly(action: () => void): BehaviorInstance {
  return { enter: action }
}

/**
 * Composition adapter for core and ambient behavior modules. It owns policy
 * wiring while BehaviorEngine remains unaware of concrete behavior IDs.
 */
export class RuntimeBehaviorAdapter {
  private readonly context: RuntimeBehaviorPorts
  private readonly registry: BehaviorRegistry<RuntimeBehaviorPorts>
  private readonly engine: BehaviorEngine<RuntimeBehaviorPorts>
  private readonly scheduler: AmbientScheduler
  private readonly onSchedulerSnapshot: (snapshot: AmbientSchedulerSnapshot) => void
  private lastObservedBehaviorId: string | null = null
  private lastSchedulerSnapshot: AmbientSchedulerSnapshot | null = null
  private eligibleAmbientIds = new Set<string>()
  private paused = true
  private destroyed = false

  constructor(
    context: RuntimeBehaviorPorts,
    autonomousEnabled: boolean,
    diagnostics?: BehaviorDiagnosticsPort,
    onSchedulerSnapshot: (snapshot: AmbientSchedulerSnapshot) => void = () => {},
  ) {
    this.context = context
    this.onSchedulerSnapshot = onSchedulerSnapshot
    this.registry = new BehaviorRegistry<RuntimeBehaviorPorts>()
      .register({
        id: RUNTIME_BEHAVIOR_IDS.idle,
        priority: 0,
        tags: ['ambient'],
        create: (ports) => enterOnly(ports.enterIdle),
      })
      .register({
        id: RUNTIME_BEHAVIOR_IDS.interaction,
        priority: 100,
        tags: ['manual'],
        create: (ports) => enterOnly(ports.enterInteraction),
      })
      .register({
        id: RUNTIME_BEHAVIOR_IDS.drag,
        priority: 200,
        tags: ['manual', 'blocking'],
        create: (ports) => enterOnly(ports.enterDrag),
      })

    for (const definition of createAmbientBehaviorDefinitions<RuntimeBehaviorPorts>()) {
      this.registry.register(definition)
    }

    this.scheduler = new AmbientScheduler(
      { idle: RUNTIME_BEHAVIOR_IDS.idle, ...AMBIENT_BEHAVIOR_IDS },
      context.random,
    )
    this.scheduler.setEnabled(autonomousEnabled, 0)

    this.engine = new BehaviorEngine(this.registry, diagnostics)
    this.publishSchedulerSnapshot()
  }

  requestIdle(replaceReason: BehaviorExitReason = 'completed') {
    return this.engine.request(RUNTIME_BEHAVIOR_IDS.idle, this.context, {
      force: true,
      replaceReason,
    })
  }

  requestInteraction(now: number) {
    this.scheduler.recordActivity(now)
    return this.engine.request(RUNTIME_BEHAVIOR_IDS.interaction, this.context)
  }

  requestDrag(now: number) {
    this.scheduler.recordActivity(now)
    return this.engine.request(RUNTIME_BEHAVIOR_IDS.drag, this.context)
  }

  hasBehavior(id: string) {
    return this.registry.get(id) !== null
  }

  requestReaction(id: string, now: number) {
    if (!this.registry.get(id)) return Promise.resolve(false)
    return this.engine.request(id, this.context, { replaceReason: 'replaced' }).then((accepted) => {
      if (accepted) this.scheduler.recordActivity(now)
      return accepted
    })
  }

  async interruptForUser(now: number) {
    this.scheduler.recordActivity(now)
    await this.engine.cancel('user-input')
    this.publishSchedulerSnapshot()
  }

  async pause(reason: Extract<BehaviorExitReason, 'paused' | 'hidden' | 'reload'>) {
    this.paused = true
    this.scheduler.pause()
    await this.engine.cancel(reason)
    this.lastObservedBehaviorId = null
    this.publishSchedulerSnapshot()
  }

  resume(now: number) {
    this.paused = false
    this.scheduler.resume(now)
    this.publishSchedulerSnapshot()
    return this.requestIdle('completed')
  }

  async setAutonomousEnabled(enabled: boolean, now: number) {
    this.scheduler.setEnabled(enabled, now)
    const activeId = this.engine.getSnapshot().activeBehaviorId
    if (!enabled && this.isAmbientBehavior(activeId)) {
      await this.engine.cancel('disabled')
      await this.requestIdle('disabled')
    }
    this.publishSchedulerSnapshot()
  }

  /** Refresh after character load/reload; animation capabilities are otherwise stable. */
  refreshAmbientCapabilities() {
    const eligible = new Set<string>()
    if (this.context.ambientAnimation.has('walk')) eligible.add(AMBIENT_BEHAVIOR_IDS.walk)
    if (this.context.ambientAnimation.has('sit')) eligible.add(AMBIENT_BEHAVIOR_IDS.sit)
    if (this.context.ambientAnimation.has('sleep')) eligible.add(AMBIENT_BEHAVIOR_IDS.sleep)
    this.eligibleAmbientIds = eligible
  }

  update(now: number) {
    if (this.destroyed) return
    this.engine.update(now)
    const activeId = this.engine.getSnapshot().activeBehaviorId
    if (this.paused) {
      this.publishSchedulerSnapshot()
      return
    }

    if (this.isAmbientBehavior(this.lastObservedBehaviorId) && activeId === null) {
      this.scheduler.ambientCompleted(now)
      void this.requestIdle('completed')
      this.lastObservedBehaviorId = RUNTIME_BEHAVIOR_IDS.idle
      this.publishSchedulerSnapshot()
      return
    }

    if (activeId === null) {
      void this.requestIdle('completed')
      this.lastObservedBehaviorId = RUNTIME_BEHAVIOR_IDS.idle
      this.publishSchedulerSnapshot()
      return
    }

    this.lastObservedBehaviorId = activeId
    if (activeId !== RUNTIME_BEHAVIOR_IDS.idle) {
      this.publishSchedulerSnapshot()
      return
    }

    const requestedId = this.scheduler.update(now, activeId, this.eligibleAmbientIds)
    if (requestedId) void this.engine.request(requestedId, this.context)
    this.publishSchedulerSnapshot()
  }

  async destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.scheduler.destroy()
    await this.engine.destroy()
    this.publishSchedulerSnapshot()
  }

  private isAmbientBehavior(id: string | null) {
    return Object.values(AMBIENT_BEHAVIOR_IDS).some((ambientId) => ambientId === id)
  }

  private publishSchedulerSnapshot() {
    const snapshot = this.scheduler.getSnapshot(
      this.engine?.getSnapshot().activeBehaviorId ?? null,
    )
    const previous = this.lastSchedulerSnapshot
    if (
      previous &&
      previous.status === snapshot.status &&
      previous.nextActionAt === snapshot.nextActionAt &&
      previous.lastActivityAt === snapshot.lastActivityAt &&
      previous.enabled === snapshot.enabled &&
      previous.paused === snapshot.paused &&
      previous.destroyed === snapshot.destroyed
    ) {
      return
    }
    this.lastSchedulerSnapshot = snapshot
    this.onSchedulerSnapshot(snapshot)
  }
}
