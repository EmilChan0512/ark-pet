import { describe, expect, it } from 'vitest'
import { parseCharacterPersona } from './CharacterPersonaLoader'

describe('CharacterPersonaLoader', () => {
  it('loads a valid persona', () => {
    const persona = parseCharacterPersona({
      version: 1, characterId: 'demo', displayName: 'Pepe',
      reactions: [{ id: 'click', event: 'pet.clicked', priority: 200, plan: [{ type: 'speak', text: 'Hi', source: 'interaction' }] }],
    })
    expect(persona.characterId).toBe('demo')
  })

  it('reports malformed and duplicate data clearly', () => {
    expect(() => parseCharacterPersona({ version: 2 })).toThrow('Character Persona Error')
    const reaction = { id: 'same', event: 'pet.clicked', priority: 1, plan: [{ type: 'wait', durationMs: 1 }] }
    expect(() => parseCharacterPersona({ version: 1, characterId: 'x', displayName: 'x', reactions: [reaction, reaction] })).toThrow('duplicate reaction id')
  })
})
