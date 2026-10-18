import { describe, expect, it } from 'vitest'
import { buildGroups, flatten, fuzzyMatch, jumpGroup, pushRecent, type PaletteItem } from '../../src/shared/palette'

const item = (id: string, title: string, group: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({
  id,
  title,
  group,
  ...extra
})

const ITEMS: PaletteItem[] = [
  item('s1', '1 - Add dark mode toggle', 'Sessions'),
  item('s2', '2 - Refactor invoice totals', 'Sessions'),
  item('a-new', 'New session', 'Actions'),
  item('a-resume', 'Resume a session', 'Actions'),
  item('a-compare', 'Ask two agents', 'Actions', { keywords: 'compare' }),
  item('p-claude', 'Start Claude in billing-api', 'Projects'),
  item('p-codex', 'Start Codex in billing-api', 'Projects', { searchOnly: true }),
  item('l1', 'Open "Morning"', 'Layouts')
]

describe('fuzzyMatch', () => {
  it('matches everything for an empty query', () => {
    expect(fuzzyMatch('  ', 'anything')).toEqual({ score: 0, indexes: [] })
  })

  it('prefers substrings at a word start over scattered letters', () => {
    const word = fuzzyMatch('res', 'Resume a session')
    const scattered = fuzzyMatch('res', 'Open the recent sessions')
    expect(word?.indexes).toEqual([0, 1, 2])
    expect(scattered).not.toBeNull()
    expect((word?.score ?? 0) > (scattered?.score ?? 0)).toBe(true)
  })

  it('requires every word of the query to match', () => {
    expect(fuzzyMatch('start billing', 'Start Claude in billing-api')).not.toBeNull()
    expect(fuzzyMatch('start docs', 'Start Claude in billing-api')).toBeNull()
  })

  it('falls back to a subsequence and reports the matched letters', () => {
    const match = fuzzyMatch('nse', 'New session')
    expect(match?.indexes).toEqual([0, 4, 5])
    expect(fuzzyMatch('zzz', 'New session')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(fuzzyMatch('CLAUDE', 'Start claude')).not.toBeNull()
  })
})

describe('buildGroups', () => {
  it('lists the groups in the fixed order and hides search-only items when the query is empty', () => {
    const groups = buildGroups(ITEMS, '', [])
    expect(groups.map((g) => g.label)).toEqual(['Sessions', 'Actions', 'Projects', 'Layouts'])
    expect(flatten(groups).map((r) => r.item.id)).not.toContain('p-codex')
  })

  it('puts recent commands first and removes them from their own group', () => {
    const groups = buildGroups(ITEMS, '', ['a-resume', 'gone', 's2'])
    expect(groups[0].label).toBe('Recent')
    expect(groups[0].rows.map((r) => r.item.id)).toEqual(['a-resume', 's2'])
    const actions = groups.find((g) => g.label === 'Actions')
    expect(actions?.rows.map((r) => r.item.id)).toEqual(['a-new', 'a-compare'])
  })

  it('filters across groups, drops empty groups and includes search-only items', () => {
    const groups = buildGroups(ITEMS, 'billing', [])
    expect(groups.map((g) => g.label)).toEqual(['Projects'])
    expect(groups[0].rows.map((r) => r.item.id).sort()).toEqual(['p-claude', 'p-codex'])
  })

  it('matches keywords and ranks the better title match first', () => {
    const byKeyword = buildGroups(ITEMS, 'compare', [])
    expect(flatten(byKeyword).map((r) => r.item.id)).toEqual(['a-compare'])
    const ranked = buildGroups(ITEMS, 'session', [])
    const actions = ranked.find((g) => g.label === 'Actions')
    expect(actions?.rows.map((r) => r.item.id)).toEqual(['a-new', 'a-resume'])
  })

  it('needs a keyword to contain each word of the query instead of matching scattered letters', () => {
    const items = [item('h', 'Continue in Gemini', 'Actions', { keywords: 'handoff switch agent summary' })]
    expect(buildGroups(items, 'docs day', [])).toEqual([])
    expect(buildGroups(items, 'switch agent', [])).toHaveLength(1)
    expect(buildGroups(items, 'SUMMARY', [])).toHaveLength(1)
  })

  it('returns the highlighted indexes of a title match', () => {
    const groups = buildGroups(ITEMS, 'two', [])
    expect(groups[0].rows[0].indexes).toEqual([4, 5, 6])
  })
})

describe('jumpGroup', () => {
  const groups = buildGroups(ITEMS, '', [])

  it('moves to the first row of the next group and wraps', () => {
    expect(jumpGroup(groups, 0, 1)).toBe(2)
    expect(jumpGroup(groups, 3, 1)).toBe(5)
    const last = flatten(groups).length - 1
    expect(jumpGroup(groups, last, 1)).toBe(0)
  })

  it('moves back to the start of the current group first, then to the previous group', () => {
    expect(jumpGroup(groups, 3, -1)).toBe(2)
    expect(jumpGroup(groups, 2, -1)).toBe(0)
    expect(jumpGroup(groups, 0, -1)).toBe(flatten(groups).length - 1)
  })

  it('returns 0 when there are no groups', () => {
    expect(jumpGroup([], 0, 1)).toBe(0)
  })
})

describe('pushRecent', () => {
  it('moves an id to the front without duplicates and caps the list', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(pushRecent(['a', 'b'], 'z', 2)).toEqual(['z', 'a'])
  })
})
