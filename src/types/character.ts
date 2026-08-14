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
