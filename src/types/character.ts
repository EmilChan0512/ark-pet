export type PetState =
  | 'loading'
  | 'idle'
  | 'interacting'
  | 'dragging'
  | 'walking'
  | 'sitting'
  | 'sleeping'
  | 'error'
export type FacingDirection = 'left' | 'right'

export interface CharacterAnimationMap {
  idle: string
  interact?: string
  drag?: string
  walk?: string
  sit?: string
  sleep?: string
}

export interface CharacterManifest {
  id: string
  name: string
  skeleton: string
  atlas: string
  scale: number
  nativeFacing?: FacingDirection
  spineVersion?: string
  defaultSkin?: string
  animations: CharacterAnimationMap
  voice?: CharacterVoiceProfile
}

export interface CharacterVoiceProfile {
  characterId: string
  voiceIdentity: string
  locale: string
}

export interface CharacterManifestWithPaths extends CharacterManifest {
  basePath: string
  skeletonPath: string
  atlasPath: string
}

export interface CharacterCatalogEntry {
  id: string
  displayName: string
  manifestPath: string
  personaPath: string
  source: 'built-in' | 'installed'
  packageId: string | null
  packageVersion: string | null
  author?: string
  description?: string
  previewPath?: string
}
