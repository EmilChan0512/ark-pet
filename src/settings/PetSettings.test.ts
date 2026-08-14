import { describe, expect, it } from 'vitest'
import { DEFAULT_PET_SETTINGS, parsePetSettings } from './PetSettings'

const legacySettings = {
  scale: 1.2,
  fps: 30 as const,
  alwaysOnTop: false,
  showDebugPanel: false,
}

describe('parsePetSettings', () => {
  it('preserves current settings', () => {
    const current = { ...legacySettings, autonomousBehavior: false }
    expect(parsePetSettings(current)).toEqual(current)
  })

  it('migrates legacy settings without losing values', () => {
    expect(parsePetSettings(legacySettings)).toEqual({
      ...legacySettings,
      autonomousBehavior: DEFAULT_PET_SETTINGS.autonomousBehavior,
    })
  })

  it('rejects corrupt, incomplete, and unknown settings', () => {
    expect(parsePetSettings('{bad json')).toBeNull()
    expect(parsePetSettings({ scale: 1 })).toBeNull()
    expect(parsePetSettings({ ...legacySettings, unexpected: true })).toBeNull()
  })
})
