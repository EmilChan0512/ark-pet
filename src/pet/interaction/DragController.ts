import type { NativeWindowService } from '../../services/tauri'

interface DragSession {
  pointerX: number
  pointerY: number
  windowX: number
  windowY: number
}

export class DragController {
  private session: DragSession | null = null
  private updateRequested = false
  private updatePromise: Promise<void> | null = null
  private readonly nativeWindowService: NativeWindowService

  constructor(nativeWindowService: NativeWindowService) {
    this.nativeWindowService = nativeWindowService
  }

  async start() {
    const [windowPosition, pointerPosition] = await Promise.all([
      this.nativeWindowService.getWindowPosition(),
      this.nativeWindowService.getCursorPosition(),
    ])
    if (!windowPosition || !pointerPosition) return false

    this.session = {
      pointerX: pointerPosition.x,
      pointerY: pointerPosition.y,
      windowX: windowPosition.x,
      windowY: windowPosition.y,
    }

    return true
  }

  isDragging() {
    return this.session !== null
  }

  async update() {
    if (!this.session) return

    this.updateRequested = true
    if (!this.updatePromise) {
      this.updatePromise = this.flushUpdates().finally(() => {
        this.updatePromise = null
      })
    }
    await this.updatePromise
  }

  private async flushUpdates() {
    while (this.session && this.updateRequested) {
      this.updateRequested = false
      const pointerPosition = await this.nativeWindowService.getCursorPosition()
      const session = this.session
      if (!pointerPosition || !session) return

      const nextX = session.windowX + pointerPosition.x - session.pointerX
      const nextY = session.windowY + pointerPosition.y - session.pointerY
      await this.nativeWindowService.moveWindow(nextX, nextY)
    }
  }

  stop() {
    this.session = null
    this.updateRequested = false
  }
}
