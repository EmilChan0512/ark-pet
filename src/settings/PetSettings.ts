import { z } from 'zod'

export const PET_SETTINGS_STORAGE_KEY = 'ark-pet.settings.v1'

const petSettingsSchema = z
  .object({
    scale: z.number().min(0.6).max(1.4),
    fps: z.union([z.literal(30), z.literal(60)]),
    alwaysOnTop: z.boolean(),
    showDebugPanel: z.boolean(),
  })
  .strict()

export type PetSettings = z.infer<typeof petSettingsSchema>

export const DEFAULT_PET_SETTINGS: PetSettings = Object.freeze({
  scale: 1,
  fps: 60,
  alwaysOnTop: true,
  showDebugPanel: import.meta.env.DEV,
})

export interface PetSettingsStore {
  getSnapshot: () => PetSettings
  subscribe: (listener: () => void) => () => void
  update: (partial: Partial<PetSettings>) => void
  reset: () => void
}

function loadSettings(): PetSettings {
  try {
    const stored = window.localStorage.getItem(PET_SETTINGS_STORAGE_KEY)
    if (!stored) return DEFAULT_PET_SETTINGS

    const result = petSettingsSchema.safeParse(JSON.parse(stored))
    if (result.success) return result.data

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
