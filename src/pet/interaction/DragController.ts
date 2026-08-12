import type { NativeWindowService } from '../../services/tauri'

interface DragSession {
  pointerX: number
  pointerY: number
  windowX: number
  windowY: number
}

export class DragController {
  private session: DragSession | null = null
  private readonly nativeWindowService: NativeWindowService

  constructor(nativeWindowService: NativeWindowService) {
    this.nativeWindowService = nativeWindowService
  }

  async start(pointerX: number, pointerY: number) {
    const windowPosition = await this.nativeWindowService.getWindowPosition()
    if (!windowPosition) return false

    this.session = {
      pointerX,
      pointerY,
      windowX: windowPosition.x,
      windowY: windowPosition.y,
    }

    return true
  }

  isDragging() {
    return this.session !== null
  }

  async update(pointerX: number, pointerY: number) {
    if (!this.session) return

    const nextX = this.session.windowX + (pointerX - this.session.pointerX)
    const nextY = this.session.windowY + (pointerY - this.session.pointerY)
    await this.nativeWindowService.moveWindow(nextX, nextY)
  }

  stop() {
    this.session = null
  }
}
