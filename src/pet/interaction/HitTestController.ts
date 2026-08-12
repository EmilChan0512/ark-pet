export interface HitTestResult {
  hit: boolean
  pointer: { x: number; y: number }
}

export class HitTestController {
  private lastHit: boolean | null = null
  private readonly getBounds: () => DOMRect | null
  private readonly setPassthrough: (enabled: boolean) => Promise<void>

  constructor(
    getBounds: () => DOMRect | null,
    setPassthrough: (enabled: boolean) => Promise<void>,
  ) {
    this.getBounds = getBounds
    this.setPassthrough = setPassthrough
  }

  async evaluate(clientX: number, clientY: number): Promise<HitTestResult> {
    const bounds = this.getBounds()
    const hit =
      bounds !== null &&
      clientX >= bounds.left &&
      clientX <= bounds.right &&
      clientY >= bounds.top &&
      clientY <= bounds.bottom

    if (hit !== this.lastHit) {
      this.lastHit = hit
      await this.setPassthrough(!hit)
    }

    return {
      hit,
      pointer: { x: clientX, y: clientY },
    }
  }
}
