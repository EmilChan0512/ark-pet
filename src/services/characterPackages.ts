import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { CharacterCatalogEntry } from '../types/character'

export interface InstalledCharacterRecord {
  readonly packageId: string
  readonly packageVersion: string
  readonly characterId: string
  readonly displayName: string
  readonly author: string | null
  readonly description: string | null
  readonly contentDigest: string
  readonly archiveDigest: string
  readonly installedSize: number
  readonly installGeneration: number
  readonly resourceRoot: string
  readonly characterManifest: string
  readonly persona: string
  readonly preview: string | null
}

export interface PackageInspection {
  readonly inspectionToken: string
  readonly packageId: string
  readonly packageVersion: string
  readonly characterId: string
  readonly displayName: string
  readonly author: string | null
  readonly description: string | null
  readonly license: string | null
  readonly homepage: string | null
  readonly installedSize: number
  readonly archiveDigest: string
  readonly contentDigest: string
  readonly preview: string | null
  readonly previewDataUrl: string | null
  readonly capabilities: readonly string[]
  readonly warnings: readonly string[]
  readonly updateKind: 'new' | 'identical' | 'upgrade' | 'conflict'
}

export interface CharacterPackageFailure { readonly code: string; readonly message: string }

function resourcePath(root: string, relative: string) {
  const separator = root.includes('\\') ? '\\' : '/'
  return convertFileSrc(`${root}${separator}${relative.replaceAll('/', separator)}`)
}

export function builtInCharacter(): CharacterCatalogEntry {
  return {
    id: 'demo', displayName: '佩佩', source: 'built-in', packageId: null, packageVersion: null,
    manifestPath: '/characters/demo/manifest.json', personaPath: '/characters/demo/persona.json',
  }
}

export function installedToCatalog(record: InstalledCharacterRecord): CharacterCatalogEntry {
  return {
    id: record.characterId,
    displayName: record.displayName,
    source: 'installed',
    packageId: record.packageId,
    packageVersion: record.packageVersion,
    author: record.author ?? undefined,
    description: record.description ?? undefined,
    manifestPath: resourcePath(record.resourceRoot, record.characterManifest),
    personaPath: resourcePath(record.resourceRoot, record.persona),
    previewPath: record.preview ? resourcePath(record.resourceRoot, record.preview) : undefined,
  }
}

export class CharacterPackageService {
  async cleanupStaging() { return isTauri() ? invoke<number>('cleanup_character_staging') : 0 }
  async listInstalled(): Promise<InstalledCharacterRecord[]> {
    return isTauri() ? invoke<InstalledCharacterRecord[]>('list_installed_characters') : []
  }
  async loadCatalog(): Promise<CharacterCatalogEntry[]> {
    const installed = await this.listInstalled()
    return [builtInCharacter(), ...installed.map(installedToCatalog)]
  }
  async chooseAndInspect(): Promise<PackageInspection | null> {
    if (!isTauri()) return null
    const selected = await open({ multiple: false, directory: false, filters: [{ name: 'Ark Pet Character Package', extensions: ['arkpet'] }] })
    if (!selected) return null
    return invoke<PackageInspection>('inspect_character_package', { path: selected })
  }
  install(inspectionToken: string) {
    return invoke<InstalledCharacterRecord>('install_character_package', { inspectionToken })
  }
  remove(packageId: string) { return invoke<void>('remove_character_package', { packageId }) }
}
