import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/shared/contrast'
import { THEMES } from '../../src/shared/themes'
import { neutralise, toneApp, toneTerminalBackground, warmApp, warmTintKeep } from '../../src/shared/tone'
import { parseHex } from '../../src/shared/contrast'

const spread = (hex: string): number => {
  const [r, g, b] = parseHex(hex)
  return Math.max(r, g, b) - Math.min(r, g, b)
}

const lightness = (hex: string): number => {
  const [r, g, b] = parseHex(hex)
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510
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

  it.each(THEMES.map((theme) => [theme.id, theme] as const))('%s keeps its accent, lightness steps and contrast when warm', (_id, theme) => {
    const keep = warmTintKeep(theme.id)
    const warm = warmApp(theme.app, theme.kind, keep)
    expect(warm.accent).toBe(theme.app.accent)
    expect(warm.danger).toBe(theme.app.danger)
    for (const key of ['background', 'sidebar', 'surface', 'raised', 'overlay', 'well'] as const) {
      expect(Math.abs(lightness(warm[key]) - lightness(theme.app[key]))).toBeLessThanOrEqual(0.03)
      expect(spread(warm[key])).toBeLessThanOrEqual(spread(theme.app[key]) + 8)
      expect(contrastRatio(warm.text, warm[key])).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(warm.muted, warm[key])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('turns the default theme into neutral greys', () => {
    const theme = THEMES[0]
    const warm = warmApp(theme.app, theme.kind, warmTintKeep(theme.id))
    for (const key of ['sidebar', 'surface', 'raised', 'overlay', 'well'] as const) expect(spread(warm[key])).toBeLessThanOrEqual(8)
  })

  it('keeps a tinted theme recognisable, so each theme looks like itself', () => {
    const nord = THEMES.find((theme) => theme.id === 'nord')!
    const mocha = THEMES.find((theme) => theme.id === 'catppuccin-mocha')!
    const grid = THEMES[0]
    const [nr, , nb] = parseHex(warmApp(nord.app, nord.kind, warmTintKeep(nord.id)).surface)
    expect(nb).toBeGreaterThanOrEqual(nr)
    const [mr, , mb] = parseHex(warmApp(mocha.app, mocha.kind, warmTintKeep(mocha.id)).surface)
    expect(mb).toBeGreaterThanOrEqual(mr)
    const surfaces = [nord, mocha, grid].map((theme) => warmApp(theme.app, theme.kind, warmTintKeep(theme.id)).surface)
    expect(new Set(surfaces).size).toBe(3)
  })

  it('shifts every theme toward warm, never away from it', () => {
    for (const theme of THEMES) {
      const keep = warmTintKeep(theme.id)
      const [r, , b] = parseHex(warmApp(theme.app, theme.kind, keep).surface)
      const [or, , ob] = parseHex(theme.app.surface)
      expect(r - b).toBeGreaterThanOrEqual(or - ob)
    }
  })

  it('moves the terminal background the same way as the surfaces', () => {
    expect(toneTerminalBackground('#2e3440', 'warm', 'dark', 0)).toBe(neutralise('#2e3440', 0.015))
    expect(toneTerminalBackground('#2e3440', 'warm', 'dark', 0.45)).not.toBe(neutralise('#2e3440', 0.015))
    expect(toneTerminalBackground('#2e3440', 'cool', 'dark', 0.45)).toBe('#2e3440')
  })
})
