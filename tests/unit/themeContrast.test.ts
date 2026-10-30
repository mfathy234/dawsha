import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/shared/contrast'
import { THEMES } from '../../src/shared/themes'
import { minimumContrastRatioForTheme } from '../../src/renderer/themeManager'

function blend(color: string, background: string, opacity: number): string {
  const channel = (hex: string, offset: number): number => Number.parseInt(hex.slice(offset, offset + 2), 16)
  const mixed = [1, 3, 5].map((offset) => Math.round(channel(color, offset) * opacity + channel(background, offset) * (1 - opacity)))
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

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

  if (theme.kind === 'light' && theme.term.background === app.well) {
    it('keeps every ANSI text colour readable on the light terminal background', () => {
      const { background, foreground: _foreground, cursor: _cursor, cursorAccent: _cursorAccent, selectionBackground: _selectionBackground, ...colours } = theme.term
      for (const [name, colour] of Object.entries(colours)) {
        expect(contrastRatio(colour, background), name).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('keeps dimmed ANSI text above 3:1 on the light terminal background', () => {
      const { background, foreground: _foreground, cursor: _cursor, cursorAccent: _cursorAccent, selectionBackground: _selectionBackground, ...colours } = theme.term
      for (const [name, colour] of Object.entries(colours)) {
        expect(contrastRatio(blend(colour, background, 0.9), background), name).toBeGreaterThanOrEqual(3)
      }
    })
  }
})

describe('terminal dim contrast', () => {
  it('accounts for xterm applying half the configured ratio to dim text', () => {
    for (const theme of THEMES.filter(({ kind }) => kind === 'light')) {
      expect(minimumContrastRatioForTheme(theme) / 2).toBeGreaterThanOrEqual(4.5)
    }
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
