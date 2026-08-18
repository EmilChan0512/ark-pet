import { z } from 'zod'
import type { CharacterManifestWithPaths } from '../../types/character'

const manifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  skeleton: z.string().min(1),
  atlas: z.string().min(1),
  scale: z.number().positive().default(1),
  nativeFacing: z.enum(['left', 'right']).default('right'),
  spineVersion: z.string().min(3).optional(),
  defaultSkin: z.string().min(1).optional(),
  animations: z.object({
    idle: z.string().min(1),
    interact: z.string().min(1).optional(),
    drag: z.string().min(1).optional(),
    walk: z.string().min(1).optional(),
    sit: z.string().min(1).optional(),
    sleep: z.string().min(1).optional(),
  }),
  voice: z
    .object({
      characterId: z.string().min(1),
      voiceIdentity: z.string().min(1),
      locale: z.string().min(2),
    })
    .optional(),
})

function pathSeparator(path: string) {
  if (/%5c/i.test(path)) return '%5C'
  if (path.includes('\\')) return '\\'
  return '/'
}

export function characterAssetBasePath(manifestPath: string) {
  const separator = pathSeparator(manifestPath)
  const normalizedPath = separator === '%5C' ? manifestPath.toUpperCase() : manifestPath
  const separatorIndex = normalizedPath.lastIndexOf(separator)
  return separatorIndex >= 0 ? manifestPath.slice(0, separatorIndex) : manifestPath
}

export function resolveCharacterAssetPath(basePath: string, relative: string) {
  const separator = pathSeparator(basePath)
  const encodedRelative = relative
    .split(/[\\/]/)
    .map((segment) => encodeURIComponent(segment))
    .join(separator)
  return `${basePath.replace(/(?:\/|\\|%5C)$/i, '')}${separator}${encodedRelative}`
}

export async function loadAndValidateManifest(
  manifestPath: string,
): Promise<CharacterManifestWithPaths> {
  const response = await fetch(manifestPath)
  if (!response.ok) {
    throw new Error(
      `Character manifest load failed: ${manifestPath} (${response.status} ${response.statusText})`,
    )
  }

  const parsed = manifestSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error(
      `Character manifest validation failed: ${manifestPath}\n${parsed.error.message}`,
    )
  }

  const basePath = characterAssetBasePath(manifestPath)

  return {
    ...parsed.data,
    basePath,
    skeletonPath: resolveCharacterAssetPath(basePath, parsed.data.skeleton),
    atlasPath: resolveCharacterAssetPath(basePath, parsed.data.atlas),
  }
}
