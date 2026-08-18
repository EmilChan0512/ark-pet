import type { Container } from 'pixi.js'
import type {
  CharacterCatalogEntry,
  CharacterManifestWithPaths,
} from '../../types/character'
import { loadAndValidateManifest } from './CharacterManifest'
import { SpineCharacter } from './SpineCharacter'

export class CharacterManager {
  private catalog: CharacterCatalogEntry[] = []
  private currentManifest: CharacterManifestWithPaths | null = null
  private currentCharacter: SpineCharacter | null = null

  async init(catalog: CharacterCatalogEntry[]) {
    this.catalog = [...catalog]
    return this.catalog
  }

  setCatalog(catalog: CharacterCatalogEntry[]) { this.catalog = [...catalog] }

  getCatalog() {
    return this.catalog
  }

  getCurrentManifest() {
    return this.currentManifest
  }

  getCurrentCharacter() {
    return this.currentCharacter
  }

  getEntry(characterId: string) {
    return this.catalog.find((item) => item.id === characterId) ?? null
  }

  getCurrentEntry() {
    return this.currentManifest ? this.catalog.find((item) => item.id === this.currentManifest?.id) ?? null : null
  }

  async loadCharacter(
    characterId: string,
    parent: Container,
    reportProgress: (message: string) => void = () => {},
  ) {
    const entry = this.getEntry(characterId)
    if (!entry) {
      throw new Error(`Character not found: ${characterId}`)
    }

    reportProgress('Loading character manifest')
    const manifest = await loadAndValidateManifest(entry.manifestPath)
    reportProgress('Character manifest validated')

    const character = new SpineCharacter()
    try {
      const view = await character.load(manifest, reportProgress)
      parent.addChild(view)
    } catch (error) {
      character.destroy()
      throw error
    }

    this.currentCharacter?.destroy()
    this.currentCharacter = character
    this.currentManifest = manifest
    return character
  }

  destroy() {
    this.currentCharacter?.destroy()
    this.currentCharacter = null
    this.currentManifest = null
  }
}
