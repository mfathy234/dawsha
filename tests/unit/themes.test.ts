import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/shared/contrast'
import { CODEX_MARK, GEMINI_MARK } from '../../src/shared/agents'
import { DEFAULT_THEME_ID, THEMES, findTheme, hasLightTerminal, resolveThemeId } from '../../src/shared/themes'

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

  it('terminal background matches the pane surface, or sits in a visible well for card themes', () => {
    if (theme.style === 'cards') {
      expect(term.background.toLowerCase()).not.toBe(app.surface.toLowerCase())
      expect(contrastRatio(term.background, app.surface)).toBeGreaterThan(1.05)
    } else {
      expect(term.background.toLowerCase()).toBe(app.surface.toLowerCase())
    }
  })
})

describe('theme set', () => {
  it('has unique ids and the required themes', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(THEMES.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'Dawsha',
        'Dawsha Cards',
        'Graphite Cards',
        'Dawsha Daylight',
        'Nord',
        'Catppuccin Mocha',
        'GitHub Light'
      ])
    )
  })

  it('maps retired themes to their closest current theme', () => {
    expect(resolveThemeId('tokyo-night')).toBe('dawsha-cards')
    expect(resolveThemeId('solarized-dark')).toBe('graphite-cards')
    expect(resolveThemeId('gruvbox-dark')).toBe('graphite-cards')
    expect(resolveThemeId('solarized-light')).toBe('dawsha-daylight')
    expect(resolveThemeId('nord')).toBe('nord')
    expect(resolveThemeId('no-such-theme')).toBe(DEFAULT_THEME_ID)
    expect(findTheme('solarized-light').id).toBe('dawsha-daylight')
  })

  it('treats Daylight as a light app with a dark terminal', () => {
    expect(findTheme('dawsha-daylight').kind).toBe('light')
    expect(hasLightTerminal(findTheme('dawsha-daylight'))).toBe(false)
    expect(hasLightTerminal(findTheme('github-light'))).toBe(true)
    expect(hasLightTerminal(findTheme('grid-dark'))).toBe(false)
  })

  it('defines all 16 ansi colours for every theme', () => {
    for (const theme of THEMES) {
      const keys = Object.keys(theme.term).filter((k) => !/background|foreground|cursor|selection/i.test(k))
      expect(keys).toHaveLength(16)
    }
  })
})
