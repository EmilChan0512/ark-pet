import { isTauri } from '@tauri-apps/api/core'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getAllWindows } from '@tauri-apps/api/window'
import type { ContextEvent } from '../pet/reaction/types'
import type { DebugSnapshot } from '../types/pet'

export type DebugCommand =
  | { readonly type: 'simulate-context'; readonly event: ContextEvent }
  | { readonly type: 'clear-reaction-cooldowns' }
  | { readonly type: 'clear-first-meeting-marker' }
  | { readonly type: 'set-debug-window-visible'; readonly visible: boolean }

export async function setDebugWindowVisible(visible: boolean) {
  if (!isTauri() || !import.meta.env.DEV) return
  try {
    const debugWindow = (await getAllWindows()).find((window) => window.label === 'debug')
    if (!debugWindow) return
    if (visible) { await debugWindow.show(); await debugWindow.setFocus() }
    else await debugWindow.hide()
  } catch (error) {
    console.warn('[DebugBridge] Could not change debug window visibility', error)
  }
}

export async function publishDebugSnapshot(snapshot: DebugSnapshot) {
  if (!isTauri() || !import.meta.env.DEV) return
  try {
    await emitTo('debug', 'ark-pet://debug-snapshot', snapshot)
  } catch (error) {
    console.warn('[DebugBridge] Could not publish debug snapshot', error)
  }
}

export function listenDebugSnapshots(listener: (snapshot: DebugSnapshot) => void) {
  if (!isTauri()) return Promise.resolve(() => {})
  return listen<DebugSnapshot>('ark-pet://debug-snapshot', ({ payload }) => listener(payload))
}

export function sendDebugCommand(command: DebugCommand) {
  if (!isTauri()) return Promise.resolve()
  return emitTo('main', 'ark-pet://debug-command', command)
}

export function listenDebugCommands(listener: (command: DebugCommand) => void) {
  if (!isTauri()) return Promise.resolve(() => {})
  return listen<DebugCommand>('ark-pet://debug-command', ({ payload }) => listener(payload))
}
