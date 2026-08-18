import type { PersonaReaction } from '../reaction/types'

export interface CharacterPersona {
  readonly version: 1
  readonly characterId: string
  readonly displayName: string
  readonly metadata?: Readonly<Record<string, string>>
  readonly reactions: readonly PersonaReaction[]
}
