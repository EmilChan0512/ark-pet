import type {
  AudioPlaybackPort,
  CharacterVoiceArtifact,
  CharacterVoiceContext,
  CharacterVoiceResolverPort,
  SpeakRequest,
  SpeechCancellationReason,
  SpeechCoordinatorSnapshot,
  SpeechDiagnosticsPort,
  SpeechOutcome,
  SpeechPresentation,
  SpeechSource,
  TextPresentationPort,
  VoiceProgressStatus,
} from './types'

interface QueueEntry {
  readonly request: SpeakRequest
  readonly priority: number
  readonly enqueuedAt: number
  readonly resolve: (outcome: SpeechOutcome) => void
}

interface ActiveSession extends QueueEntry {
  readonly generation: number
  readonly voiceController: AbortController
  text: string
  audio: CharacterVoiceArtifact | null
  displayDeadline: number
  synthesisDeadline: number
  hardDeadline: number
  playbackStarted: boolean
  playbackFinished: boolean
  synthesisTimedOut: boolean
  presentationVisible: boolean
  settled: boolean
}

export interface SpeechSessionOptions {
  readonly queueCapacity: number
  readonly synthesisTimeoutMs: number
  readonly hardTimeoutMs: number
  readonly audioTailMs: number
  readonly volume: number
}

const DEFAULT_OPTIONS: SpeechSessionOptions = {
  queueCapacity: 6,
  synthesisTimeoutMs: 12_000,
  hardTimeoutMs: 25_000,
  audioTailMs: 350,
  volume: 0.8,
}

const SOURCE_PRIORITIES: Record<SpeechSource, number> = {
  system: 300,
  interaction: 200,
  'local-integration': 150,
  ambient: 50,
}

const NULL_DIAGNOSTICS: SpeechDiagnosticsPort = {
  publish: () => {},
  reportError: () => {},
}

function graphemeCount(text: string) {
  return Array.from(text).length
}

function displayDuration(text: string) {
  return Math.min(9_000, Math.max(2_500, 2_200 + graphemeCount(text) * 90))
}

function normalizedText(text: string) {
  const withoutControls = Array.from(text)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
    })
    .join('')
  return withoutControls.replace(/\s+/g, ' ').trim()
}

/**
 * Owns exactly one visible utterance and a bounded pending queue.
 *
 * Asynchronous synthesis and playback are guarded by both AbortSignal and a
 * monotonically increasing generation. The signal asks cooperative adapters
 * to stop; the generation prevents a late, non-cooperative completion from
 * mutating a newer bubble or starting stale audio.
 */
export class SpeechSessionCoordinator {
  private readonly presentation: TextPresentationPort
  private readonly voiceResolver: CharacterVoiceResolverPort
  private readonly player: AudioPlaybackPort
  private readonly getVoiceContext: () => CharacterVoiceContext | null
  private readonly diagnostics: SpeechDiagnosticsPort
  private readonly options: SpeechSessionOptions
  private queue: QueueEntry[] = []
  private active: ActiveSession | null = null
  private generation = 0
  private lastNow = 0
  private paused = true
  private destroyed = false
  private voiceEnabled = false
  private voiceProgressStatus: VoiceProgressStatus = 'disabled'
  private voiceProgressLog: string[] = []
  private volume: number
  private lastError: string | null = null

  constructor(
    presentation: TextPresentationPort,
    voiceResolver: CharacterVoiceResolverPort,
    player: AudioPlaybackPort,
    getVoiceContext: () => CharacterVoiceContext | null,
    diagnostics: SpeechDiagnosticsPort = NULL_DIAGNOSTICS,
    options: Partial<SpeechSessionOptions> = {},
  ) {
    this.presentation = presentation
    this.voiceResolver = voiceResolver
    this.player = player
    this.getVoiceContext = getVoiceContext
    this.diagnostics = diagnostics
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.volume = this.options.volume
    this.publishSnapshot()
  }

