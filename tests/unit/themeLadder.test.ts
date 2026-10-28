import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/shared/contrast'
import { darkLadder, ladderFor, lightLadder, mix, needsColours } from '../../src/shared/themeLadder'

describe('mix', () => {
  it('blends two colours', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030')
  })
})

describe('surface ladder', () => {
  it('derives the dark ladder from the pane colour: raised +7%, overlay +12%, well a quarter of the way to the canvas', () => {
    const ladder = darkLadder('#161a22')
    expect(contrastRatio(ladder.chrome, '#0f1217')).toBeLessThan(1.02)
    expect(contrastRatio(ladder.canvas, '#07090c')).toBeLessThan(1.02)
    expect(ladder.raised).toBe(mix('#161a22', '#ffffff', 0.07))
    expect(ladder.overlay).toBe(mix('#161a22', '#ffffff', 0.12))
    expect(ladder.well).toBe(mix('#161a22', ladder.canvas, 0.25))
    expect(contrastRatio(ladder.well, ladder.pane)).toBeGreaterThan(1.03)
    expect(contrastRatio(ladder.well, ladder.pane)).toBeLessThan(1.15)
    expect(contrastRatio(ladder.pane, ladder.canvas)).toBeGreaterThan(1.1)
  })

  it('steps a dark theme the same way whatever its hue', () => {
    for (const pane of ['#2e3440', '#1e1e2e', '#151922']) {
      const ladder = darkLadder(pane)
      expect(contrastRatio(ladder.pane, ladder.chrome)).toBeGreaterThan(1.05)
      expect(contrastRatio(ladder.chrome, ladder.canvas)).toBeGreaterThan(1.05)
      expect(contrastRatio(ladder.raised, ladder.pane)).toBeGreaterThan(1.02)
    }
  })

  it('keeps the pane colour, raises nothing and makes a light well between the pane and chrome', () => {
    const ladder = lightLadder('#ffffff', '#edf0ee')
    expect(ladder.raised).toBe('#ffffff')
    expect(ladder.canvas).not.toBe(ladder.chrome)
    expect(contrastRatio(ladder.well, '#ffffff')).toBeGreaterThan(1.02)
    expect(contrastRatio(ladder.well, ladder.chrome)).toBeGreaterThan(1.02)
  })

  it('picks the ladder by kind', () => {
    expect(ladderFor('dark', '#161a22', '#000').well).toBe(darkLadder('#161a22').well)
    expect(ladderFor('light', '#fff', '#edf0ee').chrome).toBe('#edf0ee')
  })
})

describe('needs colour', () => {
  it('is orange on dark and a darker orange on light, and its text reads at 4.5:1', () => {
    expect(needsColours('dark').fill).toBe('#f08a3c')
    expect(contrastRatio(needsColours('dark').text, '#161a22')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(needsColours('light').text, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(needsColours('light').fill, '#ffffff')).toBeGreaterThanOrEqual(3)
  })
})
