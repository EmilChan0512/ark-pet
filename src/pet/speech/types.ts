export type SpeechSource =
  | 'system'
  | 'interaction'
  | 'local-integration'
  | 'ambient'

export type SpeechOutcome =
  | 'completed'
  | 'superseded'
  | 'expired'
  | 'cancelled'
  | 'failed'
  | 'rejected-paused'
  | 'rejected-destroyed'

export type SpeechCancellationReason =
  | 'replaced'
  | 'hidden'
  | 'reload'
  | 'ui-interaction'
  | 'disabled'
  | 'destroyed'
  | 'failed'

export type SpeechAudioSource = 'character-original' | 'character-ai'

export type VoiceProgressStatus =
  | 'disabled'
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'synthesizing'
  | 'playing'
  | 'error'

export interface SpeakRequest {
  readonly id: string
  readonly source: SpeechSource
  readonly text: string
  readonly cue?: string
  readonly locale?: string
  readonly priority?: number
  readonly dedupeKey?: string
  readonly expiresAt?: number
}

export interface SpeechPresentation {
  readonly sessionId: string
  readonly text: string
  readonly source: SpeechSource
  readonly audioSource: SpeechAudioSource | null
}

/**
 * Audio is deliberately represented by an opaque URI. The speech core never
 * reads files or creates Blob URLs; the platform playback adapter owns those
 * resources and must revoke them after playback or cancellation.
 */
export interface CharacterVoiceArtifact {
  readonly characterId: string
  readonly characterGeneration: number
  readonly voiceIdentity: string
  readonly transcript: string
  readonly source: SpeechAudioSource
  readonly audioUri: string
}

export interface CharacterVoiceContext {
  readonly characterId: string
  readonly characterGeneration: number
  readonly voiceIdentity: string
}

export interface TextPresentationPort {
  show(presentation: SpeechPresentation): void
  hide(sessionId: string): void
  destroy(): void
}

export interface CharacterVoiceResolverPort {
  resolve(
    request: SpeakRequest,
    context: CharacterVoiceContext,
    signal: AbortSignal,
  ): Promise<CharacterVoiceArtifact | null>
  prepare?(): void | Promise<void>
  destroy?(): void | Promise<void>
}

export interface AudioPlaybackPort {
  play(
    artifact: CharacterVoiceArtifact,
    options: Readonly<{ volume: number }>,
    signal: AbortSignal,
  ): Promise<void>
  stop(reason: SpeechCancellationReason): void
  destroy(): void
}

export interface SpeechCoordinatorSnapshot {
  readonly activeSessionId: string | null
  readonly activeSource: SpeechSource | null
  readonly activePriority: number | null
  readonly activeAudioSource: SpeechAudioSource | null
  readonly queueDepth: number
  readonly paused: boolean
  readonly destroyed: boolean
  readonly voiceEnabled: boolean
  readonly voiceProgressStatus: VoiceProgressStatus
  readonly voiceProgressLog: readonly string[]
  readonly generation: number
  readonly lastError: string | null
}

export interface SpeechDiagnosticsPort {
  publish(snapshot: SpeechCoordinatorSnapshot): void
  reportError(sessionId: string, phase: string, error: unknown): void
}
