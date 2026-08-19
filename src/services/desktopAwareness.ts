import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  CoarseDesktopSample, DesktopAwarenessCapabilities, DesktopAwarenessPort,
} from '../pet/reaction/sources/DesktopContextSource'

const UNSUPPORTED: DesktopAwarenessCapabilities = {
  foregroundCategory: 'unsupported', systemIdle: 'unsupported', sessionLock: 'unsupported',
}

export class TauriDesktopAwarenessPort implements DesktopAwarenessPort {
  private readonly listeners = new Set<(sample: CoarseDesktopSample) => void>()
  private unlisten: UnlistenFn | null = null

  subscribe(listener: (sample: CoarseDesktopSample) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start() {
    if (!isTauri()) return UNSUPPORTED
    if (!this.unlisten) {
      this.unlisten = await listen<CoarseDesktopSample>('desktop-awareness://sample', ({ payload }) => {
        for (const listener of [...this.listeners]) listener(payload)
      })
    }
    return invoke<DesktopAwarenessCapabilities>('start_desktop_awareness')
  }

  async stop() {
    if (isTauri()) await invoke('stop_desktop_awareness')
    this.unlisten?.()
    this.unlisten = null
  }
}
