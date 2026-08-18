export interface LayoutSize {
  readonly width: number
  readonly height: number
}
export interface SpeechAnchorRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface SpeechBubbleLayout {
  readonly left: number
  readonly top: number
  readonly mode: 'bubble' | 'subtitle'
}

const SAFE_MARGIN = 12
const ANCHOR_GAP = 10
const SUBTITLE_BOTTOM = 24

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

/** Pure CSS-pixel layout; native physical screen coordinates never enter here. */
export function calculateSpeechBubbleLayout(
  viewport: LayoutSize,
  bubble: LayoutSize,
  anchor: SpeechAnchorRect | null,
): SpeechBubbleLayout {
  const maxLeft = Math.max(SAFE_MARGIN, viewport.width - bubble.width - SAFE_MARGIN)
  const centeredLeft = (viewport.width - bubble.width) / 2

  if (anchor) {
    const top = anchor.y - bubble.height - ANCHOR_GAP
    if (top >= SAFE_MARGIN) {
      return {
        left: clamp(anchor.x + anchor.width / 2 - bubble.width / 2, SAFE_MARGIN, maxLeft),
        top,
        mode: 'bubble',
      }
    }
  }

  return {
    left: clamp(centeredLeft, SAFE_MARGIN, maxLeft),
    top: Math.max(SAFE_MARGIN, viewport.height - bubble.height - SUBTITLE_BOTTOM),
    mode: 'subtitle',
  }
}
