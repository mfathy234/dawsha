import { describe, expect, it } from 'vitest'
import { placeAtPoint, placeMenu } from '../../src/shared/menuPlacement'

const button = (top: number, left = 900) => ({ left, top, right: left + 28, bottom: top + 28 })

describe('placeMenu', () => {
  it('opens below the button, start-aligned, when the button is in the start half', () => {
    expect(placeMenu(button(80, 300), 240, 300, 1440, 900)).toEqual({ left: 300, top: 112, maxHeight: null })
  })

  it('opens above when there is room above but not below', () => {
    expect(placeMenu(button(700, 300), 240, 300, 1440, 900)).toEqual({ left: 300, top: 396, maxHeight: null })
  })

  it('opens end-aligned, inward, when the button is in the end half', () => {
    expect(placeMenu(button(80), 240, 300, 1440, 900).left).toBe(928 - 240)
  })

  it('uses the button\'s own area: a trailing ⋯ in the left pane opens inward, not over the next pane', () => {
    const pane = { left: 250, right: 640 }
    expect(placeMenu(button(80, 600), 240, 100, 1440, 900, 4, pane).left).toBe(628 - 240)
    expect(placeMenu(button(80, 260), 240, 100, 1440, 900, 4, pane).left).toBe(260)
  })

  it('still starts at the button when the end side would leave the window', () => {
    expect(placeMenu(button(80, 100), 240, 100, 1440, 900, 4, { left: 0, right: 150 }).left).toBe(100)
  })

  it('never covers the button: a menu taller than both sides goes to the larger side and scrolls', () => {
    const placed = placeMenu(button(90), 240, 700, 1024, 728)
    expect(placed.top).toBe(122)
    expect(placed.maxHeight).toBe(728 - 8 - 122)
    expect(placed.top).toBeGreaterThanOrEqual(90 + 28)
  })

  it('flips to the end of the button near the right edge', () => {
    expect(placeMenu(button(80, 980), 240, 100, 1024, 728).left).toBe(768)
    expect(placeMenu(button(80, 1000), 240, 100, 1024, 728).left).toBe(788)
  })

  it('keeps the menu inside the window horizontally', () => {
    expect(placeMenu(button(80, 20), 240, 100, 1024, 728).left).toBe(20)
    expect(placeMenu(button(80, 2), 240, 100, 1024, 728).left).toBe(8)
  })
})

describe('placeAtPoint', () => {
  it('opens on the pointer when it fits', () => {
    expect(placeAtPoint(300, 200, 240, 280, 1440, 900)).toEqual({ left: 300, top: 200, maxHeight: null })
  })

  it('moves left and up so the menu stays inside the window', () => {
    expect(placeAtPoint(1400, 880, 240, 280, 1440, 900)).toEqual({ left: 1192, top: 612, maxHeight: null })
  })

  it('shortens a menu that is taller than the window', () => {
    expect(placeAtPoint(10, 300, 240, 900, 1024, 728)).toEqual({ left: 10, top: 8, maxHeight: 712 })
  })
})
