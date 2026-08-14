import type { BehaviorDefinition } from './types'

/** Immutable-at-read registry used as the behavior module extension point. */
export class BehaviorRegistry<Context> {
  private readonly definitions = new Map<string, BehaviorDefinition<Context>>()

  /** Registers one definition and returns the registry for composition chaining. */
  register(definition: BehaviorDefinition<Context>) {
    if (!definition.id.trim()) {
      throw new Error('Behavior id must not be empty')
    }
    if (!Number.isFinite(definition.priority)) {
      throw new Error(`Behavior priority must be finite: ${definition.id}`)
    }
    if (this.definitions.has(definition.id)) {
      throw new Error(`Behavior already registered: ${definition.id}`)
    }

    this.definitions.set(definition.id, definition)
    return this
  }

  /** Returns a registered definition without exposing the mutable map. */
  get(id: string) {
    return this.definitions.get(id) ?? null
  }

  /** Returns a frozen copy so policies cannot mutate registry ownership. */
  list(): readonly BehaviorDefinition<Context>[] {
    return Object.freeze([...this.definitions.values()])
  }
}
