import { z } from 'zod'

export const PET_SETTINGS_STORAGE_KEY = 'ark-pet.settings.v7'
export const LEGACY_V6_PET_SETTINGS_STORAGE_KEY = 'ark-pet.settings.v6'
export const LEGACY_V5_PET_SETTINGS_STORAGE_KEY = 'ark-pet.settings.v5'
export const LEGACY_V4_PET_SETTINGS_STORAGE_KEY = 'ark-pet.settings.v4'
export const LEGACY_V3_PET_SETTINGS_STORAGE_KEY = 'ark-pet.settings.v3'
export const LEGACY_V2_PET_SETTINGS_STORAGE_KEY = 'ark-pet.settings.v2'
export const LEGACY_PET_SETTINGS_STORAGE_KEY = 'ark-pet.settings.v1'

const petSettingsSchema = z
  .object({
    scale: z.number().min(0.6).max(1.4),
    fps: z.union([z.literal(30), z.literal(60)]),
    alwaysOnTop: z.boolean(),
    showDebugPanel: z.boolean(),
    autonomousBehavior: z.boolean(),
    speechMode: z.enum(['off', 'text', 'character-voice']),
    characterVoiceVolume: z.number().min(0).max(1),
    characterVoiceFallback: z.enum(['exact-clip-only', 'cue-and-text-replacement']),
    personalityEnabled: z.boolean(),
    activeCharacterId: z.string().min(1).max(96),
    desktopAwarenessEnabled: z.boolean(),
    desktopAwarenessConsentVersion: z.number().int().positive().nullable(),
    contentPerceptionEnabled: z.boolean(),
    contentPerceptionConsentVersion: z.number().int().positive().nullable(),
    initiativeEnabled: z.boolean(),
    initiativeStyle: z.enum(['quiet', 'balanced', 'expressive']),
  })
  .strict()

const v6PetSettingsSchema = petSettingsSchema.omit({
  contentPerceptionEnabled: true, contentPerceptionConsentVersion: true,
  initiativeEnabled: true, initiativeStyle: true,
})
const v5PetSettingsSchema = v6PetSettingsSchema.omit({ desktopAwarenessEnabled: true, desktopAwarenessConsentVersion: true })
const v4PetSettingsSchema = v5PetSettingsSchema.omit({ activeCharacterId: true })
const v3PetSettingsSchema = v4PetSettingsSchema.omit({ personalityEnabled: true })
const v2PetSettingsSchema = v3PetSettingsSchema.omit({
  speechMode: true,
  characterVoiceVolume: true,
  characterVoiceFallback: true,
})
const legacyPetSettingsSchema = v2PetSettingsSchema.omit({ autonomousBehavior: true })

export type PetSettings = z.infer<typeof petSettingsSchema>

export const DEFAULT_PET_SETTINGS: PetSettings = Object.freeze({
  scale: 0.8,
  fps: 60,
  alwaysOnTop: true,
  showDebugPanel: import.meta.env.DEV,
  autonomousBehavior: true,
  speechMode: 'text',
  characterVoiceVolume: 0.8,
  characterVoiceFallback: 'cue-and-text-replacement',
  personalityEnabled: true,
  activeCharacterId: 'demo',
  desktopAwarenessEnabled: false,
  desktopAwarenessConsentVersion: null,
  contentPerceptionEnabled: false,
  contentPerceptionConsentVersion: null,
  initiativeEnabled: true,
  initiativeStyle: 'balanced',
})

export interface PetSettingsStore {
  getSnapshot: () => PetSettings
  subscribe: (listener: () => void) => () => void
  update: (partial: Partial<PetSettings>) => void
  reset: () => void
}

