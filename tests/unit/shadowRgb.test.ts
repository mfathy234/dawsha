import { describe, expect, it } from 'vitest'
import { shadowRgb } from '../../src/shared/contrast'
import { THEMES } from '../../src/shared/themes'

describe('shadowRgb', () => {
  it('darkens the background of a dark theme instead of using pure black', () => {
    expect(shadowRgb('#0c0e12', '#d6dae3', 'dark')).toBe('4 5 6')
  })

  it('uses the text colour of a light theme', () => {
    expect(shadowRgb('#ffffff', '#181c28', 'light')).toBe('24 28 40')
  })

  it('never returns pure black for any bundled theme', () => {
    for (const theme of THEMES) {
      expect(shadowRgb(theme.app.background, theme.app.text, theme.kind)).not.toBe('0 0 0')
    }
  })
})
