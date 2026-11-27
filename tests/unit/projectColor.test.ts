import { describe, expect, it } from 'vitest'
import { AVATAR_TINT, LIGHT_LETTER_MIX, PROJECT_COLORS, colorOfProject, contrastRatio, isProjectColor, mixHex, projectColor } from '../../src/shared/projectColor'

const DARK = { surface: '#1b1f26', text: '#e8ebf1' }
const LIGHT = { surface: '#f4f5f7', text: '#14181f' }

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

  it('is the approved muted palette', () => {
    expect(PROJECT_COLORS.map((entry) => entry.color)).toEqual(['#7c9cd6', '#8fb38a', '#c58a6b', '#b48ac0', '#6fb3b0', '#c9a66b', '#8a9bb0', '#c07f8f'])
  })

  it('uses the colour picked for a project, and the name-based one otherwise', () => {
    expect(colorOfProject({ name: 'Microtec', color: '#c07f8f' }).color).toBe('#c07f8f')
    expect(colorOfProject({ name: 'Microtec' })).toEqual(projectColor('Microtec'))
    expect(colorOfProject({ name: 'Microtec', color: '#ff0000' })).toEqual(projectColor('Microtec'))
    expect(isProjectColor('#7c9cd6')).toBe(true)
    expect(isProjectColor('#7c9cd7')).toBe(false)
  })

  it.each(PROJECT_COLORS.map((entry) => [entry.name, entry.color] as const))('%s letters pass 4.5:1 on their tint in a dark theme', (_name, color) => {
    expect(contrastRatio(color, mixHex(color, DARK.surface, AVATAR_TINT.dark))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(PROJECT_COLORS.map((entry) => [entry.name, entry.color] as const))('%s letters pass 4.5:1 on their tint in a light theme', (_name, color) => {
    expect(contrastRatio(mixHex(color, LIGHT.text, LIGHT_LETTER_MIX), mixHex(color, LIGHT.surface, AVATAR_TINT.light))).toBeGreaterThanOrEqual(4.5)
  })
})