/** Pure migration entry point used by storage loading and unit tests. */
export function parsePetSettings(
  value: unknown,
  defaults: PetSettings = DEFAULT_PET_SETTINGS,
): PetSettings | null {
  const phase11Defaults = {
    contentPerceptionEnabled: false,
    contentPerceptionConsentVersion: null,
    initiativeEnabled: defaults.initiativeEnabled,
    initiativeStyle: defaults.initiativeStyle,
  } as const
  const current = petSettingsSchema.safeParse(value)
  if (current.success) return current.data

  const v6 = v6PetSettingsSchema.safeParse(value)
  if (v6.success) return {
    ...v6.data,
    ...phase11Defaults,
  }

  const v5 = v5PetSettingsSchema.safeParse(value)
  if (v5.success) return { ...v5.data, desktopAwarenessEnabled: false, desktopAwarenessConsentVersion: null, ...phase11Defaults }

  const v4 = v4PetSettingsSchema.safeParse(value)
  if (v4.success) return { ...v4.data, activeCharacterId: defaults.activeCharacterId, desktopAwarenessEnabled: false, desktopAwarenessConsentVersion: null, ...phase11Defaults }

  const v3 = v3PetSettingsSchema.safeParse(value)
  if (v3.success) return { ...v3.data, personalityEnabled: defaults.personalityEnabled, activeCharacterId: defaults.activeCharacterId, desktopAwarenessEnabled: false, desktopAwarenessConsentVersion: null, ...phase11Defaults }

  const v2 = v2PetSettingsSchema.safeParse(value)
  if (v2.success) {
    return {
      ...v2.data,
      speechMode: defaults.speechMode,
      characterVoiceVolume: defaults.characterVoiceVolume,
      characterVoiceFallback: defaults.characterVoiceFallback,
      personalityEnabled: defaults.personalityEnabled,
      activeCharacterId: defaults.activeCharacterId,
      desktopAwarenessEnabled: false,
      desktopAwarenessConsentVersion: null,
      ...phase11Defaults,
    }
  }

  const legacy = legacyPetSettingsSchema.safeParse(value)
  if (legacy.success) {
    return {
      ...legacy.data,
      autonomousBehavior: defaults.autonomousBehavior,
      speechMode: defaults.speechMode,
      characterVoiceVolume: defaults.characterVoiceVolume,
      characterVoiceFallback: defaults.characterVoiceFallback,
      personalityEnabled: defaults.personalityEnabled,
      activeCharacterId: defaults.activeCharacterId,
      desktopAwarenessEnabled: false,
      desktopAwarenessConsentVersion: null,
      ...phase11Defaults,
    }
  }

  return null
}

function parseStoredValue(raw: string | null) {
  if (!raw) return null
  try {
    return parsePetSettings(JSON.parse(raw))
  } catch {
    return null
  }
}

function loadSettings(): PetSettings {
  try {
    const currentRaw = window.localStorage.getItem(PET_SETTINGS_STORAGE_KEY)
    const v6Raw = window.localStorage.getItem(LEGACY_V6_PET_SETTINGS_STORAGE_KEY)
    const v5Raw = window.localStorage.getItem(LEGACY_V5_PET_SETTINGS_STORAGE_KEY)
    const v4Raw = window.localStorage.getItem(LEGACY_V4_PET_SETTINGS_STORAGE_KEY)
    const v3Raw = window.localStorage.getItem(LEGACY_V3_PET_SETTINGS_STORAGE_KEY)
    const v2Raw = window.localStorage.getItem(LEGACY_V2_PET_SETTINGS_STORAGE_KEY)
    const legacyRaw = window.localStorage.getItem(LEGACY_PET_SETTINGS_STORAGE_KEY)
    if (!currentRaw && !v6Raw && !v5Raw && !v4Raw && !v3Raw && !v2Raw && !legacyRaw) return DEFAULT_PET_SETTINGS

    const current = parseStoredValue(currentRaw)
    if (current) return current

    const migrated = parseStoredValue(v6Raw) ?? parseStoredValue(v5Raw) ?? parseStoredValue(v4Raw) ?? parseStoredValue(v3Raw) ?? parseStoredValue(v2Raw) ?? parseStoredValue(legacyRaw)
    if (migrated) {
      window.localStorage.setItem(PET_SETTINGS_STORAGE_KEY, JSON.stringify(migrated))
      return migrated
    }

    console.warn('[PetSettings] Invalid persisted settings; using defaults')
  } catch (error) {
    console.warn('[PetSettings] Could not read persisted settings; using defaults', error)
  }

  return DEFAULT_PET_SETTINGS
}

export function createPetSettingsStore(): PetSettingsStore {
  let snapshot = loadSettings()
  const listeners = new Set<() => void>()

  const commit = (next: PetSettings) => {
    snapshot = next
    try {
      window.localStorage.setItem(PET_SETTINGS_STORAGE_KEY, JSON.stringify(next))
    } catch (error) {
      console.warn('[PetSettings] Could not persist settings', error)
    }
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(partial) {
      const result = petSettingsSchema.safeParse({ ...snapshot, ...partial })
      if (result.success) commit(result.data)
    },
    reset() {
      commit({ ...DEFAULT_PET_SETTINGS })
    },
  }
}
