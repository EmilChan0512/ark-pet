import { invoke, isTauri } from '@tauri-apps/api/core'
import type { CharacterVoiceArtifact } from '../pet/speech/types'

export interface VoiceCapabilities {
  readonly configured: boolean
  readonly originalClipsAvailable: boolean
  readonly aiAvailable: boolean
  readonly characterId: string | null
  readonly voiceIdentity: string | null
  readonly locale: string | null
  readonly reason: string | null
}

export interface OriginalVoiceClipRequest {
  readonly cue: string
  readonly locale: string
  readonly characterId: string
  readonly voiceIdentity: string
  readonly characterGeneration: number
}

export interface CharacterVoiceSynthesisRequest extends OriginalVoiceClipRequest {
  readonly requestId: string
  readonly text: string
}

export interface CharacterVoiceService {
  getCapabilities(): Promise<VoiceCapabilities>
  resolveOriginalClip(
    request: OriginalVoiceClipRequest,
  ): Promise<CharacterVoiceArtifact | null>
  synthesize(request: CharacterVoiceSynthesisRequest): Promise<CharacterVoiceArtifact>
  prepare(): Promise<void>
  cancel(requestId: string): Promise<void>
  shutdown(): Promise<void>
}

/** Tauri IPC boundary; callers never provide a filesystem path. */
export class TauriCharacterVoiceService implements CharacterVoiceService {
  async getCapabilities(): Promise<VoiceCapabilities> {
    if (!isTauri()) {
      return {
        configured: false,
        originalClipsAvailable: false,
        aiAvailable: false,
        characterId: null,
        voiceIdentity: null,
        locale: null,
        reason: 'Tauri runtime is unavailable',
      }
    }
    return invoke<VoiceCapabilities>('get_voice_capabilities')
  }

  async resolveOriginalClip(request: OriginalVoiceClipRequest) {
    if (!isTauri()) return null
    return invoke<CharacterVoiceArtifact | null>('resolve_original_voice_clip', {
      ...request,
    })
  }

  async synthesize(request: CharacterVoiceSynthesisRequest) {
    if (!isTauri()) throw new Error('Tauri runtime is unavailable')
    return invoke<CharacterVoiceArtifact>('synthesize_character_voice', {
      ...request,
    })
  }

  async prepare() {
    if (!isTauri()) return
    await invoke('warm_character_voice')
  }

  async cancel(requestId: string) {
    if (!isTauri()) return
    await invoke('cancel_character_voice', { requestId })
  }

  async shutdown() {
    if (!isTauri()) return
    await invoke('shutdown_character_voice')
  }
}
