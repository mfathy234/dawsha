import { describe, expect, it } from 'vitest'
import { SETTINGS_INDEX, matchesQuery, sectionTitleMatches, sectionsMatching } from '../../src/shared/settingsSearch'

const SECTIONS = [
  { id: 'general', label: 'General', lede: 'Keyboard shortcut, sidebar, recordings and setup.' },
  { id: 'appearance', label: 'Appearance', lede: 'Each style works in both Terminal and Chat.' },
  { id: 'notifications', label: 'Notifications', lede: 'What Dawsha shows and tells you while sessions run.' },
  { id: 'about', label: 'About', lede: 'Version, links and where your data lives.' }
]

describe('matchesQuery', () => {
  it('matches everything for an empty query', () => {
    expect(matchesQuery('', 'anything')).toBe(true)
    expect(matchesQuery('   ', 'anything')).toBe(true)
  })

  it('ignores case and needs every word', () => {
    expect(matchesQuery('WARM tone', 'Tone: Warm greys')).toBe(true)
    expect(matchesQuery('warm sound', 'Tone: Warm greys')).toBe(false)
  })

  it('joins several texts', () => {
    expect(matchesQuery('sleep terminals', 'Terminal rendering', 'Sleep hidden terminals')).toBe(true)
  })
})

describe('sectionsMatching', () => {
  it('keeps all sections for an empty query', () => {
    expect(sectionsMatching(SECTIONS, '')).toHaveLength(4)
  })

  it('finds a section by a row inside it', () => {
    expect(sectionsMatching(SECTIONS, 'sound').map((s) => s.id)).toEqual(['notifications'])
    expect(sectionsMatching(SECTIONS, 'warm').map((s) => s.id)).toEqual(['appearance'])
    expect(sectionsMatching(SECTIONS, 'data folder').map((s) => s.id)).toEqual(['about'])
  })

  it('finds a section by its name or intro', () => {
    expect(sectionsMatching(SECTIONS, 'general').map((s) => s.id)).toEqual(['general'])
    expect(sectionsMatching(SECTIONS, 'keyboard').map((s) => s.id)).toEqual(['general'])
  })

  it('returns nothing when nothing matches', () => {
    expect(sectionsMatching(SECTIONS, 'zzzz')).toEqual([])
  })
})

describe('sectionTitleMatches', () => {
  it('is true only for the name or intro', () => {
    expect(sectionTitleMatches(SECTIONS[1], 'appearance')).toBe(true)
    expect(sectionTitleMatches(SECTIONS[1], 'warm')).toBe(false)
    expect(sectionTitleMatches(SECTIONS[1], '')).toBe(false)
  })
})

describe('SETTINGS_INDEX', () => {
  it('lists rows for every section', () => {
    for (const id of ['general', 'appearance', 'notifications', 'agents', 'mcp', 'import', 'remote', 'updates', 'about']) {
      expect(SETTINGS_INDEX[id]?.length).toBeGreaterThan(0)
    }
  })
})
