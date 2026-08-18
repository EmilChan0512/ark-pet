import { Assets, type BaseTexture, type Texture } from 'pixi.js'
import {
  Spine,
  TextureAtlas,
  type SkeletonData,
  type TrackEntry,
} from '@pixi-spine/all-3.8'
import type { CharacterManifestWithPaths, FacingDirection } from '../../types/character'
import { resolveCharacterAssetPath } from './CharacterManifest'

const SPINE_RUNTIME_VERSION = '3.8'
const ASSET_LOAD_TIMEOUT_MS = 10_000

type AnimationCompleteListener = (animationName: string | null) => void

function runtimeMajorMinor(version: string) {
  return version.split('.').slice(0, 2).join('.')
}

export function atlasTexturePages(atlas: string) {
  return atlas
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const lower = line.toLowerCase()
      return !line.includes(':') && (lower.endsWith('.png') || lower.endsWith('.webp'))
    })
}

export function resolveAtlasTexturePath(basePath: string, page: string) {
  return resolveCharacterAssetPath(basePath, page)
}

async function withTimeout<T>(promise: Promise<T>, description: string): Promise<T> {
  let timeoutId: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error(`${description} timed out after ${ASSET_LOAD_TIMEOUT_MS / 1000}s`)),
          ASSET_LOAD_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  }
}

async function fetchAsset(url: string, description: string) {
  const response = await withTimeout(fetch(url), description)
  if (!response.ok) {
    throw new Error(`${description} failed: ${response.status} ${response.statusText} (${url})`)
  }
  return response
}

export class SpineCharacter {
  private static assetSequence = 0
  private manifest: CharacterManifestWithPaths | null = null
  private skeletonData: SkeletonData | null = null
  private spine: Spine | null = null
  private readonly completeListeners = new Set<AnimationCompleteListener>()
  private assetAliases: { skeleton: string; textures: string[] } | null = null
  private textureObjectUrls: string[] = []
  private scale = 1
  private facing: FacingDirection = 'right'

