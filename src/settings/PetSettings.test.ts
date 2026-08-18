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
    const current = { ...DEFAULT_PET_SETTINGS, ...legacySettings, autonomousBehavior: false }
    expect(parsePetSettings(current)).toEqual(current)
  })

  it('migrates legacy settings without losing values', () => {
    expect(parsePetSettings(legacySettings)).toEqual({
      ...legacySettings,
      autonomousBehavior: DEFAULT_PET_SETTINGS.autonomousBehavior,
      speechMode: DEFAULT_PET_SETTINGS.speechMode,
      characterVoiceVolume: DEFAULT_PET_SETTINGS.characterVoiceVolume,
      characterVoiceFallback: DEFAULT_PET_SETTINGS.characterVoiceFallback,
      personalityEnabled: DEFAULT_PET_SETTINGS.personalityEnabled,
    })
  })

  it('migrates v2 settings to v3 speech defaults', () => {
    const v2 = { ...legacySettings, autonomousBehavior: false }
    expect(parsePetSettings(v2)).toEqual({
      ...v2,
      speechMode: DEFAULT_PET_SETTINGS.speechMode,
      characterVoiceVolume: DEFAULT_PET_SETTINGS.characterVoiceVolume,
      characterVoiceFallback: DEFAULT_PET_SETTINGS.characterVoiceFallback,
      personalityEnabled: DEFAULT_PET_SETTINGS.personalityEnabled,
    })
  })

  it('migrates Phase 7 v3 settings to the personality default', () => {
    const { personalityEnabled: _removed, ...v3 } = DEFAULT_PET_SETTINGS
    expect(parsePetSettings(v3)).toEqual({ ...v3, personalityEnabled: true })
  })

  it('rejects corrupt, incomplete, and unknown settings', () => {
    expect(parsePetSettings('{bad json')).toBeNull()
    expect(parsePetSettings({ scale: 1 })).toBeNull()
    expect(parsePetSettings({ ...legacySettings, unexpected: true })).toBeNull()
  })
})
