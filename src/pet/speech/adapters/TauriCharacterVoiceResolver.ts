import type { CharacterVoiceService } from '../../../services/speech'
import { TauriCharacterVoiceService } from '../../../services/speech'
import type { PetSettings } from '../../../settings/PetSettings'
import type {
  CharacterVoiceContext,
  CharacterVoiceResolverPort,
  SpeakRequest,
} from '../types'

function comparableText(text: string) {
  return text.replace(/\s+/g, '').replace(/[，。！？、,.!?…]/g, '')
}

/**
 * Resolves only artifacts whose identity is pinned by the active character.
 * Registered cues prefer verified original clips; cue-less text is synthesized
 * by the pinned local character model. Any unavailable path returns or throws
 * into the coordinator's text-only safety boundary.
 */
export class TauriCharacterVoiceResolver implements CharacterVoiceResolverPort {
  private readonly service: CharacterVoiceService
  private readonly getFallbackPolicy: () => PetSettings['characterVoiceFallback']

  constructor(
    getFallbackPolicy: () => PetSettings['characterVoiceFallback'],
    service: CharacterVoiceService = new TauriCharacterVoiceService(),
  ) {
    this.getFallbackPolicy = getFallbackPolicy
    this.service = service
  }

  async resolve(
    request: SpeakRequest,
    context: CharacterVoiceContext,
    signal: AbortSignal,
  ) {
    if (signal.aborted) return null
    const baseRequest = {
      cue: request.cue ?? '',
      locale: request.locale ?? 'zh-CN',
      characterId: context.characterId,
      voiceIdentity: context.voiceIdentity,
      characterGeneration: context.characterGeneration,
    }
    if (!request.cue) {
      const handleAbort = () => {
        void this.service.cancel(request.id)
      }
      signal.addEventListener('abort', handleAbort, { once: true })
      try {
        return await this.service.synthesize({
          ...baseRequest,
          requestId: request.id,
          text: request.text,
        })
      } finally {
        signal.removeEventListener('abort', handleAbort)
      }
    }
    const artifact = await this.service.resolveOriginalClip(baseRequest)
    if (!artifact || signal.aborted) return null
    if (
      this.getFallbackPolicy() === 'exact-clip-only' &&
      comparableText(artifact.transcript) !== comparableText(request.text)
    ) {
      return null
    }
    return artifact
  }

  prepare() {
    return this.service.prepare()
  }

  destroy() {
    return this.service.shutdown()
  }
}
