import { describe, expect, it } from 'vitest'
import { calculateSpeechBubbleLayout } from './SpeechBubbleLayout'

describe('calculateSpeechBubbleLayout', () => {
  it('places a bubble above the character and clamps it to the viewport', () => {
    expect(
      calculateSpeechBubbleLayout(
        { width: 400, height: 500 },
        { width: 280, height: 80 },
        { x: 350, y: 180, width: 80, height: 200 },
      ),
    ).toEqual({ left: 108, top: 90, mode: 'bubble' })
  })

  it('falls back to a bottom subtitle when the anchor has no space above', () => {
    expect(
      calculateSpeechBubbleLayout(
        { width: 400, height: 500 },
        { width: 280, height: 100 },
        { x: 100, y: 80, width: 200, height: 350 },
      ),
    ).toEqual({ left: 60, top: 376, mode: 'subtitle' })
  })

  it('handles a missing anchor and a viewport narrower than the bubble', () => {
    expect(
      calculateSpeechBubbleLayout(
        { width: 200, height: 160 },
        { width: 280, height: 120 },
        null,
      ),
    ).toEqual({ left: 12, top: 16, mode: 'subtitle' })
  })
})
