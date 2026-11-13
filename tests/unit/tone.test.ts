import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/shared/contrast'
import { THEMES } from '../../src/shared/themes'
import { neutralise, toneApp, toneTerminalBackground, warmApp } from '../../src/shared/tone'
import { parseHex } from '../../src/shared/contrast'

const spread = (hex: string): number => {
  const [r, g, b] = parseHex(hex)
  return Math.max(r, g, b) - Math.min(r, g, b)
}

describe('warm tone', () => {
  it('turns the blue-tinted dark surfaces into the mockup greys', () => {
    expect(neutralise('#1b1f26', 0.015)).toBe('#212120')
    expect(neutralise('#121419', 0.015)).toBe('#161615')
    expect(neutralise('#16191f', 0.015)).toBe('#1b1b1a')
  })

  it('leaves the cool tone as the theme set it', () => {
    const theme = THEMES[0]
    expect(toneApp(theme.app, theme.kind, 'cool')).toBe(theme.app)
    expect(toneTerminalBackground('#0f1115', 'cool', 'dark')).toBe('#0f1115')
  })

  it.each(THEMES.map((theme) => [theme.id, theme] as const))('%s keeps its accent and reads on every surface when warm', (_id, theme) => {
    const warm = warmApp(theme.app, theme.kind)
    expect(warm.accent).toBe(theme.app.accent)
    expect(warm.danger).toBe(theme.app.danger)
    for (const surface of [warm.background, warm.sidebar, warm.surface, warm.raised, warm.overlay, warm.well]) {
      expect(spread(surface)).toBeLessThanOrEqual(8)
      expect(contrastRatio(warm.text, surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(warm.muted, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