  getSnapshot(): SpeechCoordinatorSnapshot {
    return {
      activeSessionId: this.active?.request.id ?? null,
      activeSource: this.active?.request.source ?? null,
      activePriority: this.active?.priority ?? null,
      activeAudioSource: this.active?.audio?.source ?? null,
      queueDepth: this.queue.length,
      paused: this.paused,
      destroyed: this.destroyed,
      voiceEnabled: this.voiceEnabled,
      voiceProgressStatus: this.voiceProgressStatus,
      voiceProgressLog: [...this.voiceProgressLog],
      generation: this.generation,
      lastError: this.lastError,
    }
  }

  enqueue(request: SpeakRequest, now: number): Promise<SpeechOutcome> {
    if (this.destroyed) return Promise.resolve('rejected-destroyed')
    if (this.paused) return Promise.resolve('rejected-paused')

    const text = normalizedText(request.text)
    if (!text || graphemeCount(text) > 256) {
      this.reportError(request.id, 'validate', new Error('Speech text must contain 1-256 characters'))
      return Promise.resolve('failed')
    }
    if (request.expiresAt !== undefined && request.expiresAt <= now) {
      return Promise.resolve('expired')
    }

    const normalizedRequest = { ...request, text }
    const priority = request.priority ?? SOURCE_PRIORITIES[request.source]

    return new Promise((resolve) => {
      const entry: QueueEntry = { request: normalizedRequest, priority, enqueuedAt: now, resolve }

      this.removePendingDuplicates(entry)
      const shouldReplace = Boolean(
        this.active &&
          (priority > this.active.priority ||
            (request.dedupeKey && request.dedupeKey === this.active.request.dedupeKey)),
      )
      if (shouldReplace) this.cancelActive('replaced', 'superseded', false)

      if (!this.active) {
        this.start(entry, now)
      } else {
        this.queue.push(entry)
        this.enforceCapacity()
      }
      this.publishSnapshot()
    })
  }

  /** Advances deterministic deadlines from PetRuntime's existing ticker. */
  update(now: number) {
    if (this.destroyed) return
    this.lastNow = now
    this.expirePending(now)
    const active = this.active
    if (!active) {
      this.startNext(now)
      return
    }

    if (!active.playbackStarted && !active.synthesisTimedOut && now >= active.synthesisDeadline) {
      active.synthesisTimedOut = true
      active.voiceController.abort()
      this.recordVoiceProgress('ready', `Synthesis timed out for ${active.request.id}; using text`)
      this.showTextFallback(active)
    }
    if (now >= active.hardDeadline) {
      this.cancelActive('failed', 'completed')
      return
    }
    if (!active.playbackStarted && now >= active.displayDeadline) {
      this.finishActive('completed')
      return
    }
    if (active.playbackFinished && now >= active.displayDeadline) {
      this.finishActive('completed')
    }
  }

  setVoiceEnabled(enabled: boolean) {
    if (this.destroyed || this.voiceEnabled === enabled) return
    this.voiceEnabled = enabled
    if (!enabled && this.active) {
      this.active.voiceController.abort()
      this.player.stop('disabled')
      this.active.playbackStarted = false
      this.active.playbackFinished = false
      this.active.audio = null
    }
    if (enabled) {
      this.recordVoiceProgress('idle', 'Character voice enabled')
      void this.prepareVoice().catch(() => {})
    } else {
      this.recordVoiceProgress('disabled', 'Character voice disabled')
    }
    this.publishSnapshot()
  }

