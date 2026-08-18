import type { ContextEvent } from './types'

export interface ContextEventBusDiagnostics {
  reportSubscriberError(event: ContextEvent, error: unknown): void
}

const NULL_DIAGNOSTICS: ContextEventBusDiagnostics = { reportSubscriberError: () => {} }

export class ContextEventBus {
  private readonly subscribers = new Set<(event: ContextEvent) => void>()
  private readonly diagnostics: ContextEventBusDiagnostics
  private destroyed = false

  constructor(diagnostics: ContextEventBusDiagnostics = NULL_DIAGNOSTICS) {
    this.diagnostics = diagnostics
  }

  subscribe(subscriber: (event: ContextEvent) => void) {
    if (this.destroyed) return () => {}
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  publish(event: ContextEvent) {
    if (this.destroyed) return
    for (const subscriber of [...this.subscribers]) {
      if (!this.subscribers.has(subscriber)) continue
      try {
        subscriber(event)
      } catch (error) {
        try {
          this.diagnostics.reportSubscriberError(event, error)
        } catch {
          // Diagnostics are observational.
        }
      }
    }
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.subscribers.clear()
  }
}
