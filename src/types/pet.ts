import type { CharacterManifestWithPaths, PetState } from './character'
import type { AmbientSchedulerStatus } from '../pet/behavior/ambient/AmbientScheduler'
import type { SpeechAudioSource } from '../pet/speech/types'
import type { ContextEvent, LocalTimePeriod } from '../pet/reaction/types'

export interface WindowPoint {
  x: number
  y: number
}

export interface DebugSnapshot {
  fps: number
  petState: PetState
  currentAnimation: string | null
  windowPosition: WindowPoint | null
  pointerPosition: WindowPoint | null
  hitTest: boolean
  mousePassthrough: boolean
  characterId: string | null
  rendererStatus: 'idle' | 'ready' | 'error'
  characterManifest: CharacterManifestWithPaths | null
  activeBehavior: string | null
  lastBehaviorError: string | null
  ambientSchedulerStatus: AmbientSchedulerStatus
  nextAmbientActionAt: number | null
  activeRuntimeCommand: string | null
  runtimeCommandQueueDepth: number
  lastRuntimeCommandError: string | null
  activeSpeechSession: string | null
  speechQueueDepth: number
  speechAudioSource: SpeechAudioSource | null
  speechVoiceEnabled: boolean
  lastSpeechError: string | null
  lastContextEvent: ContextEvent | null
  selectedReactionId: string | null
  activeReactionId: string | null
  reactionState: 'idle' | 'running' | 'blocked' | 'disabled' | 'destroyed'
  reactionBlockedReason: string | null
  currentLocalTimePeriod: LocalTimePeriod | null
  lastReactionError: string | null
  lastError: string | null
}

export interface DebugStore {
  getSnapshot(): DebugSnapshot
  subscribe(listener: () => void): () => void
  patch(partial: Partial<DebugSnapshot>): void
}