  async load(
    manifest: CharacterManifestWithPaths,
    reportProgress: (message: string) => void = () => {},
  ) {
    this.manifest = manifest
    this.facing = manifest.nativeFacing ?? 'right'

    reportProgress('Checking Spine runtime compatibility')
    const exportedVersion = await this.detectExportedVersion(manifest)
    this.assertRuntimeCompatibility(manifest, exportedVersion)

    reportProgress('Loading Spine atlas')
    const atlasResponse = await fetchAsset(manifest.atlasPath, 'Spine atlas request')
    const atlas = await atlasResponse.text()
    const pages = atlasTexturePages(atlas)
    if (pages.length === 0) throw new Error('Spine atlas declares no texture pages')

    const images: Record<string, BaseTexture> = {}
    const assetAliases = {
      skeleton: `${manifest.id}-skeleton-${SpineCharacter.assetSequence++}`,
      textures: [] as string[],
    }
    this.assetAliases = assetAliases
    for (const [index, page] of pages.entries()) {
      reportProgress(`Loading texture ${index + 1}/${pages.length}: ${page}`)
      const textureUrl = resolveAtlasTexturePath(manifest.basePath, page)
      const textureResponse = await fetchAsset(textureUrl, `Texture request (${page})`)
      const objectUrl = URL.createObjectURL(await textureResponse.blob())
      this.textureObjectUrls.push(objectUrl)
      const alias = `${manifest.id}-texture-${SpineCharacter.assetSequence++}`
      assetAliases.textures.push(alias)
      Assets.add({
        alias,
        src: objectUrl,
        format: page.slice(page.lastIndexOf('.') + 1).toLowerCase(),
        loadParser: 'loadTextures',
      })
      const loadedTexture = await withTimeout(
        Assets.load<Texture | BaseTexture>(alias),
        `Texture decode (${page})`,
      )
      if (!loadedTexture) throw new Error(`Texture decode (${page}) returned no texture`)
      images[page] = 'baseTexture' in loadedTexture
        ? loadedTexture.baseTexture
        : loadedTexture
    }

    reportProgress('Building Spine texture atlas')
    let textureAtlas!: TextureAtlas
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        textureAtlas = new TextureAtlas(
          atlas,
          (page, loaded) => loaded(images[page] ?? null),
          (result) => {
            if (result) resolve()
            else reject(new Error('Spine texture atlas could not bind its texture pages'))
          },
        )
      }),
      'Spine texture atlas build',
    )

    Assets.add({
      alias: assetAliases.skeleton,
      src: manifest.skeletonPath,
      data: {
        spineAtlas: textureAtlas,
      },
    })

    reportProgress('Parsing Spine skeleton')
    const resource = (await withTimeout(
      Assets.load(assetAliases.skeleton),
      'Spine skeleton parse',
    )) as {
      spineData?: SkeletonData
    }

    if (!resource?.spineData) {
      throw new Error(
        `Character Load Error\nSkeleton: ${manifest.skeletonPath}\nAtlas: ${manifest.atlasPath}\nRuntime version: ${SPINE_RUNTIME_VERSION}\nReason: Spine data was not parsed by the 3.8 runtime loader`,
      )
    }

    const skeletonData = resource.spineData
    this.skeletonData = skeletonData
    reportProgress('Spine skeleton parsed')

    const spine = new Spine(skeletonData)
    spine.autoUpdate = true
    spine.state.data.defaultMix = 0.2
    spine.eventMode = 'static'
    this.spine = spine

    if (manifest.defaultSkin) {
      this.setSkin(manifest.defaultSkin)
    }

    this.setScale(manifest.scale)

    const defaultAnimation =
      this.resolveAnimationName(manifest.animations.idle, false) ??
      skeletonData.animations[0]?.name ??
      null

    console.info(
      '[SpineCharacter] Loaded detail',
      JSON.stringify({
        characterId: manifest.id,
        skeletonVersion: skeletonData.version,
        animations: skeletonData.animations.map((item) => item.name),
        skins: skeletonData.skins.map((item) => item.name),
        slots: skeletonData.slots.map((item) => item.name),
        defaultAnimation,
      }),
    )

    spine.state.addListener({
      complete: (trackEntry: TrackEntry) => {
        const animationName = trackEntry.animation?.name ?? null
        for (const listener of this.completeListeners) {
          listener(animationName)
        }
      },
    })

    return spine
  }

  getView() {
    return this.spine
  }

  onAnimationComplete(listener: AnimationCompleteListener) {
    this.completeListeners.add(listener)
    return () => this.completeListeners.delete(listener)
  }

  hasAnimation(animationName: string) {
    return this.skeletonData?.findAnimation(animationName) !== null
  }

  play(requestedAnimation: string | undefined, loop = false, fallbackAnimation?: string) {
    const animationName = this.resolveAnimationName(requestedAnimation, true, fallbackAnimation)
    if (!animationName || !this.spine) {
      return null
    }

    return this.spine.state.setAnimation(0, animationName, loop)
  }

  setSkin(skinName: string) {
    if (!this.spine || !this.skeletonData) return
    const skin = this.skeletonData.findSkin(skinName)
    if (!skin) {
      throw new Error(`Skin not found: ${skinName}`)
    }

    this.spine.skeleton.setSkin(skin)
    this.spine.skeleton.setSlotsToSetupPose()
  }

  setScale(scale: number) {
    this.scale = scale
    this.applyTransform()
  }

  setFacing(facing: FacingDirection) {
    if (this.facing === facing) return
    this.facing = facing
    this.applyTransform()
  }

  setPosition(x: number, y: number) {
    if (!this.spine) return
    this.spine.position.set(x, y)
  }

  getBounds() {
    return this.spine?.getBounds() ?? null
  }

  getLocalBounds() {
    return this.spine?.getLocalBounds() ?? null
  }

  getAnimationNames() {
    return this.skeletonData?.animations.map((item) => item.name) ?? []
  }

  getSkinNames() {
    return this.skeletonData?.skins.map((item) => item.name) ?? []
  }

  destroy() {
    this.completeListeners.clear()
    this.spine?.state.clearListeners()
    this.spine?.state.clearTracks()
    this.spine?.removeFromParent()
    this.spine?.destroy({ children: true })
    this.spine = null
    this.skeletonData = null

    if (this.assetAliases) {
      void Assets.unload(this.assetAliases.skeleton)
      for (const alias of this.assetAliases.textures) void Assets.unload(alias)
      this.assetAliases = null
    }
    for (const objectUrl of this.textureObjectUrls) URL.revokeObjectURL(objectUrl)
    this.textureObjectUrls = []
  }

  private applyTransform() {
    if (!this.spine) return
    const nativeFacing = this.manifest?.nativeFacing ?? 'right'
    const direction = this.facing === nativeFacing ? 1 : -1
    this.spine.scale.set(this.scale * direction, this.scale)
  }

  private resolveAnimationName(
    requestedAnimation: string | undefined,
    logFallback: boolean,
    fallbackAnimation?: string,
  ) {
    const candidates = [
      requestedAnimation,
      fallbackAnimation,
      this.manifest?.animations.idle,
      this.skeletonData?.animations[0]?.name,
    ].filter((value): value is string => Boolean(value))

    const resolved = candidates.find((name) => this.hasAnimation(name))

    if (logFallback && requestedAnimation && resolved && requestedAnimation !== resolved) {
      console.warn('[SpineCharacter] Animation fallback applied', {
        requestedAnimation,
        fallbackAnimation: resolved,
      })
    }

    return resolved ?? null
  }

  private async detectExportedVersion(manifest: CharacterManifestWithPaths) {
    if (manifest.skeleton.endsWith('.json')) {
      const response = await fetch(manifest.skeletonPath)
      if (!response.ok) {
        throw new Error(
          `Character Load Error\nSkeleton: ${manifest.skeletonPath}\nAtlas: ${manifest.atlasPath}\nRuntime version: ${SPINE_RUNTIME_VERSION}\nReason: ${response.status} ${response.statusText}`,
        )
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        throw new Error(
          `Character Load Error\nSkeleton: ${manifest.skeletonPath}\nAtlas: ${manifest.atlasPath}\nRuntime version: ${SPINE_RUNTIME_VERSION}\nReason: Expected exported JSON skeleton but received content-type "${contentType || 'unknown'}"`,
        )
      }

      let json: Record<string, unknown>
      try {
        json = (await response.json()) as Record<string, unknown>
      } catch (error) {
        throw new Error(
          `Character Load Error\nSkeleton: ${manifest.skeletonPath}\nAtlas: ${manifest.atlasPath}\nRuntime version: ${SPINE_RUNTIME_VERSION}\nReason: Failed to parse skeleton JSON (${error instanceof Error ? error.message : String(error)})`,
        )
      }

      const detectedVersion =
        typeof json.skeleton === 'object' &&
        json.skeleton !== null &&
        'spine' in json.skeleton &&
        typeof json.skeleton.spine === 'string'
          ? json.skeleton.spine
          : null
      if (typeof detectedVersion !== 'string') {
        throw new Error(
          `Character Load Error\nSkeleton: ${manifest.skeletonPath}\nAtlas: ${manifest.atlasPath}\nRuntime version: ${SPINE_RUNTIME_VERSION}\nReason: Missing skeleton.spine version in exported JSON`,
        )
      }

      return detectedVersion
    }

    if (!manifest.spineVersion) {
      throw new Error(
        `Character Load Error\nSkeleton: ${manifest.skeletonPath}\nAtlas: ${manifest.atlasPath}\nRuntime version: ${SPINE_RUNTIME_VERSION}\nReason: Binary skeleton requires manifest.spineVersion for compatibility validation`,
      )
    }

    return manifest.spineVersion
  }

  private assertRuntimeCompatibility(
    manifest: CharacterManifestWithPaths,
    exportedVersion: string,
  ) {
    const runtimeVersion = runtimeMajorMinor(SPINE_RUNTIME_VERSION)
    const assetVersion = runtimeMajorMinor(exportedVersion)

    if (runtimeVersion !== assetVersion) {
      throw new Error(
        `Character Load Error\nSkeleton: ${manifest.skeletonPath}\nAtlas: ${manifest.atlasPath}\nRuntime version: ${SPINE_RUNTIME_VERSION}\nReason: Spine export ${exportedVersion} is incompatible with runtime ${SPINE_RUNTIME_VERSION}`,
      )
    }
  }
}
