import { Assets } from 'pixi.js'
import {
  Spine,
  type SkeletonData,
  type TrackEntry,
} from '@pixi-spine/all-3.8'
import type { CharacterManifestWithPaths } from '../../types/character'

const SPINE_RUNTIME_VERSION = '3.8'

type AnimationCompleteListener = (animationName: string | null) => void

function runtimeMajorMinor(version: string) {
  return version.split('.').slice(0, 2).join('.')
}

export class SpineCharacter {
  private static assetSequence = 0
  private manifest: CharacterManifestWithPaths | null = null
  private skeletonData: SkeletonData | null = null
  private spine: Spine | null = null
  private readonly completeListeners = new Set<AnimationCompleteListener>()
  private assetAliases: { skeleton: string } | null = null

  async load(manifest: CharacterManifestWithPaths) {
    this.manifest = manifest

    const exportedVersion = await this.detectExportedVersion(manifest)
    this.assertRuntimeCompatibility(manifest, exportedVersion)

    const assetAliases = {
      skeleton: `${manifest.id}-skeleton-${SpineCharacter.assetSequence++}`,
    }
    this.assetAliases = assetAliases

    Assets.add({
      alias: assetAliases.skeleton,
      src: manifest.skeletonPath,
      data: {
        spineAtlasFile: manifest.atlasPath,
      },
    })

    const resource = (await Assets.load(assetAliases.skeleton)) as {
      spineData?: SkeletonData
    }

    if (!resource?.spineData) {
      throw new Error(
        `Character Load Error\nSkeleton: ${manifest.skeletonPath}\nAtlas: ${manifest.atlasPath}\nRuntime version: ${SPINE_RUNTIME_VERSION}\nReason: Spine data was not parsed by the 3.8 runtime loader`,
      )
    }

    const skeletonData = resource.spineData
    this.skeletonData = skeletonData

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
    this.spine?.scale.set(scale)
  }

  setPosition(x: number, y: number) {
    if (!this.spine) return
    this.spine.position.set(x, y)
  }

  getBounds() {
    return this.spine?.getBounds() ?? null
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
      this.assetAliases = null
    }
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
