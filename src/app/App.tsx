import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { DebugSnapshot, DebugStore } from '../types/pet'
import { PetRuntime } from '../pet/PetRuntime'
import { ensureTray, quitApplication } from '../services/tauri'
import './App.css'

function createDebugStore(): DebugStore {
  let snapshot: DebugSnapshot = {
    fps: 0,
    petState: 'loading',
    currentAnimation: null,
    windowPosition: null,
    pointerPosition: null,
    hitTest: false,
    mousePassthrough: false,
    characterId: null,
    rendererStatus: 'idle',
    characterManifest: null,
    lastError: null,
  }
  const listeners = new Set<() => void>()

  return {
    getSnapshot() {
      return snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    patch(partial) {
      snapshot = { ...snapshot, ...partial }
      for (const listener of listeners) {
        listener()
      }
    },
  }
}

export default function App() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const runtimeRef = useRef<PetRuntime | null>(null)
  const debugStore = useMemo(() => createDebugStore(), [])
  const snapshot = useSyncExternalStore(
    debugStore.subscribe,
    debugStore.getSnapshot,
    debugStore.getSnapshot,
  )

  useEffect(() => {
    if (!hostRef.current) return

    const runtime = new PetRuntime(hostRef.current, debugStore)
    runtimeRef.current = runtime

    let trayCleanup: (() => Promise<void>) | null = null
    let disposed = false

    void runtime
      .init()
      .then(async () => {
        if (disposed) return

        trayCleanup = await ensureTray({
          onShow: () => runtime.show(),
          onHide: () => runtime.hide(),
          onReloadCharacter: () => runtime.reloadCharacter(),
          onSettings: () => runtime.openSettings(),
          onQuit: async () => {
            runtime.destroy()
            await quitApplication()
          },
        })
      })
      .catch((error) => {
        console.error('[App] Failed to initialize pet runtime', error)
      })

    return () => {
      disposed = true
      runtime.destroy()
      void trayCleanup?.()
      runtimeRef.current = null
    }
  }, [debugStore])

  return (
    <div className="app-shell">
      <div ref={hostRef} className="pet-host" />

      <aside className="overlay-card">
        <div className="overlay-card__title">Desktop Pet</div>
        <div className="overlay-card__row">
          <button onClick={() => runtimeRef.current?.reloadCharacter()}>Reload</button>
          <button onClick={() => runtimeRef.current?.show()}>Show</button>
          <button onClick={() => runtimeRef.current?.hide()}>Hide</button>
        </div>
        <div className="overlay-card__hint">
          Real Pepe Spine assets are running on the 3.8-compatible runtime path.
        </div>
      </aside>

      {import.meta.env.DEV ? (
        <aside className="debug-panel">
          <div>FPS: {snapshot.fps}</div>
          <div>Pet State: {snapshot.petState}</div>
          <div>Current Animation: {snapshot.currentAnimation ?? 'n/a'}</div>
          <div>
            Window Position:{' '}
            {snapshot.windowPosition
              ? `${snapshot.windowPosition.x}, ${snapshot.windowPosition.y}`
              : 'n/a'}
          </div>
          <div>
            Pointer Position:{' '}
            {snapshot.pointerPosition
              ? `${Math.round(snapshot.pointerPosition.x)}, ${Math.round(snapshot.pointerPosition.y)}`
              : 'n/a'}
          </div>
          <div>Hit Test: {String(snapshot.hitTest)}</div>
          <div>Mouse Passthrough: {String(snapshot.mousePassthrough)}</div>
          <div>Character ID: {snapshot.characterId ?? 'n/a'}</div>
          {snapshot.lastError ? <pre>{snapshot.lastError}</pre> : null}
        </aside>
      ) : null}
    </div>
  )
}
