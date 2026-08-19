import { describe, expect, it } from 'vitest'
import { characterAssetBasePath, resolveCharacterAssetPath } from './CharacterManifest'

describe('character asset paths', () => {
  it('preserves Tauri Windows encoded separators for sibling assets', () => {
    const manifest = 'http://asset.localhost/C:%5CUsers%5CAlice%5Ccharacter%5Cmanifest.json'
    const base = characterAssetBasePath(manifest)

    expect(base).toBe('http://asset.localhost/C:%5CUsers%5CAlice%5Ccharacter')
    expect(resolveCharacterAssetPath(base, 'textures/pepe atlas.png'))
      .toBe('http://asset.localhost/C:%5CUsers%5CAlice%5Ccharacter%5Ctextures%5Cpepe%20atlas.png')
  })

  it('keeps regular web paths slash-separated', () => {
    const base = characterAssetBasePath('/characters/demo/manifest.json')
    expect(resolveCharacterAssetPath(base, 'texture.png')).toBe('/characters/demo/texture.png')
  })
})
