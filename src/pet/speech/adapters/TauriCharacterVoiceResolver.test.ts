import { describe, expect, it, vi } from 'vitest'
import type { CharacterVoiceService } from '../../../services/speech'
import type { CharacterVoiceArtifact } from '../types'
import { TauriCharacterVoiceResolver } from './TauriCharacterVoiceResolver'

const context = {
  characterId: 'char_4058_pepe',
  characterGeneration: 7,
  voiceIdentity: 'pepe.zh-CN.cn_012',
}

function artifact(
  source: CharacterVoiceArtifact['source'],
  transcript: string,
): CharacterVoiceArtifact {
  return {
    ...context,
    source,
    transcript,
    audioUri: 'data:audio/wav;base64,voice',
  }
}

function service(overrides: Partial<CharacterVoiceService> = {}): CharacterVoiceService {
  return {
    getCapabilities: vi.fn(),
    resolveOriginalClip: vi.fn(async () => null),
    synthesize: vi.fn(async () => artifact('character-ai', '动态文字')),
    prepare: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    ...overrides,
  }
}

function deferredArtifact() {
  let resolve!: (value: CharacterVoiceArtifact) => void
  const promise = new Promise<CharacterVoiceArtifact>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('TauriCharacterVoiceResolver', () => {
  it('uses a registered original cue and permits canonical transcript replacement', async () => {
    const original = artifact('character-original', '不许拆我背后的蝴蝶结！')
    const port = service({ resolveOriginalClip: vi.fn(async () => original) })
    const resolver = new TauriCharacterVoiceResolver(
      () => 'cue-and-text-replacement',
      port,
    )

    await expect(
      resolver.resolve(
        { id: 'cue', source: 'interaction', text: '动态点击文字', cue: '戳一下' },
        context,
        new AbortController().signal,
      ),
    ).resolves.toEqual(original)
    expect(port.synthesize).not.toHaveBeenCalled()
  })

  it('rejects a cue whose canonical transcript is not an exact text match under strict policy', async () => {
    const port = service({
      resolveOriginalClip: vi.fn(async () => artifact('character-original', '另一句话')),
    })
    const resolver = new TauriCharacterVoiceResolver(() => 'exact-clip-only', port)

    await expect(
      resolver.resolve(
        { id: 'strict', source: 'interaction', text: '目标文字', cue: '戳一下' },
        context,
        new AbortController().signal,
      ),
    ).resolves.toBeNull()
  })

  it('synthesizes cue-less text and forwards cancellation by request id', async () => {
    const gate = deferredArtifact()
    const port = service({ synthesize: vi.fn(() => gate.promise) })
    const resolver = new TauriCharacterVoiceResolver(
      () => 'cue-and-text-replacement',
      port,
    )
    const controller = new AbortController()
    const pending = resolver.resolve(
      { id: 'dynamic', source: 'local-integration', text: '博士，今天先做什么？' },
      context,
      controller.signal,
    )

    controller.abort()
    expect(port.cancel).toHaveBeenCalledWith('dynamic')
    gate.resolve(artifact('character-ai', '博士，今天先做什么？'))
    await expect(pending).resolves.toMatchObject({ source: 'character-ai' })
  })

  it('delegates warmup and shutdown to the platform service', async () => {
    const port = service()
    const resolver = new TauriCharacterVoiceResolver(
      () => 'cue-and-text-replacement',
      port,
    )

    await resolver.prepare()
    await resolver.destroy()
    expect(port.prepare).toHaveBeenCalledOnce()
    expect(port.shutdown).toHaveBeenCalledOnce()
  })
})
