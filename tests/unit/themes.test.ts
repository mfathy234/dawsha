import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/shared/contrast'
import { CODEX_MARK, GEMINI_MARK } from '../../src/shared/agents'
import { THEMES } from '../../src/shared/themes'

const MIN = 4.5

describe.each(THEMES)('theme $name', (theme) => {
  const { app, term } = theme
  const surfaces = { background: app.background, surface: app.surface, sidebar: app.sidebar }

  it('text and accent are readable on the raised (selected and hover) surface', () => {
    expect(contrastRatio(app.text, app.raised)).toBeGreaterThanOrEqual(MIN)
    expect(contrastRatio(app.accent, app.raised)).toBeGreaterThanOrEqual(MIN)
  })

  it.each(Object.entries(surfaces))('text and muted meet 4.5:1 on %s', (_name, bg) => {
    expect(contrastRatio(app.text, bg)).toBeGreaterThanOrEqual(MIN)
    expect(contrastRatio(app.muted, bg)).toBeGreaterThanOrEqual(MIN)
  })

  it('status colours and accent are readable as text on surface and background', () => {
    for (const colour of [app.accent, app.busy, app.idle, app.exited]) {
      expect(contrastRatio(colour, app.surface)).toBeGreaterThanOrEqual(MIN)
      expect(contrastRatio(colour, app.background)).toBeGreaterThanOrEqual(MIN)
    }
  })

  it('button labels are readable on the accent and danger fills', () => {
    expect(contrastRatio(app.onAccent, app.accent)).toBeGreaterThanOrEqual(MIN)
    expect(contrastRatio(app.onDanger, app.danger)).toBeGreaterThanOrEqual(MIN)
  })

  it('the Claude mark (accent) and the fixed Codex and Gemini marks are legible on every surface', () => {
    expect(contrastRatio(CODEX_MARK.color, CODEX_MARK.background)).toBeGreaterThanOrEqual(MIN)
    expect(contrastRatio(GEMINI_MARK.color, GEMINI_MARK.background)).toBeGreaterThanOrEqual(MIN)
    for (const bg of [app.background, app.surface, app.sidebar, app.raised]) {
      expect(contrastRatio(app.accent, bg)).toBeGreaterThanOrEqual(MIN)
    }
  })

  it('terminal foreground is readable on the terminal background', () => {
    expect(contrastRatio(term.foreground, term.background)).toBeGreaterThanOrEqual(MIN)
  })

  it('terminal background matches the pane surface', () => {
    expect(term.background.toLowerCase()).toBe(app.surface.toLowerCase())
  })
})

describe('theme set', () => {
  it('has unique ids and the required themes', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(THEMES.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'Dawsha',
        'Nord',
        'Tokyo Night',
        'Catppuccin Mocha',
        'Solarized Dark',
        'Gruvbox Dark',
        'GitHub Light',
        'Solarized Light'
      ])
    )
  })

  it('defines all 16 ansi colours for every theme', () => {
    for (const theme of THEMES) {
      const keys = Object.keys(theme.term).filter((k) => !/background|foreground|cursor|selection/i.test(k))
      expect(keys).toHaveLength(16)
    }
  })
})
