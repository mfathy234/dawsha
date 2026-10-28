import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/shared/contrast'
import { THEMES } from '../../src/shared/themes'

describe.each(THEMES)('theme $name contrast', (theme) => {
  const { app } = theme
  it.each([
    ['pane', app.surface],
    ['well', app.well],
    ['raised', app.raised]
  ])('text and muted reach 4.5:1 on %s', (_name, bg) => {
    expect(contrastRatio(app.text, bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(app.muted, bg)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('Dawsha Cards', () => {
  const cards = THEMES.find((t) => t.id === 'dawsha-cards')!
  it('uses the refined explicit surfaces and a flush terminal', () => {
    expect(cards.name).toBe('Dawsha Cards')
    expect([cards.app.background, cards.app.sidebar, cards.app.surface, cards.app.raised, cards.app.overlay, cards.app.well]).toEqual(['#0c0e13', '#11141a', '#181c24', '#222731', '#2b313d', '#14171e'])
    expect(cards.term.background).toBe('#14171e')
    expect(cards.app.faint).toBe('#6e778a')
    expect(cards.app.done).toBe('#86c5a8')
  })
})
