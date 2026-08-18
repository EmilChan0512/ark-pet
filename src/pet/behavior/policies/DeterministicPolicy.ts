import type { BehaviorDefinition, BehaviorPolicy } from '../types'

/**
 * Stable policy used by tests and non-random fallbacks. Highest priority wins;
 * IDs break ties so registration order cannot change behavior selection.
 */
export class DeterministicPolicy<Context> implements BehaviorPolicy<Context> {
  select(candidates: readonly BehaviorDefinition<Context>[], context: Readonly<Context>) {
    const eligible = candidates.filter((candidate) => candidate.isEligible?.(context) ?? true)
    eligible.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    return eligible[0]?.id ?? null
  }
}
