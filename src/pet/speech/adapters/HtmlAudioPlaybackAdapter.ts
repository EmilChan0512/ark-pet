import type {
  AudioPlaybackPort,
  CharacterVoiceArtifact,
  SpeechCancellationReason,
} from '../types'

export class HtmlAudioPlaybackAdapter implements AudioPlaybackPort {
  private current: HTMLAudioElement | null = null
  private destroyed = false

  play(
    artifact: CharacterVoiceArtifact,
    options: Readonly<{ volume: number }>,
    signal: AbortSignal,
  ) {
    if (this.destroyed) return Promise.reject(new Error('Audio player is destroyed'))
    this.stop('replaced')
    const audio = new Audio(artifact.audioUri)
    audio.volume = Math.max(0, Math.min(1, options.volume))
    this.current = audio

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        audio.removeEventListener('ended', handleEnded)
        audio.removeEventListener('error', handleError)
        signal.removeEventListener('abort', handleAbort)
        if (this.current === audio) this.current = null
      }
      const finish = (action: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        action()
      }
      const handleEnded = () => finish(resolve)
      const handleError = () => finish(() => reject(new Error('Character audio playback failed')))
      const handleAbort = () => {
        audio.pause()
        audio.currentTime = 0
        finish(() => reject(new DOMException('Speech playback aborted', 'AbortError')))
      }

      audio.addEventListener('ended', handleEnded)
      audio.addEventListener('error', handleError)
      signal.addEventListener('abort', handleAbort, { once: true })
      if (signal.aborted) {
        handleAbort()
        return
      }
      void audio.play().catch((error: unknown) => finish(() => reject(error)))
    })
  }

  stop(_reason: SpeechCancellationReason) {
    const audio = this.current
    if (!audio) return
    this.current = null
    audio.pause()
    audio.currentTime = 0
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.stop('destroyed')
  }
}