  /** Completes only when the configured character resolver is ready to serve. */
  async prepareVoice() {
    if (this.destroyed || !this.voiceEnabled) return
    this.recordVoiceProgress('preparing', 'Preparing local Pepe voice runtime')
    try {
      await this.voiceResolver.prepare?.()
      this.recordVoiceProgress('ready', 'Local Pepe voice runtime ready')
    } catch (error) {
      this.reportError('voice-runtime', 'prepare', error)
      throw error
    }
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume))
  }

  pause(reason: Extract<SpeechCancellationReason, 'hidden' | 'reload' | 'ui-interaction' | 'disabled'>) {
    if (this.destroyed) return
    this.paused = true
    this.cancelAll(reason)
  }

  resume() {
    if (this.destroyed || !this.paused) return
    this.paused = false
    this.publishSnapshot()
  }

  cancelAll(reason: SpeechCancellationReason) {
    for (const entry of this.queue.splice(0)) entry.resolve('cancelled')
    this.cancelActive(reason, 'cancelled')
    this.publishSnapshot()
  }

  async destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.paused = true
    for (const entry of this.queue.splice(0)) entry.resolve('cancelled')
    this.cancelActive('destroyed', 'cancelled')
    const voiceCleanup = this.voiceResolver.destroy?.()
    this.player.destroy()
    this.presentation.destroy()
    this.publishSnapshot()
    await voiceCleanup
  }

  private start(entry: QueueEntry, now: number) {
    if (this.destroyed || this.paused) {
      entry.resolve(this.destroyed ? 'rejected-destroyed' : 'rejected-paused')
      return
    }
    const generation = ++this.generation
    const duration = displayDuration(entry.request.text)
    const voiceContext = this.voiceEnabled ? this.getVoiceContext() : null
    const deferUntilSynthesized = Boolean(voiceContext && !entry.request.cue)
    const visibleDuration = voiceContext && !deferUntilSynthesized
      ? Math.max(duration, this.options.synthesisTimeoutMs + 500)
      : duration
    const active: ActiveSession = {
      ...entry,
      generation,
      voiceController: new AbortController(),
      text: entry.request.text,
      audio: null,
      displayDeadline: deferUntilSynthesized ? Number.POSITIVE_INFINITY : now + visibleDuration,
      synthesisDeadline: now + this.options.synthesisTimeoutMs,
      hardDeadline: now + this.options.hardTimeoutMs,
      playbackStarted: false,
      playbackFinished: false,
      synthesisTimedOut: false,
      presentationVisible: false,
      settled: false,
    }
    this.active = active
    if (!deferUntilSynthesized) this.show(active)

    if (voiceContext) {
      this.recordVoiceProgress('synthesizing', `Synthesizing ${entry.request.id}`)
      void this.resolveAndPlay(active, voiceContext)
    } else {
      const reason = this.voiceEnabled ? 'voice context unavailable' : 'character voice disabled'
      this.recordVoiceProgress(this.voiceEnabled ? 'ready' : 'disabled', `Showing text for ${entry.request.id}: ${reason}`)
    }
    this.publishSnapshot()
  }

  private async resolveAndPlay(active: ActiveSession, context: CharacterVoiceContext) {
    let artifact: CharacterVoiceArtifact | null
    try {
      artifact = await this.voiceResolver.resolve(
        active.request,
        context,
        active.voiceController.signal,
      )
    } catch (error) {
      if (!active.voiceController.signal.aborted) {
        this.reportError(active.request.id, 'resolve', error)
        this.showTextFallback(active)
      }
      return
    }

    if (!artifact || !this.isCurrent(active) || active.voiceController.signal.aborted) {
      if (this.isCurrent(active) && !active.voiceController.signal.aborted) {
        this.recordVoiceProgress('ready', `No voice artifact for ${active.request.id}; using text`)
        this.showTextFallback(active)
      }
      return
    }
    if (
      artifact.characterId !== context.characterId ||
      artifact.characterGeneration !== context.characterGeneration ||
      artifact.voiceIdentity !== context.voiceIdentity
    ) {
      this.reportError(active.request.id, 'identity', new Error('Voice artifact identity mismatch'))
      this.showTextFallback(active)
      return
    }

    active.audio = artifact
    active.text = normalizedText(artifact.transcript)
    active.playbackStarted = true
    this.recordVoiceProgress('playing', `Playing ${artifact.source} for ${active.request.id}`)
    this.show(active)
    this.publishSnapshot()

    try {
      await this.player.play(
        artifact,
        { volume: this.volume },
        active.voiceController.signal,
      )
    } catch (error) {
      if (!active.voiceController.signal.aborted) this.reportError(active.request.id, 'play', error)
      if (this.isCurrent(active)) {
        active.playbackStarted = false
        active.audio = null
        this.show(active)
      }
      return
    }

    if (!this.isCurrent(active) || active.voiceController.signal.aborted) return
    active.playbackFinished = true
    this.recordVoiceProgress('ready', `Playback complete for ${active.request.id}`)
    active.displayDeadline = Math.min(
      active.hardDeadline,
      this.lastNow + this.options.audioTailMs,
    )
    this.publishSnapshot()
  }

  private show(active: ActiveSession) {
    const presentation: SpeechPresentation = {
      sessionId: active.request.id,
      text: active.text,
      source: active.request.source,
      audioSource: active.audio?.source ?? null,
    }
    try {
      this.presentation.show(presentation)
      active.presentationVisible = true
    } catch (error) {
      this.reportError(active.request.id, 'present', error)
    }
  }

  private finishActive(outcome: SpeechOutcome, startNext = true) {
    const active = this.active
    if (!active) return
    this.active = null
    ++this.generation
    active.voiceController.abort()
    if (active.presentationVisible) {
      try {
        this.presentation.hide(active.request.id)
      } catch (error) {
        this.reportError(active.request.id, 'hide', error)
      }
    }
    if (!active.settled) {
      active.settled = true
      active.resolve(outcome)
    }
    if (startNext) this.startNext(this.lastNow)
    this.publishSnapshot()
  }

  private cancelActive(
    reason: SpeechCancellationReason,
    outcome: SpeechOutcome,
    startNext = true,
  ) {
    const active = this.active
    if (!active) return
    this.recordVoiceProgress(
      this.voiceEnabled ? 'ready' : 'disabled',
      `Cancelled ${active.request.id}: ${reason}`,
    )
    this.player.stop(reason)
    this.finishActive(outcome, startNext)
  }

  private startNext(now: number) {
    if (this.active || this.paused || this.destroyed) return
    this.expirePending(now)
    this.queue.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt)
    const next = this.queue.shift()
    if (next) this.start(next, now)
  }

  private removePendingDuplicates(incoming: QueueEntry) {
    if (!incoming.request.dedupeKey) return
    const retained: QueueEntry[] = []
    for (const entry of this.queue) {
      if (entry.request.dedupeKey === incoming.request.dedupeKey) entry.resolve('superseded')
      else retained.push(entry)
    }
    this.queue = retained
  }

  private enforceCapacity() {
    while (this.queue.length > this.options.queueCapacity) {
      let victimIndex = 0
      for (let index = 1; index < this.queue.length; index += 1) {
        const victim = this.queue[victimIndex]
        const candidate = this.queue[index]
        if (
          candidate.priority < victim.priority ||
          (candidate.priority === victim.priority && candidate.enqueuedAt < victim.enqueuedAt)
        ) {
          victimIndex = index
        }
      }
      const [victim] = this.queue.splice(victimIndex, 1)
      victim?.resolve('superseded')
    }
  }

  private expirePending(now: number) {
    const retained: QueueEntry[] = []
    for (const entry of this.queue) {
      if (entry.request.expiresAt !== undefined && entry.request.expiresAt <= now) {
        entry.resolve('expired')
      } else {
        retained.push(entry)
      }
    }
    this.queue = retained
  }

  private isCurrent(active: ActiveSession) {
    return this.active === active && active.generation === this.generation
  }

  private reportError(sessionId: string, phase: string, error: unknown) {
    this.lastError = `[${sessionId}:${phase}] ${error instanceof Error ? error.message : String(error)}`
    this.recordVoiceProgress('error', this.lastError)
    try {
      this.diagnostics.reportError(sessionId, phase, error)
    } catch {
      // Observability cannot become a second speech failure.
    }
    this.publishSnapshot()
  }

  private showTextFallback(active: ActiveSession) {
    if (!this.isCurrent(active) || active.presentationVisible) return
    active.displayDeadline = Math.min(
      active.hardDeadline,
      this.lastNow + displayDuration(active.text),
    )
    this.show(active)
    this.publishSnapshot()
  }

  private recordVoiceProgress(status: VoiceProgressStatus, message: string) {
    this.voiceProgressStatus = status
    this.voiceProgressLog.push(`[${Math.round(this.lastNow)}ms] ${message}`)
    if (this.voiceProgressLog.length > 8) this.voiceProgressLog.splice(0, this.voiceProgressLog.length - 8)
    this.publishSnapshot()
  }

  private publishSnapshot() {
    try {
      this.diagnostics.publish(this.getSnapshot())
    } catch {
      // Snapshots are observational and cannot control session ownership.
    }
  }
}
