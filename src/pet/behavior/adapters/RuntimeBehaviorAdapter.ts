import { BehaviorEngine } from '../BehaviorEngine'
import { BehaviorRegistry } from '../BehaviorRegistry'
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

export interface RuntimeBehaviorPorts {
  enterIdle(): void
  enterInteraction(): void
  enterDrag(): void
}

function enterOnly(action: () => void): BehaviorInstance {
  return { enter: action }
}

/**
 * Composition adapter for existing Phase 1–3 signals. It proves the engine on
 * real runtime paths while keeping Pixi, Spine, and Tauri out of the core.
 */
export class RuntimeBehaviorAdapter {
  private readonly context: RuntimeBehaviorPorts
  private readonly engine: BehaviorEngine<RuntimeBehaviorPorts>

  constructor(context: RuntimeBehaviorPorts, diagnostics?: BehaviorDiagnosticsPort) {
    this.context = context
    const registry = new BehaviorRegistry<RuntimeBehaviorPorts>()
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

    this.engine = new BehaviorEngine(registry, diagnostics)
  }

  requestIdle(replaceReason: BehaviorExitReason = 'completed') {
    return this.engine.request(RUNTIME_BEHAVIOR_IDS.idle, this.context, {
      force: true,
      replaceReason,
    })
  }

  requestInteraction() {
    return this.engine.request(RUNTIME_BEHAVIOR_IDS.interaction, this.context)
  }

  requestDrag() {
    return this.engine.request(RUNTIME_BEHAVIOR_IDS.drag, this.context)
  }

  update(now: number) {
    this.engine.update(now)
  }

  cancel(reason: BehaviorExitReason) {
    return this.engine.cancel(reason)
  }

  destroy() {
    return this.engine.destroy()
  }
}
