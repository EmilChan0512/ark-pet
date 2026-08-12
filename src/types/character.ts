export type PetState = 'loading' | 'idle' | 'interacting' | 'dragging' | 'error'

export interface CharacterAnimationMap {
  idle: string
  interact?: string
  drag?: string
}

export interface CharacterManifest {
  id: string
  name: string
  skeleton: string
  atlas: string
  scale: number
  spineVersion?: string
  defaultSkin?: string
  animations: CharacterAnimationMap
}

export interface CharacterManifestWithPaths extends CharacterManifest {
  basePath: string
  skeletonPath: string
  atlasPath: string
}

export interface CharacterCatalogEntry {
  id: string
  manifestPath: string
}
