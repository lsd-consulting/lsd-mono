// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { BAR_GAP_PX, barAbove } from './bar-place'

const bar = { width: 54, height: 28, offsetLeft: 30 }
const port = { top: 400, bottom: 900, left: 100, right: 900 }
const headAt = (top: number, left = 200) => ({ top, bottom: top + 40, left, right: left + 120 })

describe('barAbove', () => {
  it('leaves the bar under a header with room for it below', () => {
    expect(barAbove(headAt(500), bar, 900, 64, port)).toBeNull()
    // Exactly enough room: still below.
    expect(barAbove(headAt(900 - 40 - 28 - BAR_GAP_PX), bar, 900, 64, port)).toBeNull()
  })

  it('opens the bar above a header near the bottom of the window, at its own left', () => {
    expect(barAbove(headAt(840), bar, 900, 64, port)).toEqual({ top: 840 - BAR_GAP_PX - 28, left: 230 })
  })

  it('keeps it below when it would not fit above either, under the top bar', () => {
    expect(barAbove(headAt(80), bar, 130, 64, port)).toBeNull()
  })

  it('keeps a bar above inside the scrollport, for a header partly scrolled out of it', () => {
    expect(barAbove(headAt(840, 20), bar, 900, 64, port)?.left).toBe(100)
    expect(barAbove(headAt(840, 880), bar, 900, 64, port)?.left).toBe(900 - 54)
  })
})
