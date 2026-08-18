import { describe, expect, it, vi } from 'vitest'
import { SpeechSessionCoordinator } from './SpeechSessionCoordinator'
import type {
  AudioPlaybackPort,
  CharacterVoiceArtifact,
  CharacterVoiceResolverPort,
  SpeechPresentation,
  TextPresentationPort,
} from './types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function harness(resolver?: CharacterVoiceResolverPort, player?: AudioPlaybackPort) {
  const visible: SpeechPresentation[] = []
  const hidden: string[] = []
  const presentation: TextPresentationPort = {
    show: (item) => visible.push(item),
    hide: (id) => hidden.push(id),
    destroy: vi.fn(),
  }
  const coordinator = new SpeechSessionCoordinator(
    presentation,
    resolver ?? { resolve: async () => null },
    player ?? { play: async () => {}, stop: vi.fn(), destroy: vi.fn() },
    () => ({
      characterId: 'char_4058_pepe',
      characterGeneration: 1,
      voiceIdentity: 'pepe.zh-CN.cn_012',
    }),
  )
  coordinator.resume()
  return { coordinator, visible, hidden, presentation }
}

describe('SpeechSessionCoordinator', () => {
  it('shows text immediately and completes from the injected ticker deadline', async () => {
    const { coordinator, visible, hidden } = harness()
    const outcome = coordinator.enqueue({ id: 'one', source: 'interaction', text: '你好' }, 0)

    expect(visible.at(-1)?.text).toBe('你好')
    coordinator.update(2_499)
    expect(coordinator.getSnapshot().activeSessionId).toBe('one')
    coordinator.update(3_000)

    await expect(outcome).resolves.toBe('completed')
    expect(hidden).toEqual(['one'])
  })

  it('preempts lower priority and protects the new bubble from stale synthesis', async () => {
    const gate = deferred<CharacterVoiceArtifact | null>()
    let resolveCount = 0
    const { coordinator, visible } = harness({
      resolve: () => (resolveCount++ === 0 ? gate.promise : Promise.resolve(null)),
    })
    coordinator.setVoiceEnabled(true)
    const ambient = coordinator.enqueue({ id: 'ambient', source: 'ambient', text: '旧话' }, 0)
    const manual = coordinator.enqueue({ id: 'manual', source: 'interaction', text: '新话' }, 1)

    await expect(ambient).resolves.toBe('superseded')
    gate.resolve({
      characterId: 'char_4058_pepe',
      characterGeneration: 1,
      voiceIdentity: 'pepe.zh-CN.cn_012',
      transcript: '迟到的旧话',
      source: 'character-ai',
      audioUri: 'memory://old',
    })
    await Promise.resolve()

    expect(visible.at(-1)?.text).toBe('新话')
    // Voice-enabled sessions reserve the synthesis budget plus a small visual
    // margin. Advance the injected runtime clock rather than waiting 12 seconds.
    coordinator.update(12_501)
    await expect(manual).resolves.toBe('completed')
  })

  it('coalesces repeated interaction keys and keeps other equal-priority requests FIFO', async () => {
    const { coordinator, visible } = harness()
    const active = coordinator.enqueue({ id: 'active', source: 'system', text: '系统' }, 0)
    const oldClick = coordinator.enqueue({ id: 'old', source: 'interaction', text: '旧点击', dedupeKey: 'click' }, 1)
    const other = coordinator.enqueue({ id: 'other', source: 'interaction', text: '其他', dedupeKey: 'other' }, 2)
    const newClick = coordinator.enqueue({ id: 'new', source: 'interaction', text: '新点击', dedupeKey: 'click' }, 3)

    await expect(oldClick).resolves.toBe('superseded')
    coordinator.update(3_000)
    await expect(active).resolves.toBe('completed')
    expect(visible.at(-1)?.text).toBe('其他')
    coordinator.update(5_600)
    await expect(other).resolves.toBe('completed')
    expect(visible.at(-1)?.text).toBe('新点击')
    coordinator.update(8_100)
    await expect(newClick).resolves.toBe('completed')
  })

  it('updates text atomically to the exact fallback transcript and follows audio end', async () => {
    const playback = deferred<void>()
    const artifact: CharacterVoiceArtifact = {
      characterId: 'char_4058_pepe',
      characterGeneration: 1,
      voiceIdentity: 'pepe.zh-CN.cn_012',
      transcript: '不许拆我背后的蝴蝶结！',
      source: 'character-original',
      audioUri: 'ark-voice://cn_034.wav',
    }
    const { coordinator, visible } = harness(
      { resolve: async () => artifact },
      { play: () => playback.promise, stop: vi.fn(), destroy: vi.fn() },
    )
    coordinator.setVoiceEnabled(true)
    const outcome = coordinator.enqueue({ id: 'click', source: 'interaction', text: '动态文字', cue: '戳一下' }, 0)
    await Promise.resolve()
    await Promise.resolve()

    expect(visible.at(-1)).toMatchObject({
      text: artifact.transcript,
      audioSource: 'character-original',
    })
    playback.resolve()
    await Promise.resolve()
    coordinator.update(349)
    expect(coordinator.getSnapshot().activeSessionId).toBe('click')
    coordinator.update(350)
    await expect(outcome).resolves.toBe('completed')
  })

  it('reports bounded voice preparation, synthesis, and playback progress', async () => {
    const playback = deferred<void>()
    const artifact: CharacterVoiceArtifact = {
      characterId: 'char_4058_pepe',
      characterGeneration: 1,
      voiceIdentity: 'pepe.zh-CN.cn_012',
      transcript: '进度测试',
      source: 'character-ai',
      audioUri: 'memory://progress',
    }
    const { coordinator } = harness(
      { prepare: async () => {}, resolve: async () => artifact },
      { play: () => playback.promise, stop: vi.fn(), destroy: vi.fn() },
    )

    coordinator.setVoiceEnabled(true)
    await Promise.resolve()
    expect(coordinator.getSnapshot().voiceProgressStatus).toBe('ready')

    const outcome = coordinator.enqueue({ id: 'progress', source: 'interaction', text: '进度测试' }, 0)
    await Promise.resolve()
    await Promise.resolve()
    expect(coordinator.getSnapshot()).toMatchObject({
      voiceProgressStatus: 'playing',
      activeAudioSource: 'character-ai',
    })
    expect(coordinator.getSnapshot().voiceProgressLog).toEqual(expect.arrayContaining([
      expect.stringContaining('Preparing local Pepe voice runtime'),
      expect.stringContaining('Synthesizing progress'),
      expect.stringContaining('Playing character-ai for progress'),
    ]))

    playback.resolve()
    await Promise.resolve()
    coordinator.update(350)
    await expect(outcome).resolves.toBe('completed')
    expect(coordinator.getSnapshot().voiceProgressStatus).toBe('ready')
  })

  it('rejects a mismatched voice identity and safely remains text-only', async () => {
    const reportError = vi.fn()
    const presentation: TextPresentationPort = {
      show: vi.fn(),
      hide: vi.fn(),
      destroy: vi.fn(),
    }
    const coordinator = new SpeechSessionCoordinator(
      presentation,
      {
        resolve: async () => ({
          characterId: 'wrong-character',
          characterGeneration: 1,
          voiceIdentity: 'wrong-voice',
          transcript: '错误声音',
          source: 'character-ai',
          audioUri: 'memory://wrong',
        }),
      },
      { play: vi.fn(), stop: vi.fn(), destroy: vi.fn() },
      () => ({ characterId: 'char_4058_pepe', characterGeneration: 1, voiceIdentity: 'pepe.zh-CN.cn_012' }),
      { publish: () => {}, reportError },
      { synthesisTimeoutMs: 100 },
    )
    coordinator.resume()
    coordinator.setVoiceEnabled(true)
    const outcome = coordinator.enqueue({ id: 'identity', source: 'interaction', text: '安全文字' }, 0)
    await Promise.resolve()
    coordinator.update(3_000)

    await expect(outcome).resolves.toBe('completed')
    expect(reportError).toHaveBeenCalledWith('identity', 'identity', expect.any(Error))
  })

  it('cancels active and pending work on pause and destroys idempotently', async () => {
    const player = { play: async () => {}, stop: vi.fn(), destroy: vi.fn() }
    const { coordinator, presentation } = harness(undefined, player)
    const active = coordinator.enqueue({ id: 'active', source: 'interaction', text: '一' }, 0)
    const pending = coordinator.enqueue({ id: 'pending', source: 'ambient', text: '二' }, 1)

    coordinator.pause('hidden')
    await expect(active).resolves.toBe('cancelled')
    await expect(pending).resolves.toBe('cancelled')
    await coordinator.destroy()
    await coordinator.destroy()
    await expect(coordinator.enqueue({ id: 'late', source: 'system', text: '三' }, 2)).resolves.toBe('rejected-destroyed')
    expect(player.destroy).toHaveBeenCalledOnce()
    expect(presentation.destroy).toHaveBeenCalledOnce()
  })
})
