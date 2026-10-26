import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../src/shared/contrast'
import { THEMES } from '../../src/shared/themes'

const css = readFileSync('src/renderer/components/sessionTags.css', 'utf8')
const block = (selector: string): Record<string, string> =>
  Object.fromEntries([...css.slice(css.indexOf(selector)).split('}')[0].matchAll(/--tag-([a-z]+): (#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]))

const sets = { dark: block(':root {'), light: block(":root[data-kind='light'] {") }

describe('tag colours', () => {
  it('defines the same five tags for dark and light', () => {
    expect(Object.keys(sets.dark).sort()).toEqual(['bug', 'docs', 'feature', 'research', 'review'])
    expect(Object.keys(sets.light).sort()).toEqual(Object.keys(sets.dark).sort())
  })

  it('keeps every tag readable (4.5:1) on every surface of every theme of its kind', () => {
    for (const theme of THEMES) {
      for (const [name, color] of Object.entries(sets[theme.kind])) {
        for (const surface of [theme.app.background, theme.app.surface, theme.app.sidebar, theme.app.raised]) {
          expect(contrastRatio(color, surface), `${name} on ${surface} in ${theme.id}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('does not use red or amber for Bug, which are reserved for state', () => {
    for (const color of [sets.dark.bug, sets.light.bug]) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
      expect(r - b).toBeLessThan(80)
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(80)
    }
  })
})
