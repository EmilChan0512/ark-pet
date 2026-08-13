import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { DebugSnapshot, DebugStore } from '../types/pet'
import { PetRuntime } from '../pet/PetRuntime'
import { createPetSettingsStore } from '../settings/PetSettings'
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
  const settingsStore = useMemo(() => createPetSettingsStore(), [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const snapshot = useSyncExternalStore(
    debugStore.subscribe,
    debugStore.getSnapshot,
    debugStore.getSnapshot,
  )
  const settings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getSnapshot,
  )

  useEffect(() => {
    if (!hostRef.current) return

    const runtime = new PetRuntime(hostRef.current, debugStore, settingsStore.getSnapshot(), () => {
      setSettingsOpen((open) => !open)
    })
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
  }, [debugStore, settingsStore])

  useEffect(() => {
    void runtimeRef.current?.applySettings(settings)
  }, [settings])

  useEffect(() => {
    void runtimeRef.current?.setUiInteractionActive(settingsOpen)
  }, [settingsOpen])

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

      {settingsOpen ? (
        <aside className="settings-panel" aria-label="Pet settings">
          <div className="settings-panel__header">
            <div>
              <div className="settings-panel__eyebrow">CODEX PET</div>
              <h1>Settings</h1>
            </div>
            <button
              className="settings-panel__close"
              type="button"
              aria-label="Close settings"
              onClick={() => setSettingsOpen(false)}
            >
              ×
            </button>
          </div>

          <label className="settings-field">
            <span>
              Character scale <output>{Math.round(settings.scale * 100)}%</output>
            </span>
            <input
              type="range"
              min="0.6"
              max="1.4"
              step="0.1"
              value={settings.scale}
              onChange={(event) => settingsStore.update({ scale: Number(event.target.value) })}
            />
          </label>

          <label className="settings-field">
            <span>Render frame rate</span>
            <select
              value={settings.fps}
              onChange={(event) =>
                settingsStore.update({ fps: Number(event.target.value) as 30 | 60 })
              }
            >
              <option value={30}>30 FPS · Power saver</option>
              <option value={60}>60 FPS · Smooth</option>
            </select>
          </label>

          <label className="settings-toggle">
            <span>
              <strong>Always on top</strong>
              <small>Keep the pet above other windows</small>
            </span>
            <input
              type="checkbox"
              checked={settings.alwaysOnTop}
              onChange={(event) => settingsStore.update({ alwaysOnTop: event.target.checked })}
            />
          </label>

          {import.meta.env.DEV ? (
            <label className="settings-toggle">
              <span>
                <strong>Debug panel</strong>
                <small>Show live renderer and interaction state</small>
              </span>
              <input
                type="checkbox"
                checked={settings.showDebugPanel}
                onChange={(event) =>
                  settingsStore.update({ showDebugPanel: event.target.checked })
                }
              />
            </label>
          ) : null}

          <div className="settings-panel__actions">
            <button type="button" onClick={() => settingsStore.reset()}>
              Reset defaults
            </button>
            <button type="button" className="settings-panel__done" onClick={() => setSettingsOpen(false)}>
              Done
            </button>
          </div>
        </aside>
      ) : null}

      {import.meta.env.DEV && settings.showDebugPanel ? (
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
