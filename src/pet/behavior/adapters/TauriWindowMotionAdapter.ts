import type { NativeWindowService } from '../../../services/tauri'
import type { WindowMotionPort } from '../ambient/AmbientBehaviorModule'

interface PositionRequest {
  x: number
  y: number
}

/**
 * Coalesces ticker-rate targets over slower Tauri IPC. Cancellation waits for
 * the single unavoidable in-flight call before a replacement behavior enters.
 */
export class TauriWindowMotionAdapter implements WindowMotionPort {
  private latest: PositionRequest | null = null
  private flushPromise: Promise<void> | null = null
  private generation = 0
  private readonly nativeWindowService: NativeWindowService

  constructor(nativeWindowService: NativeWindowService) {
    this.nativeWindowService = nativeWindowService
  }

  getGeometry() {
    return this.nativeWindowService.getWindowGeometry()
  }

  requestPosition(x: number, y: number) {
    this.latest = { x, y }
    if (this.flushPromise) return

    const generation = this.generation
    this.flushPromise = this.flush(generation).finally(() => {
      this.flushPromise = null
      if (this.latest && generation === this.generation) {
        this.requestPosition(this.latest.x, this.latest.y)
      }
    })
  }

  async cancel() {
    ++this.generation
    this.latest = null
    await this.flushPromise
  }

  private async flush(generation: number) {
    while (this.latest && generation === this.generation) {
      const target = this.latest
      this.latest = null
      await this.nativeWindowService.moveWindow(target.x, target.y)
    }
  }
}
