import type { PetSettings } from '../../settings/PetSettings'
import type { SpeakRequest, SpeechCancellationReason } from '../speech/types'
import type { ContextEvent } from '../reaction/types'

export type RuntimeCommand =
  | { readonly type: 'initialize' }
  | { readonly type: 'show' }
  | { readonly type: 'hide' }
  | { readonly type: 'reload-character' }
  | { readonly type: 'request-settings' }
  | { readonly type: 'apply-settings'; readonly settings: PetSettings }
  | { readonly type: 'set-ui-interaction'; readonly active: boolean }
  | { readonly type: 'prepare-character-voice' }
  | { readonly type: 'speak'; readonly request: SpeakRequest }
  | { readonly type: 'cancel-speech'; readonly reason: SpeechCancellationReason }
  | { readonly type: 'simulate-context'; readonly event: ContextEvent }
  | { readonly type: 'clear-first-meeting-marker' }
  | { readonly type: 'clear-reaction-cooldowns' }
  | { readonly type: 'destroy' }

export type RuntimeCommandOutcome =
  | 'executed'
  | 'superseded'
  | 'failed'
  | 'rejected-destroyed'

export interface RuntimeCommandSnapshot {
  readonly activeCommand: RuntimeCommand['type'] | null
  readonly queueDepth: number
  readonly accepting: boolean
  readonly destroyed: boolean
  readonly generation: number
  readonly lastError: string | null
}

export interface RuntimeCommandHandler {
  execute(command: RuntimeCommand): void | Promise<void>
}

export interface RuntimeCommandDiagnostics {
  publish(snapshot: RuntimeCommandSnapshot): void
  reportError(command: RuntimeCommand, error: unknown): void
}

interface QueueEntry {
  readonly command: RuntimeCommand
  readonly resolve: (outcome: RuntimeCommandOutcome) => void
}

const NULL_DIAGNOSTICS: RuntimeCommandDiagnostics = {
  publish: () => {},
  reportError: () => {},
}

function coalescingKey(command: RuntimeCommand): string | null {
  switch (command.type) {
    case 'show':
    case 'hide':
      return 'visibility'
    case 'reload-character':
    case 'request-settings':
    case 'apply-settings':
    case 'set-ui-interaction':
    case 'prepare-character-voice':
      return command.type
    case 'cancel-speech':
    case 'simulate-context':
    case 'clear-first-meeting-marker':
    case 'clear-reaction-cooldowns':
      return command.type
    default:
      return null
  }
}

/**
 * Serializes external runtime intent without depending on its implementation.
 * Each dispatch settles even when coalesced, failed, or rejected by shutdown.
 */
export class RuntimeCommandCoordinator {
  private readonly handler: RuntimeCommandHandler
  private readonly diagnostics: RuntimeCommandDiagnostics
  private queue: QueueEntry[] = []
  private activeCommand: RuntimeCommand['type'] | null = null
  private generation = 0
  private draining = false
  private accepting = true
  private destroyed = false
  private lastError: string | null = null

  constructor(
    handler: RuntimeCommandHandler,
    diagnostics: RuntimeCommandDiagnostics = NULL_DIAGNOSTICS,
  ) {
    this.handler = handler
    this.diagnostics = diagnostics
    this.publishSnapshot()
  }

  /** Returns a detached view so diagnostics cannot mutate queue state. */
  getSnapshot(): RuntimeCommandSnapshot {
    return {
      activeCommand: this.activeCommand,
      queueDepth: this.queue.length,
      accepting: this.accepting,
      destroyed: this.destroyed,
      generation: this.generation,
      lastError: this.lastError,
    }
  }

  dispatch(command: RuntimeCommand): Promise<RuntimeCommandOutcome> {
    if (!this.accepting) return Promise.resolve('rejected-destroyed')

    if (command.type === 'destroy') {
      // Close synchronously. React cleanup and tray quit can otherwise enqueue
      // work during the gap before asynchronous runtime destruction begins.
      this.accepting = false
      for (const entry of this.queue.splice(0)) entry.resolve('superseded')
    } else {
      const key = coalescingKey(command)
      if (key) {
        const retained: QueueEntry[] = []
        for (const entry of this.queue) {
          if (coalescingKey(entry.command) === key) entry.resolve('superseded')
          else retained.push(entry)
        }
        this.queue = retained
      }
    }

    return new Promise((resolve) => {
      ++this.generation
      this.queue.push({ command, resolve })
      this.publishSnapshot()
      void this.drain()
    })
  }

  private async drain() {
    if (this.draining) return
    this.draining = true

    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift()
        if (!entry) break
        this.activeCommand = entry.command.type
        this.publishSnapshot()

        let outcome: RuntimeCommandOutcome = 'executed'
        try {
          await this.handler.execute(entry.command)
        } catch (error) {
          outcome = 'failed'
          this.lastError = `[${entry.command.type}] ${
            error instanceof Error ? error.message : String(error)
          }`
          this.reportError(entry.command, error)
        }

        if (entry.command.type === 'destroy') this.destroyed = true
        entry.resolve(outcome)
        this.activeCommand = null
        this.publishSnapshot()
      }
    } finally {
      this.draining = false
      this.publishSnapshot()
      // A dispatch can append after the loop condition but before `draining`
      // is cleared. Recheck so that entry never becomes stranded.
      if (this.queue.length > 0) void this.drain()
    }
  }

  private reportError(command: RuntimeCommand, error: unknown) {
    try {
      this.diagnostics.reportError(command, error)
    } catch {
      // Observability is not allowed to become a second command failure.
    }
  }

  private publishSnapshot() {
    try {
      this.diagnostics.publish(this.getSnapshot())
    } catch {
      // Snapshot consumers are observational and cannot control the queue.
    }
  }
}
