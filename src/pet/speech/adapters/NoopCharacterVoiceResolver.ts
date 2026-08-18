import type {
  CharacterVoiceContext,
  CharacterVoiceResolverPort,
  SpeakRequest,
} from '../types'

/** Safe fallback used when the validated Pepe voice package is unavailable. */
export class NoopCharacterVoiceResolver implements CharacterVoiceResolverPort {
  async resolve(
    _request: SpeakRequest,
    _context: CharacterVoiceContext,
    _signal: AbortSignal,
  ) {
    return null
  }
}
