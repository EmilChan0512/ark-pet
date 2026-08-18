const MAX_ENTRIES = 128

export class ReactionCooldownStore {
  private readonly lastUsed = new Map<string, number>()

  remaining(key: string, cooldownMs: number, now: number) {
    const last = this.lastUsed.get(key)
    return last === undefined ? 0 : Math.max(0, last + cooldownMs - now)
  }

  mark(key: string, now: number) {
    this.lastUsed.delete(key)
    this.lastUsed.set(key, now)
    while (this.lastUsed.size > MAX_ENTRIES) {
      const oldest = this.lastUsed.keys().next().value
      if (oldest === undefined) break
      this.lastUsed.delete(oldest)
    }
  }

  reset() {
    this.lastUsed.clear()
  }
}
