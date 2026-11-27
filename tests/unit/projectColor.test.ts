import { describe, expect, it } from 'vitest'
import { PROJECT_COLORS, contrastRatio, projectColor } from '../../src/shared/projectColor'

describe('projectColor', () => {
  it('gives the same colour for the same name, ignoring case and spaces', () => {
    expect(projectColor('Microtec')).toEqual(projectColor('  microtec '))
  })

  it('spreads different names over the palette', () => {
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima']
    expect(new Set(names.map((name) => projectColor(name).name)).size).toBeGreaterThan(4)
  })

  it('always returns a palette entry, even for an empty name', () => {
    expect(PROJECT_COLORS).toContainEqual(projectColor(''))
  })

  it.each(PROJECT_COLORS.map((color) => [color.name, color] as const))('%s text passes 4.5:1 on its fill', (_name, color) => {
    expect(contrastRatio(color.bg, color.fg)).toBeGreaterThanOrEqual(4.5)
  })
})
