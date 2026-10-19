import { describe, expect, it } from 'vitest'
import { placeMenu } from '../../src/shared/menuPlacement'

const button = (top: number, left = 900) => ({ left, top, right: left + 28, bottom: top + 28 })

describe('placeMenu', () => {
  it('opens below the button, right-aligned, when it fits', () => {
    expect(placeMenu(button(80), 240, 300, 1440, 900)).toEqual({ left: 688, top: 112, maxHeight: null })
  })

  it('opens above when there is room above but not below', () => {
    expect(placeMenu(button(700), 240, 300, 1440, 900)).toEqual({ left: 688, top: 396, maxHeight: null })
  })

  it('never covers the button: a menu taller than both sides goes to the larger side and scrolls', () => {
    const placed = placeMenu(button(90), 240, 700, 1024, 728)
    expect(placed.top).toBe(122)
    expect(placed.maxHeight).toBe(728 - 8 - 122)
    expect(placed.top).toBeGreaterThanOrEqual(90 + 28)
  })

  it('keeps the menu inside the window horizontally', () => {
    expect(placeMenu(button(80, 20), 240, 100, 1024, 728).left).toBe(20)
    expect(placeMenu(button(80, 2), 240, 100, 1024, 728).left).toBe(8)
  })
})
