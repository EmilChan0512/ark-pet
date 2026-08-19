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

  it('accepts public desktop categories and rejects raw identity metadata', () => {
    const base = {
      version: 1, characterId: 'demo', displayName: 'Pepe',
      reactions: [{
        id: 'desktop-dev', event: 'desktop.activity-category-entered', priority: 10,
        conditions: [{ type: 'desktop-category', value: 'development' }],
        plan: [{ type: 'speak', text: 'Work time', source: 'ambient' }],
      }],
    }
    expect(parseCharacterPersona(base).reactions[0]?.id).toBe('desktop-dev')
    const unsafe = structuredClone(base)
    Object.assign(unsafe.reactions[0]!.conditions[0]!, { processName: 'code.exe' })
    expect(() => parseCharacterPersona(unsafe)).toThrow('Character Persona Error')
  })
})
