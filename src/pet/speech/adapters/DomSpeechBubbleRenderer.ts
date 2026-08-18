import type { SpeechPresentation, TextPresentationPort } from '../types'
import {
  calculateSpeechBubbleLayout,
  type SpeechAnchorRect,
} from '../layout/SpeechBubbleLayout'

/**
 * DOM-only rendering adapter. It owns its node and resize listener; React and
 * Pixi never receive speech state and therefore cannot accidentally prolong a
 * session during unmount or character reload.
 */
export class DomSpeechBubbleRenderer implements TextPresentationPort {
  private readonly host: HTMLElement
  private readonly getAnchor: () => SpeechAnchorRect | null
  private readonly element: HTMLDivElement
  private activeSessionId: string | null = null
  private destroyed = false
  private readonly handleResize = () => this.layout()

  constructor(host: HTMLElement, getAnchor: () => SpeechAnchorRect | null) {
    this.host = host
    this.getAnchor = getAnchor
    this.element = document.createElement('div')
    this.element.className = 'speech-bubble'
    this.element.setAttribute('role', 'status')
    this.element.setAttribute('aria-live', 'polite')
    this.element.setAttribute('aria-atomic', 'true')
    this.element.hidden = true
    this.host.appendChild(this.element)
    window.addEventListener('resize', this.handleResize)
  }

  show(presentation: SpeechPresentation) {
    if (this.destroyed) return
    this.activeSessionId = presentation.sessionId
    // textContent is a security boundary: speech content is never HTML.
    this.element.textContent = presentation.text
    this.element.dataset.audioSource = presentation.audioSource ?? 'none'
    this.element.hidden = false
    this.layout()
  }

  hide(sessionId: string) {
    if (this.destroyed || sessionId !== this.activeSessionId) return
    this.activeSessionId = null
    this.element.hidden = true
    this.element.textContent = ''
    delete this.element.dataset.audioSource
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.activeSessionId = null
    window.removeEventListener('resize', this.handleResize)
    this.element.remove()
  }

  private layout() {
    if (this.destroyed || this.element.hidden) return
    const viewport = {
      width: this.host.clientWidth,
      height: this.host.clientHeight,
    }
    const result = calculateSpeechBubbleLayout(
      viewport,
      { width: this.element.offsetWidth, height: this.element.offsetHeight },
      this.getAnchor(),
    )
    this.element.style.left = `${result.left}px`
    this.element.style.top = `${result.top}px`
    this.element.dataset.mode = result.mode
  }
}
