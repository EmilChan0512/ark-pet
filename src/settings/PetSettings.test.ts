import { describe, expect, it } from 'vitest'
import { DEFAULT_PET_SETTINGS, parsePetSettings } from './PetSettings'

const legacySettings = {
  scale: 1.2,
  fps: 30 as const,
  alwaysOnTop: false,
  showDebugPanel: false,
}

const phase11Defaults = {
  contentPerceptionEnabled: false,
  contentPerceptionConsentVersion: null,
  initiativeEnabled: DEFAULT_PET_SETTINGS.initiativeEnabled,
  initiativeStyle: DEFAULT_PET_SETTINGS.initiativeStyle,
} as const

function withoutPhase11() {
  const {
    contentPerceptionEnabled: _content,
    contentPerceptionConsentVersion: _contentConsent,
    initiativeEnabled: _initiative,
    initiativeStyle: _initiativeStyle,
    ...settings
  } = DEFAULT_PET_SETTINGS
  return settings
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
      activeCharacterId: DEFAULT_PET_SETTINGS.activeCharacterId,
      desktopAwarenessEnabled: false,
      desktopAwarenessConsentVersion: null,
      ...phase11Defaults,
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
      activeCharacterId: DEFAULT_PET_SETTINGS.activeCharacterId,
      desktopAwarenessEnabled: false,
      desktopAwarenessConsentVersion: null,
      ...phase11Defaults,
    })
  })

  it('migrates Phase 7 v3 settings to the personality default', () => {
    const { personalityEnabled: _personality, activeCharacterId: _character, desktopAwarenessEnabled: _awareness, desktopAwarenessConsentVersion: _consent, ...v3 } = withoutPhase11()
    expect(parsePetSettings(v3)).toEqual({ ...v3, personalityEnabled: true, activeCharacterId: 'demo', desktopAwarenessEnabled: false, desktopAwarenessConsentVersion: null, ...phase11Defaults })
  })

  it('migrates Phase 8 v4 settings to the built-in character', () => {
    const { activeCharacterId: _removed, desktopAwarenessEnabled: _awareness, desktopAwarenessConsentVersion: _consent, ...v4 } = withoutPhase11()
    expect(parsePetSettings(v4)).toEqual({ ...v4, activeCharacterId: 'demo', desktopAwarenessEnabled: false, desktopAwarenessConsentVersion: null, ...phase11Defaults })
  })

  it('migrates Phase 9 v5 with awareness safely disabled', () => {
    const { desktopAwarenessEnabled: _enabled, desktopAwarenessConsentVersion: _consent, ...v5 } = withoutPhase11()
    expect(parsePetSettings(v5)).toEqual({ ...v5, desktopAwarenessEnabled: false, desktopAwarenessConsentVersion: null, ...phase11Defaults })
  })

  it('migrates Phase 10 v6 with content perception off by default', () => {
    const v6 = withoutPhase11()
    expect(parsePetSettings(v6)).toEqual({ ...v6, ...phase11Defaults })
  })

  it('rejects corrupt, incomplete, and unknown settings', () => {
    expect(parsePetSettings('{bad json')).toBeNull()
    expect(parsePetSettings({ scale: 1 })).toBeNull()
    expect(parsePetSettings({ ...legacySettings, unexpected: true })).toBeNull()
  })
})
