import { defaultWindowIcon } from '@tauri-apps/api/app'
import { isTauri } from '@tauri-apps/api/core'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { Menu } from '@tauri-apps/api/menu'
import { TrayIcon } from '@tauri-apps/api/tray'
import { currentMonitor, cursorPosition, getCurrentWindow } from '@tauri-apps/api/window'
import { exit } from '@tauri-apps/plugin-process'

export interface TrayCallbacks {
  onShow: () => Promise<void> | void
  onHide: () => Promise<void> | void
  onReloadCharacter: () => Promise<void> | void
  onSettings: () => Promise<void> | void
  onQuit: () => Promise<void> | void
}

export class NativeWindowService {
  private readonly appWindow = isTauri() ? getCurrentWindow() : null

  isAvailable(): boolean {
    return this.appWindow !== null
  }

  async getWindowPosition() {
    if (!this.appWindow) return null
    return this.appWindow.innerPosition()
  }

  async getCursorPosition() {
    if (!this.appWindow) return null
    return cursorPosition()
  }

  async getScaleFactor() {
    if (!this.appWindow) return 1
    return this.appWindow.scaleFactor()
  }

  async getWindowGeometry() {
    if (!this.appWindow) return null
    const [position, size, monitor] = await Promise.all([
      this.appWindow.innerPosition(),
      this.appWindow.innerSize(),
      currentMonitor(),
    ])
    if (!monitor) return null

    return {
      position: { x: position.x, y: position.y },
      size: { width: size.width, height: size.height },
      workArea: {
        position: { x: monitor.workArea.position.x, y: monitor.workArea.position.y },
        size: { width: monitor.workArea.size.width, height: monitor.workArea.size.height },
      },
    }
  }

  async moveWindow(x: number, y: number) {
    if (!this.appWindow) return
    await this.appWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)))
  }

  async moveWindowBy(deltaX: number, deltaY: number) {
    if (!this.appWindow) return
    const position = await this.appWindow.innerPosition()
    await this.moveWindow(position.x + deltaX, position.y + deltaY)
  }

  async setIgnoreCursorEvents(ignore: boolean) {
    if (!this.appWindow) return
    await this.appWindow.setIgnoreCursorEvents(ignore)
  }

  async setAlwaysOnTop(alwaysOnTop: boolean) {
    if (!this.appWindow) return
    await this.appWindow.setAlwaysOnTop(alwaysOnTop)
  }

  async show() {
    if (!this.appWindow) return
    await this.appWindow.show()
  }

  async hide() {
    if (!this.appWindow) return
    await this.appWindow.hide()
  }

  onMoved(handler: (position: PhysicalPosition) => void) {
    if (!this.appWindow) return async () => {}
    return this.appWindow.onMoved(({ payload }) => handler(payload))
  }
}

let trayIcon: TrayIcon | null = null

export async function ensureTray(callbacks: TrayCallbacks) {
  if (!isTauri()) {
    return async () => {}
  }

  if (trayIcon) {
    return async () => {
      await trayIcon?.close()
      trayIcon = null
    }
  }

  const menu = await Menu.new({
    items: [
      { id: 'show-pet', text: 'Show Pet', action: callbacks.onShow },
      { id: 'hide-pet', text: 'Hide Pet', action: callbacks.onHide },
      {
        id: 'reload-character',
        text: 'Reload Character',
        action: callbacks.onReloadCharacter,
      },
      { id: 'settings', text: 'Settings', action: callbacks.onSettings },
      { id: 'quit', text: 'Quit', action: callbacks.onQuit },
    ],
  })

  trayIcon = await TrayIcon.new({
    id: 'pet-tray',
    icon: (await defaultWindowIcon()) ?? undefined,
    tooltip: 'Tauri Spine Desktop Pet',
    menu,
    showMenuOnLeftClick: true,
  })

  return async () => {
    await trayIcon?.close()
    trayIcon = null
  }
}

export async function quitApplication() {
  if (!isTauri()) return
  await exit(0)
}
