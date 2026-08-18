import { describe, expect, it } from 'vitest'
import { atlasTexturePages, resolveAtlasTexturePath } from './SpineCharacter'

describe('atlasTexturePages', () => {
  it('extracts every PNG and WebP page without treating regions as pages', () => {
    const atlas = [
      'first page.png',
      'size: 64,64',
      'region',
      '  rotate: false',
      '',
      'nested/second.webp',
      'size: 128,128',
    ].join('\n')

    expect(atlasTexturePages(atlas)).toEqual(['first page.png', 'nested/second.webp'])
  })

  it('resolves encoded pages against Tauri asset paths without requiring a valid URL base', () => {
    expect(resolveAtlasTexturePath('http://asset.localhost/C%3A/package/character', 'skins/first page.png'))
      .toBe('http://asset.localhost/C%3A/package/character/skins/first%20page.png')
    expect(resolveAtlasTexturePath('asset://localhost/C%3A/package/character/', 'texture.png'))
      .toBe('asset://localhost/C%3A/package/character/texture.png')
    expect(resolveAtlasTexturePath('http://asset.localhost/C:%5Cpackage%5Ccharacter', 'skins/first page.png'))
      .toBe('http://asset.localhost/C:%5Cpackage%5Ccharacter%5Cskins%5Cfirst%20page.png')
  })
})
