import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { DebugSnapshot, DebugStore } from '../types/pet'
import { PetRuntime } from '../pet/PetRuntime'
import { createPetRuntimeCommandHandler } from '../pet/runtime/PetRuntimeCommandHandler'
import {
  RuntimeCommandCoordinator,
  type RuntimeCommand,
} from '../pet/runtime/RuntimeCommandCoordinator'
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
    activeBehavior: null,
    lastBehaviorError: null,
    ambientSchedulerStatus: 'paused',
    nextAmbientActionAt: null,
    activeRuntimeCommand: null,
    runtimeCommandQueueDepth: 0,
    lastRuntimeCommandError: null,
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
  const commandCoordinatorRef = useRef<RuntimeCommandCoordinator | null>(null)
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

    const runtime = new PetRuntime(
      hostRef.current,
      debugStore,
      settingsStore.getSnapshot(),
      () => setSettingsOpen(true),
    )
    const coordinator = new RuntimeCommandCoordinator(
      createPetRuntimeCommandHandler(runtime),
      {
        publish: (commandSnapshot) => {
          debugStore.patch({
            activeRuntimeCommand: commandSnapshot.activeCommand,
            runtimeCommandQueueDepth: commandSnapshot.queueDepth,
            lastRuntimeCommandError: commandSnapshot.lastError,
          })
        },
        reportError: (command, error) => {
          console.error(`[RuntimeCommand] ${command.type}`, error)
        },
      },
    )
    commandCoordinatorRef.current = coordinator

    let trayCleanup: (() => Promise<void>) | null = null
    let disposed = false

    const dispatch = (command: RuntimeCommand) => coordinator.dispatch(command)

    void dispatch({ type: 'initialize' })
      .then(async (outcome) => {
        if (disposed) return
        if (outcome !== 'executed') return

        const cleanup = await ensureTray({
          onShow: async () => {
            await dispatch({ type: 'show' })
          },
          onHide: async () => {
            await dispatch({ type: 'hide' })
          },
          onReloadCharacter: async () => {
            await dispatch({ type: 'reload-character' })
          },
          onSettings: async () => {
            await dispatch({ type: 'request-settings' })
          },
          onQuit: async () => {
            await dispatch({ type: 'destroy' })
            await quitApplication()
          },
        })
        // Strict Mode or a real unmount may dispose the runtime while native
        // tray creation is still awaiting. Close that late resource instead of
        // publishing it into an already-finished component lifecycle.
        if (disposed) await cleanup()
        else trayCleanup = cleanup
      })
      .catch((error) => {
        console.error('[App] Failed to initialize pet runtime', error)
      })

    return () => {
      disposed = true
      void coordinator.dispatch({ type: 'destroy' })
      void trayCleanup?.()
      commandCoordinatorRef.current = null
    }
  }, [debugStore, settingsStore])

  useEffect(() => {
    void commandCoordinatorRef.current?.dispatch({ type: 'apply-settings', settings })
  }, [settings])

  useEffect(() => {
    void commandCoordinatorRef.current?.dispatch({
      type: 'set-ui-interaction',
      active: settingsOpen,
    })
  }, [settingsOpen])

  return (
    <div className="app-shell">
      <div ref={hostRef} className="pet-host" />

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

          <label className="settings-toggle">
            <span>
              <strong>Autonomous behavior</strong>
              <small>Allow local walking, sitting, and sleeping</small>
            </span>
            <input
              type="checkbox"
              checked={settings.autonomousBehavior}
              onChange={(event) =>
                settingsStore.update({ autonomousBehavior: event.target.checked })
              }
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
          <div>Active Behavior: {snapshot.activeBehavior ?? 'n/a'}</div>
          <div>Ambient Scheduler: {snapshot.ambientSchedulerStatus}</div>
          <div>Runtime Command: {snapshot.activeRuntimeCommand ?? 'n/a'}</div>
          <div>Command Queue: {snapshot.runtimeCommandQueueDepth}</div>
          {snapshot.lastRuntimeCommandError ? (
            <pre>{snapshot.lastRuntimeCommandError}</pre>
          ) : null}
          {snapshot.lastBehaviorError ? <pre>{snapshot.lastBehaviorError}</pre> : null}
          {snapshot.lastError ? <pre>{snapshot.lastError}</pre> : null}
        </aside>
      ) : null}
    </div>
  )
}
