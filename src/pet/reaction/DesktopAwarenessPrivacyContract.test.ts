import { describe, expect, it } from 'vitest'
import { DEFAULT_PET_SETTINGS } from '../../settings/PetSettings'
import { parseCharacterPersona } from '../persona/CharacterPersonaLoader'
import appSource from '../../app/App.tsx?raw'
import personaJson from '../../../public/characters/demo/persona.json?raw'
import nativeSource from '../../../src-tauri/src/desktop_awareness.rs?raw'

describe('Phase 10 privacy acceptance contract', () => {
  it('upgrades and resets with awareness disabled and stores no activity state', () => {
    expect(DEFAULT_PET_SETTINGS.desktopAwarenessEnabled).toBe(false)
    expect(DEFAULT_PET_SETTINGS.desktopAwarenessConsentVersion).toBeNull()
    const persisted = JSON.stringify(DEFAULT_PET_SETTINGS)
    expect(persisted).not.toMatch(/category|idleBucket|sessionState|history|timeline/i)
  })

  it('built-in persona uses only the frozen public desktop vocabulary', () => {
    const raw = JSON.parse(personaJson)
    const persona = parseCharacterPersona(raw)
    const desktopRules = persona.reactions.filter((reaction) => reaction.event.startsWith('desktop.'))
    expect(desktopRules.length).toBeGreaterThanOrEqual(4)
    expect(JSON.stringify(desktopRules)).not.toMatch(/process|executable|bundle|path|window|title|url|identity/i)
  })

  it('Tauri exposes no generic desktop inspection command', () => {
    const commandNames = [...nativeSource.matchAll(/#\[tauri::command\]\s+pub fn ([a-z0-9_]+)/g)].map((match) => match[1])
    expect(commandNames).toEqual(['start_desktop_awareness', 'stop_desktop_awareness'])
    expect(commandNames.join(' ')).not.toMatch(/process|window|title|path|screen|clipboard|input|url|list/i)
  })

  it('ships complete disclosure and immediate disable controls', () => {
    for (const requiredCopy of [
      'system idle duration', 'lock/unlock state', 'broad local category',
      'keyboard input', 'clipboard data', 'Raw application identity',
      'Disable immediately', 'Not now',
    ]) expect(appSource).toContain(requiredCopy)
  })
})
