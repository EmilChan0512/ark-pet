import type { Container } from 'pixi.js'
import type {
  CharacterCatalogEntry,
  CharacterManifestWithPaths,
} from '../../types/character'
import {
  loadAndValidateManifest,
  loadCharacterCatalog,
} from './CharacterManifest'
import { SpineCharacter } from './SpineCharacter'

export class CharacterManager {
  private catalog: CharacterCatalogEntry[] = []
  private currentManifest: CharacterManifestWithPaths | null = null
  private currentCharacter: SpineCharacter | null = null

  async init() {
    this.catalog = await loadCharacterCatalog()
    return this.catalog
  }

  getCatalog() {
    return this.catalog
  }

  getCurrentManifest() {
    return this.currentManifest
  }

  getCurrentCharacter() {
    return this.currentCharacter
  }

  async loadCharacter(characterId: string, parent: Container) {
    const entry = this.catalog.find((item) => item.id === characterId)
    if (!entry) {
      throw new Error(`Character not found: ${characterId}`)
    }

    const manifest = await loadAndValidateManifest(entry.manifestPath)

    this.currentCharacter?.destroy()
    this.currentCharacter = null
    this.currentManifest = manifest

    const character = new SpineCharacter()
    const view = await character.load(manifest)
    parent.addChild(view)

    this.currentCharacter = character
    return character
  }

  destroy() {
    this.currentCharacter?.destroy()
    this.currentCharacter = null
    this.currentManifest = null
  }
}
