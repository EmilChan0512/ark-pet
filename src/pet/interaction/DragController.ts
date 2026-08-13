import type { NativeWindowService } from '../../services/tauri'
import type { FacingDirection } from '../../types/character'

const DIRECTION_DEAD_ZONE = 2

interface DragSession {
  pointerX: number
  pointerY: number
  windowX: number
  windowY: number
  lastPointerX: number
}

export class DragController {
  private session: DragSession | null = null
  private updateRequested = false
  private updatePromise: Promise<void> | null = null
  private readonly nativeWindowService: NativeWindowService
  private readonly onDirectionChanged: (direction: FacingDirection) => void

  constructor(
    nativeWindowService: NativeWindowService,
    onDirectionChanged: (direction: FacingDirection) => void,
  ) {
    this.nativeWindowService = nativeWindowService
    this.onDirectionChanged = onDirectionChanged
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
      lastPointerX: pointerPosition.x,
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

      const horizontalDelta = pointerPosition.x - session.lastPointerX
      if (Math.abs(horizontalDelta) >= DIRECTION_DEAD_ZONE) {
        this.onDirectionChanged(horizontalDelta < 0 ? 'left' : 'right')
        session.lastPointerX = pointerPosition.x
      }

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
