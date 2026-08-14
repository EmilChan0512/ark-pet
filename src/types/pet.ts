import type { CharacterManifestWithPaths, PetState } from './character'

export interface WindowPoint {
  x: number
  y: number
}

export interface DebugSnapshot {
  fps: number
  petState: PetState
  currentAnimation: string | null
  windowPosition: WindowPoint | null
  pointerPosition: WindowPoint | null
  hitTest: boolean
  mousePassthrough: boolean
  characterId: string | null
  rendererStatus: 'idle' | 'ready' | 'error'
  characterManifest: CharacterManifestWithPaths | null
  activeBehavior: string | null
  lastBehaviorError: string | null
  lastError: string | null
}

export interface DebugStore {
  getSnapshot(): DebugSnapshot
  subscribe(listener: () => void): () => void
  patch(partial: Partial<DebugSnapshot>): void
}
