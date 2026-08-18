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

const DEV_AI_VOICE_SAMPLES = [
  {
    key: 'walk-return',
    label: 'AI 1 · 散步归来',
    text: 'Dr.Stardust，你和欣特莱雅小姐散步回来了啊，唔，今天天气不错？',
  },
  {
    key: 'evening-book',
    label: 'AI 2 · 晚上读古籍',
    text: '晚上好，博士，来和我一块看看这本古籍吧。',
  },
] as const

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
    activeSpeechSession: null,
    speechQueueDepth: 0,
    speechAudioSource: null,
    speechVoiceEnabled: false,
    lastSpeechError: null,
    lastContextEvent: null,
    selectedReactionId: null,
    activeReactionId: null,
    reactionState: 'idle',
    reactionBlockedReason: null,
    currentLocalTimePeriod: null,
    lastReactionError: null,
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
  const debugPanelRef = useRef<HTMLElement | null>(null)
  const commandCoordinatorRef = useRef<RuntimeCommandCoordinator | null>(null)
  const runtimeGenerationRef = useRef(0)
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

  const testDynamicCharacterVoice = (text: string, sampleKey = 'default') => {
    const voiceSettings = {
      ...settingsStore.getSnapshot(),
      speechMode: 'character-voice' as const,
    }
    settingsStore.update({ speechMode: 'character-voice' })
    void commandCoordinatorRef.current
      ?.dispatch({ type: 'apply-settings', settings: voiceSettings })
      .then(async () => {
        const prepared = await commandCoordinatorRef.current?.dispatch({
          type: 'prepare-character-voice',
        })
        if (prepared !== 'executed') return prepared
        const now = performance.now()
        return commandCoordinatorRef.current?.dispatch({
          type: 'speak',
          request: {
            id: `dev-voice-test-${Date.now()}`,
            source: 'local-integration',
            text,
            locale: 'zh-CN',
            dedupeKey: `dev.voice-test.${sampleKey}`,
            expiresAt: now + 5_000,
          },
        })
      })
  }

  useEffect(() => {
    if (!hostRef.current) return

    const runtimeGeneration = ++runtimeGenerationRef.current
    // React Strict Mode intentionally overlaps a disposed first mount with the
    // replacement mount. Gate diagnostics so the old runtime cannot publish a
    // late "destroyed" snapshot into the new runtime's debug view.
    const runtimeDebugStore: DebugStore = {
      getSnapshot: debugStore.getSnapshot,
      subscribe: debugStore.subscribe,
      patch(partial) {
        if (runtimeGenerationRef.current === runtimeGeneration) {
          debugStore.patch(partial)
        }
      },
    }

    const runtime = new PetRuntime(
      hostRef.current,
      runtimeDebugStore,
      settingsStore.getSnapshot(),
      () => setSettingsOpen(true),
      () => debugPanelRef.current?.getBoundingClientRect() ?? null,
    )
    const coordinator = new RuntimeCommandCoordinator(
      createPetRuntimeCommandHandler(runtime),
      {
        publish: (commandSnapshot) => {
          runtimeDebugStore.patch({
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
      if (runtimeGenerationRef.current === runtimeGeneration) {
        runtimeGenerationRef.current += 1
      }
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

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const handleDevelopmentShortcut = (event: KeyboardEvent) => {
      if (event.key === 'F10') setSettingsOpen(true)
      if (event.key === 'Escape') setSettingsOpen(false)
      if (event.key !== 'F8' && event.key !== 'F9') return
      settingsStore.update({ speechMode: 'character-voice' })
      const originalClip = event.key === 'F8'
      window.setTimeout(() => {
        const now = performance.now()
        void commandCoordinatorRef.current?.dispatch({
          type: 'speak',
          request: {
            id: `dev-shortcut-${Date.now()}`,
            source: 'local-integration',
            text: originalClip
              ? '不许拆我背后的蝴蝶结！'
              : '博士，今天要先整理哪份记录？',
            cue: originalClip ? '戳一下' : undefined,
            locale: 'zh-CN',
            dedupeKey: originalClip ? 'dev.original-test' : 'dev.ai-test',
            expiresAt: now + 5_000,
          },
        })
      }, 100)
    }
    window.addEventListener('keydown', handleDevelopmentShortcut)
    return () => window.removeEventListener('keydown', handleDevelopmentShortcut)
  }, [settingsStore])

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
              <strong>Contextual personality</strong>
              <small>React to clicks, returns, session time, and late nights</small>
            </span>
            <input
              type="checkbox"
              checked={settings.personalityEnabled}
              onChange={(event) => settingsStore.update({ personalityEnabled: event.target.checked })}
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

          <label className="settings-field">
            <span>Dialogue and character voice</span>
            <select
              value={settings.speechMode}
              onChange={(event) =>
                settingsStore.update({
                  speechMode: event.target.value as typeof settings.speechMode,
                })
              }
            >
              <option value="off">Off</option>
              <option value="text">Text only</option>
              <option value="character-voice">Pepe character voice</option>
            </select>
          </label>

          {settings.speechMode === 'character-voice' ? (
            <label className="settings-field">
              <span>
                Character voice volume{' '}
                <output>{Math.round(settings.characterVoiceVolume * 100)}%</output>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.characterVoiceVolume}
                onChange={(event) =>
                  settingsStore.update({
                    characterVoiceVolume: Number(event.target.value),
                  })
                }
              />
            </label>
          ) : null}

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
            {import.meta.env.DEV && settings.speechMode === 'character-voice' ? (
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false)
                  window.setTimeout(
                    () => testDynamicCharacterVoice('博士，今天要先整理哪份记录？'),
                    50,
                  )
                }}
              >
                Test Pepe voice
              </button>
            ) : null}
            <button type="button" onClick={() => settingsStore.reset()}>
              Reset defaults
            </button>
            <button type="button" className="settings-panel__done" onClick={() => setSettingsOpen(false)}>
              Done
            </button>
          </div>
        </aside>
      ) : null}

      {import.meta.env.DEV && settings.showDebugPanel && !settingsOpen ? (
        <aside ref={debugPanelRef} className="debug-panel">
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
          <div>Speech Session: {snapshot.activeSpeechSession ?? 'n/a'}</div>
          <div>Speech Queue: {snapshot.speechQueueDepth}</div>
          <div>Speech Audio: {snapshot.speechAudioSource ?? 'text-only'}</div>
          <div>Character Voice: {snapshot.speechVoiceEnabled ? 'enabled' : 'disabled'}</div>
          <div>Time Period: {snapshot.currentLocalTimePeriod ?? 'n/a'}</div>
          <div>Last Context: {snapshot.lastContextEvent?.type ?? 'n/a'}</div>
          <div>Selected Reaction: {snapshot.selectedReactionId ?? 'n/a'}</div>
          <div>Active Reaction: {snapshot.activeReactionId ?? 'n/a'} ({snapshot.reactionState})</div>
          {snapshot.reactionBlockedReason ? <div>Reaction Blocked: {snapshot.reactionBlockedReason}</div> : null}
          {snapshot.lastRuntimeCommandError ? (
            <pre>{snapshot.lastRuntimeCommandError}</pre>
          ) : null}
          {snapshot.lastBehaviorError ? <pre>{snapshot.lastBehaviorError}</pre> : null}
          {snapshot.lastSpeechError ? <pre>{snapshot.lastSpeechError}</pre> : null}
          {snapshot.lastReactionError ? <pre>{snapshot.lastReactionError}</pre> : null}
          {snapshot.lastError ? <pre>{snapshot.lastError}</pre> : null}
          <div className="debug-panel__voice-actions" aria-label="Pepe AI voice samples">
            {DEV_AI_VOICE_SAMPLES.map((sample) => (
              <button
                key={sample.key}
                type="button"
                title={sample.text}
                onClick={() => testDynamicCharacterVoice(sample.text, sample.key)}
              >
                {sample.label}
              </button>
            ))}
          </div>
          <div className="debug-panel__voice-actions" aria-label="Personality event simulations">
            {([
              ['First meeting', { type: 'session.first-meeting-today', at: performance.now() }],
              ['Returned', { type: 'session.user-returned', at: performance.now(), idleMs: 600_000 }],
              ['Long active', { type: 'session.long-active', at: performance.now(), activeMs: 7_200_000 }],
              ['Late night', { type: 'time.period-entered', at: performance.now(), period: 'late-night' }],
            ] as const).map(([label, event]) => (
              <button key={label} type="button" onClick={() => void commandCoordinatorRef.current?.dispatch({ type: 'simulate-context', event })}>
                {label}
              </button>
            ))}
            <button type="button" onClick={() => void commandCoordinatorRef.current?.dispatch({ type: 'clear-first-meeting-marker' })}>
              Clear daily greeting
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
