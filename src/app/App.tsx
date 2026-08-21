import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { DebugSnapshot, DebugStore } from '../types/pet'
import { PetRuntime } from '../pet/PetRuntime'
import { createPetRuntimeCommandHandler } from '../pet/runtime/PetRuntimeCommandHandler'
import {
  RuntimeCommandCoordinator,
  type RuntimeCommand,
} from '../pet/runtime/RuntimeCommandCoordinator'
import { createPetSettingsStore } from '../settings/PetSettings'
import { ensureTray, listenForSettingsRequest, quitApplication } from '../services/tauri'
import {
  CharacterPackageService,
  builtInCharacter,
  type PackageInspection,
} from '../services/characterPackages'
import type { CharacterCatalogEntry } from '../types/character'
import {
  listenDebugCommands,
  publishDebugSnapshot,
  setDebugWindowVisible,
} from '../debug/DebugBridge'
import { INITIAL_DEBUG_SNAPSHOT } from '../debug/initialDebugSnapshot'
import './App.css'

const DESKTOP_AWARENESS_CONSENT_VERSION = 1
const CONTENT_PERCEPTION_CONSENT_VERSION = 1

function formatPackageError(error: unknown) {
  if (typeof error === 'object' && error && 'code' in error && 'message' in error) {
    return `${String(error.code)}: ${String(error.message)}`
  }
  return error instanceof Error ? error.message : String(error)
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function createDebugStore(): DebugStore {
  let snapshot: DebugSnapshot = {
    ...INITIAL_DEBUG_SNAPSHOT,
    desktopAwareness: { ...INITIAL_DEBUG_SNAPSHOT.desktopAwareness },
    characterMind: { ...INITIAL_DEBUG_SNAPSHOT.characterMind },
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
  const snapshotRef = useRef<DebugSnapshot>(INITIAL_DEBUG_SNAPSHOT)
  const runtimeGenerationRef = useRef(0)
  const debugStore = useMemo(() => createDebugStore(), [])
  const settingsStore = useMemo(() => createPetSettingsStore(), [])
  const characterPackageService = useMemo(() => new CharacterPackageService(), [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [characterCatalog, setCharacterCatalog] = useState<CharacterCatalogEntry[]>([builtInCharacter()])
  const [packageInspection, setPackageInspection] = useState<PackageInspection | null>(null)
  const [packageBusy, setPackageBusy] = useState(false)
  const [packageOutcome, setPackageOutcome] = useState('Catalog not loaded')
  const [awarenessDisclosureOpen, setAwarenessDisclosureOpen] = useState(false)
  const [contentDisclosureOpen, setContentDisclosureOpen] = useState(false)
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
  snapshotRef.current = snapshot

  const refreshCharacterCatalog = useCallback(async () => {
    try {
      const catalog = await characterPackageService.loadCatalog()
      setCharacterCatalog(catalog)
      setPackageOutcome(`Catalog ready: ${catalog.length} character(s)`)
    } catch (error) {
      setPackageOutcome(`Catalog error: ${formatPackageError(error)}`)
    }
  }, [characterPackageService])

  const inspectCharacterPackage = async () => {
    setPackageBusy(true)
    try {
      const inspection = await characterPackageService.chooseAndInspect()
      if (inspection) {
        setPackageInspection(inspection)
        setPackageOutcome(`Inspection passed: ${inspection.packageId}@${inspection.packageVersion}`)
      }
    } catch (error) {
      setPackageOutcome(`Inspection failed: ${formatPackageError(error)}`)
    } finally {
      setPackageBusy(false)
    }
  }

  const installInspectedPackage = async () => {
    if (!packageInspection) return
    setPackageBusy(true)
    const outcome = await commandCoordinatorRef.current?.dispatch({
      type: 'install-character-package', inspectionToken: packageInspection.inspectionToken,
    })
    if (outcome === 'executed') {
      setPackageOutcome(`Installed ${packageInspection.packageId}@${packageInspection.packageVersion}`)
      setPackageInspection(null)
      await refreshCharacterCatalog()
    } else setPackageOutcome(`Install ${outcome ?? 'unavailable'}`)
    setPackageBusy(false)
  }

  const selectCharacter = async (characterId: string) => {
    setPackageBusy(true)
    const coordinator = commandCoordinatorRef.current
    const outcome = await coordinator?.dispatch({ type: 'select-character', characterId })
    const failure = coordinator?.getSnapshot().lastError
    setPackageOutcome(
      outcome === 'executed'
        ? `Selected ${characterId}`
        : `Selection ${outcome ?? 'unavailable'}${failure ? `: ${failure}` : ''}`,
    )
    setPackageBusy(false)
  }

  const removeCharacter = async (entry: CharacterCatalogEntry) => {
    if (!entry.packageId || !window.confirm(`Remove ${entry.displayName}?`)) return
    setPackageBusy(true)
    const outcome = await commandCoordinatorRef.current?.dispatch({
      type: 'remove-character-package', packageId: entry.packageId, characterId: entry.id,
    })
    if (outcome === 'executed') await refreshCharacterCatalog()
    setPackageOutcome(outcome === 'executed' ? `Removed ${entry.packageId}` : `Removal ${outcome ?? 'unavailable'}`)
    setPackageBusy(false)
  }

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
      () => null,
      (characterId) => settingsStore.update({ activeCharacterId: characterId }),
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
    let settingsRequestCleanup: (() => void) | null = null
    let disposed = false

    const dispatch = (command: RuntimeCommand) => coordinator.dispatch(command)

    void dispatch({ type: 'initialize' })
      .then(async (outcome) => {
        if (disposed) return
        if (outcome !== 'executed') return

        await refreshCharacterCatalog()

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

    void listenForSettingsRequest(async () => {
      await dispatch({ type: 'request-settings' })
    }).then((cleanup) => {
      if (disposed) cleanup()
      else settingsRequestCleanup = cleanup
    })

    return () => {
      disposed = true
      if (runtimeGenerationRef.current === runtimeGeneration) {
        runtimeGenerationRef.current += 1
      }
      void coordinator.dispatch({ type: 'destroy' })
      void trayCleanup?.()
      settingsRequestCleanup?.()
      commandCoordinatorRef.current = null
    }
  }, [debugStore, refreshCharacterCatalog, settingsStore])

  useEffect(() => {
    void commandCoordinatorRef.current?.dispatch({ type: 'apply-settings', settings })
  }, [settings])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    void setDebugWindowVisible(settings.showDebugPanel)
  }, [settings.showDebugPanel])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const publish = () => void publishDebugSnapshot(snapshotRef.current)
    publish()
    const interval = window.setInterval(publish, 250)
    let cleanup = () => {}
    let active = true
    void listenDebugCommands((command) => {
      if (command.type === 'set-debug-window-visible') {
        settingsStore.update({ showDebugPanel: command.visible })
      } else {
        void commandCoordinatorRef.current?.dispatch(command)
      }
    }).then((next) => {
      if (active) cleanup = next
      else next()
    })
    return () => {
      active = false
      window.clearInterval(interval)
      cleanup()
      void setDebugWindowVisible(false)
    }
  }, [settingsStore])

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
      if (event.key === 'F11') {
        settingsStore.update({
          showDebugPanel: !settingsStore.getSnapshot().showDebugPanel,
        })
        return
      }
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
            <span>Active character</span>
            <select
              value={settings.activeCharacterId}
              disabled={packageBusy}
              onChange={(event) => void selectCharacter(event.target.value)}
            >
              {characterCatalog.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.displayName}{entry.source === 'built-in' ? ' · Built-in' : ` · ${entry.packageVersion}`}
                </option>
              ))}
            </select>
          </label>

          <section className="character-manager" aria-label="Character packages">
            <div className="character-manager__actions">
              <button type="button" disabled={packageBusy} onClick={() => void inspectCharacterPackage()}>
                Import Character Package
              </button>
              {characterCatalog.find((entry) => entry.id === settings.activeCharacterId)?.source === 'installed' ? (
                <button
                  type="button"
                  disabled={packageBusy}
                  onClick={() => {
                    const entry = characterCatalog.find((item) => item.id === settings.activeCharacterId)
                    if (entry) void removeCharacter(entry)
                  }}
                >
                  Remove active character
                </button>
              ) : null}
            </div>
            {packageInspection ? (
              <div className="character-package-review" role="status">
                {packageInspection.previewDataUrl ? <img src={packageInspection.previewDataUrl} alt="Character package preview" /> : null}
                <strong>{packageInspection.displayName}</strong>
                <span>{packageInspection.packageId} · v{packageInspection.packageVersion}</span>
                <span>{packageInspection.author ?? 'Unknown author'} · {formatBytes(packageInspection.installedSize)}</span>
                <span>{packageInspection.capabilities.join(', ')}</span>
                {packageInspection.description ? <p>{packageInspection.description}</p> : null}
                <div className="character-manager__actions">
                  <button type="button" disabled={packageInspection.updateKind === 'conflict' || packageBusy} onClick={() => void installInspectedPackage()}>
                    Confirm {packageInspection.updateKind === 'upgrade' ? 'update' : 'installation'}
                  </button>
                  <button type="button" onClick={() => setPackageInspection(null)}>Cancel</button>
                </div>
              </div>
            ) : null}
            <small>{packageOutcome}</small>
          </section>

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

          <section className="awareness-settings" aria-label="Desktop awareness">
            <div className="settings-toggle">
              <span>
                <strong>Desktop awareness</strong>
                <small>Optional local reactions to coarse desktop state</small>
              </span>
              <input
                type="checkbox"
                checked={settings.desktopAwarenessEnabled}
                onChange={(event) => {
                  if (!event.target.checked) {
                    settingsStore.update({ desktopAwarenessEnabled: false })
                  } else if (settings.desktopAwarenessConsentVersion !== DESKTOP_AWARENESS_CONSENT_VERSION) {
                    setAwarenessDisclosureOpen(true)
                  } else {
                    settingsStore.update({ desktopAwarenessEnabled: true })
                  }
                }}
              />
            </div>
            <div className="awareness-status" role="status">
              <span>Status: {snapshot.desktopAwareness.status}</span>
              <span>Category: {snapshot.desktopAwareness.category}</span>
              <span>Idle: {snapshot.desktopAwareness.idleState}{snapshot.desktopAwareness.idleBucket ? ` · ${snapshot.desktopAwareness.idleBucket}` : ''}</span>
              <span>Session: {snapshot.desktopAwareness.sessionState}</span>
              <span>Capabilities: app {snapshot.desktopAwareness.capabilities.foregroundCategory}, idle {snapshot.desktopAwareness.capabilities.systemIdle}, lock {snapshot.desktopAwareness.capabilities.sessionLock}</span>
              {snapshot.desktopAwareness.errorCode ? <span>Error: {snapshot.desktopAwareness.errorCode}</span> : null}
            </div>
            <small className="awareness-not-collected">
              This coarse switch never reads titles or content. Foreground title access is a
              separate permission below.
            </small>
            {settings.desktopAwarenessEnabled ? (
              <button type="button" onClick={() => settingsStore.update({ desktopAwarenessEnabled: false })}>
                Disable immediately
              </button>
            ) : null}
          </section>

          {awarenessDisclosureOpen ? (
            <section className="awareness-disclosure" role="dialog" aria-modal="true" aria-label="Desktop awareness disclosure">
              <h2>Enable private desktop awareness?</h2>
              <p>Ark Pet reads only system idle duration, lock/unlock state, and the current app’s broad local category.</p>
              <p>It does not read titles, URLs, screen contents, files, keyboard input, clipboard data, messages, or document text.</p>
              <p>Raw application identity is classified inside the native process, then discarded. It is never stored, sent to a persona, uploaded, or included in telemetry.</p>
              <p>Awareness stays local and can be disabled immediately.</p>
              <div className="settings-panel__actions">
                <button type="button" className="settings-panel__done" onClick={() => {
                  settingsStore.update({
                    desktopAwarenessConsentVersion: DESKTOP_AWARENESS_CONSENT_VERSION,
                    desktopAwarenessEnabled: true,
                  })
                  setAwarenessDisclosureOpen(false)
                }}>Enable</button>
                <button type="button" onClick={() => setAwarenessDisclosureOpen(false)}>Not now</button>
              </div>
            </section>
          ) : null}

          <section className="awareness-settings" aria-label="Content perception">
            <div className="settings-toggle">
              <span>
                <strong>Foreground context</strong>
                <small>Let her notice a stable foreground window title and form her own response</small>
              </span>
              <input
                type="checkbox"
                checked={settings.contentPerceptionEnabled}
                onChange={(event) => {
                  if (!event.target.checked) {
                    settingsStore.update({ contentPerceptionEnabled: false })
                  } else if (settings.contentPerceptionConsentVersion !== CONTENT_PERCEPTION_CONSENT_VERSION) {
                    setContentDisclosureOpen(true)
                  } else {
                    settingsStore.update({
                      contentPerceptionEnabled: true,
                      desktopAwarenessEnabled: true,
                      desktopAwarenessConsentVersion: DESKTOP_AWARENESS_CONSENT_VERSION,
                    })
                  }
                }}
              />
            </div>
            <small className="awareness-not-collected">
              Phase 11 MVP reads only the current window title on Windows. Screen pixels, URLs,
              filenames, input, clipboard, and messages remain future permission-scoped sensors.
            </small>
          </section>

          {contentDisclosureOpen ? (
            <section className="awareness-disclosure" role="dialog" aria-modal="true" aria-label="Content perception disclosure">
              <h2>Let her notice foreground context?</h2>
              <p>Ark Pet will read the title of the foreground window after it remains stable for three seconds.</p>
              <p>The raw title is interpreted locally, kept only in short-lived memory, and is not stored, uploaded, passed into persona files, or shown in the normal debug snapshot.</p>
              <p>She may decide to react based on her initiative style. This permission can be disabled in Settings at any time.</p>
              <div className="settings-panel__actions">
                <button type="button" className="settings-panel__done" onClick={() => {
                  settingsStore.update({
                    contentPerceptionConsentVersion: CONTENT_PERCEPTION_CONSENT_VERSION,
                    contentPerceptionEnabled: true,
                    desktopAwarenessConsentVersion: DESKTOP_AWARENESS_CONSENT_VERSION,
                    desktopAwarenessEnabled: true,
                  })
                  setContentDisclosureOpen(false)
                }}>Enable</button>
                <button type="button" onClick={() => setContentDisclosureOpen(false)}>Not now</button>
              </div>
            </section>
          ) : null}

          <label className="settings-toggle">
            <span>
              <strong>Self-initiated responses</strong>
              <small>She decides whether a noticed scene is worth acting on</small>
            </span>
            <input
              type="checkbox"
              checked={settings.initiativeEnabled}
              onChange={(event) => settingsStore.update({ initiativeEnabled: event.target.checked })}
            />
          </label>

          <label className="settings-field">
            <span>Initiative style</span>
            <select
              value={settings.initiativeStyle}
              disabled={!settings.initiativeEnabled}
              onChange={(event) => settingsStore.update({ initiativeStyle: event.target.value as typeof settings.initiativeStyle })}
            >
              <option value="quiet">Quiet · attention ≥80% · about 20 min</option>
              <option value="balanced">Balanced · attention ≥45% · about 6 min</option>
              <option value="expressive">Expressive · attention ≥20% · about 2 min</option>
            </select>
            <small>Attention is her live response to a scene, not a user-controlled value. Inspect it in Debug → Mind.</small>
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
                <small>Open the compact independent development window</small>
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

    </div>
  )
}
