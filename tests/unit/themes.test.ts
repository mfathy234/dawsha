import { describe, expect, it } from 'vitest'
import { contrastRatio, luminance } from '../../src/shared/contrast'
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

  it('terminal background is the well when the terminal matches the app kind, and the well is told apart from the pane', () => {
    if (hasLightTerminal(theme) === (theme.kind === 'light')) expect(term.background.toLowerCase()).toBe(app.well.toLowerCase())
    expect(contrastRatio(app.well, app.surface)).toBeGreaterThan(1.02)
  })

  it('secondary text reads at 4.5:1 on every plane of the ladder', () => {
    for (const bg of [app.background, app.sidebar, app.surface, app.raised, app.overlay, app.well]) {
      expect(contrastRatio(app.muted, bg), bg).toBeGreaterThanOrEqual(MIN)
    }
  })

  it('has the surface ladder: canvas, chrome and pane step apart, the overlay lifts above the pane', () => {
    const lum = (hex: string): number => luminance(hex)
    if (theme.kind === 'dark') {
      expect(lum(app.background)).toBeLessThan(lum(app.sidebar))
      expect(lum(app.sidebar)).toBeLessThan(lum(app.surface))
      expect(lum(app.surface)).toBeLessThan(lum(app.raised))
      expect(lum(app.raised)).toBeLessThan(lum(app.overlay))
      expect(lum(app.well)).toBeLessThan(lum(app.surface))
    } else {
      expect(lum(app.background)).toBeLessThan(lum(app.sidebar))
      expect(lum(app.sidebar)).toBeLessThan(lum(app.surface))
      expect(lum(app.well)).toBeGreaterThan(lum(app.sidebar))
    }
    expect(contrastRatio(app.background, app.sidebar)).toBeGreaterThan(1.03)
    expect(contrastRatio(app.sidebar, app.surface)).toBeGreaterThan(1.03)
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

  it('gives Daylight a light terminal by default and keeps a dark terminal as its own theme', () => {
    expect(findTheme('dawsha-daylight').kind).toBe('light')
    expect(hasLightTerminal(findTheme('dawsha-daylight'))).toBe(true)
    expect(hasLightTerminal(findTheme('dawsha-daylight-dark'))).toBe(false)
    expect(findTheme('dawsha-daylight-dark').kind).toBe('light')
    expect(hasLightTerminal(findTheme('github-light'))).toBe(true)
    expect(hasLightTerminal(findTheme('grid-dark'))).toBe(false)
  })

  it('uses the approved plane colours for Dawsha dark and Daylight', () => {
    const dark = findTheme('grid-dark').app
    expect([dark.background, dark.sidebar, dark.surface, dark.raised, dark.overlay, dark.well]).toEqual(['#07090c', '#0f1217', '#161a22', '#1d222c', '#252b37', '#0d1015'])
    const light = findTheme('dawsha-daylight').app
    expect([light.background, light.sidebar, light.surface, light.raised, light.well]).toEqual(['#e2e6e4', '#edf0ee', '#ffffff', '#ffffff', '#f6f8f7'])
  })

  it('defines all 16 ansi colours for every theme', () => {
    for (const theme of THEMES) {
      const keys = Object.keys(theme.term).filter((k) => !/background|foreground|cursor|selection/i.test(k))
      expect(keys).toHaveLength(16)
    }
  })
})
