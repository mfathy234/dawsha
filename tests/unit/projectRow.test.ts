import { describe, expect, it } from 'vitest'
import { projectRowState } from '../../src/shared/projectStatus'
import { iconSource, iconSourceLine } from '../../src/shared/projectIconSource'
import { migrateSettings } from '../../src/shared/settingsSchema'

describe('projectRowState', () => {
  it('says how many need you, before anything else', () => {
    expect(projectRowState(['needs', 'working', 'needs'])).toEqual({ text: '2 need you', tone: 'needs' })
    expect(projectRowState(['needs'])).toEqual({ text: '1 needs you', tone: 'needs' })
  })

  it('says working, then the number of open sessions, then nothing', () => {
    expect(projectRowState(['working', 'idle'])).toEqual({ text: 'working', tone: 'working' })
    expect(projectRowState(['idle', 'done'])).toEqual({ text: '2', tone: 'count' })
    expect(projectRowState(['exited'])).toBeNull()
    expect(projectRowState([])).toBeNull()
  })
})

describe('iconSource', () => {
  it('tells your own image from a detected file and from initials', () => {
    expect(iconSource({ iconPath: 'C:/logo.png' }, 'site/favicon.svg')).toBe('own')
    expect(iconSource({}, 'site/favicon.svg')).toBe('detected')
    expect(iconSource({ noIcon: true }, 'site/favicon.svg')).toBe('initials')
    expect(iconSource({}, null)).toBe('initials')
  })

  it('words the source line', () => {
    expect(iconSourceLine('detected', 'site/favicon.svg')).toBe('Found in site/favicon.svg')
    expect(iconSourceLine('own', null)).toBe('Your image')
    expect(iconSourceLine('initials', null)).toBe('Initials')
  })
})

describe('project colour in settings', () => {
  const load = (color: unknown): string | undefined => migrateSettings({ projects: [{ id: 'a', name: 'A', folder: 'C:/a', color }] }).projects[0].color

  it('keeps a palette colour and drops anything else', () => {
    expect(load('#7c9cd6')).toBe('#7c9cd6')
    expect(load('#ff0000')).toBeUndefined()
    expect(load(12)).toBeUndefined()
  })
})
