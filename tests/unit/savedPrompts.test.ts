import { describe, expect, it } from 'vitest'
import {
  SAVED_PROMPTS_MAX,
  addSavedPrompt,
  mergeSavedPrompts,
  promptNameFrom,
  removeSavedPrompt,
  renameSavedPrompt,
  sanitizeSavedPrompts,
  savedCompletionRows,
  validatePromptName,
  withoutToken,
  type SavedPrompt
} from '../../src/shared/savedPrompts'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'

const p = (id: string, name: string, text = `text of ${name}`): SavedPrompt => ({ id, name, text })

describe('sanitizeSavedPrompts', () => {
  it('keeps well-formed prompts and drops the rest', () => {
    const raw = [p('a', 'Review'), { id: 'b', name: '  ', text: 'x' }, { id: 'c', name: 'No text', text: '   ' }, 7, null, { name: 'No id', text: 'x' }]
    expect(sanitizeSavedPrompts(raw)).toEqual([p('a', 'Review')])
  })
  it('drops duplicate ids and names, ignoring case', () => {
    expect(sanitizeSavedPrompts([p('a', 'Review'), p('a', 'Other'), p('b', 'review')])).toEqual([p('a', 'Review')])
  })
  it('limits the count and the lengths', () => {
    const many = Array.from({ length: SAVED_PROMPTS_MAX + 10 }, (_, i) => p(`i${i}`, `Name ${i}`))
    expect(sanitizeSavedPrompts(many)).toHaveLength(SAVED_PROMPTS_MAX)
    expect(sanitizeSavedPrompts([p('a', 'x'.repeat(500))])[0].name.length).toBeLessThanOrEqual(60)
    expect(sanitizeSavedPrompts('nope')).toEqual([])
  })
})

describe('editing', () => {
  it('adds, renames and removes without changing the original', () => {
    const start = [p('a', 'One')]
    const added = addSavedPrompt(start, p('b', 'Two'))
    expect(start).toHaveLength(1)
    expect(added.map((x) => x.name)).toEqual(['One', 'Two'])
    expect(renameSavedPrompt(added, 'b', 'Second').map((x) => x.name)).toEqual(['One', 'Second'])
    expect(removeSavedPrompt(added, 'a').map((x) => x.id)).toEqual(['b'])
  })
})

describe('validatePromptName', () => {
  it('asks for a name and refuses one already used', () => {
    const list = [p('a', 'Review')]
    expect(validatePromptName('  ', list)).toMatch(/name/i)
    expect(validatePromptName('review', list)).toMatch(/already/i)
    expect(validatePromptName('review', list, 'a')).toBeNull()
    expect(validatePromptName('Ship it', list)).toBeNull()
  })
})

describe('promptNameFrom', () => {
  it('suggests the first words of the prompt', () => {
    expect(promptNameFrom('Review this pull request for security problems and style issues please')).toBe('Review this pull request for security problems')
    expect(promptNameFrom('\n  Short one\nsecond')).toBe('Short one')
  })
})

describe('savedCompletionRows', () => {
  const list = [p('a', 'Review PR'), p('b', 'Ship notes')]
  it('lists saved prompts first, then the save row', () => {
    const rows = savedCompletionRows(list, '')
    expect(rows.map((row) => row.kind)).toEqual(['saved', 'saved', 'save'])
    expect(rows[0]).toMatchObject({ name: 'Review PR', id: 'a' })
  })
  it('filters by what is typed', () => {
    expect(savedCompletionRows(list, 'ship').map((row) => row.name)).toEqual(['Ship notes'])
    expect(savedCompletionRows(list, 'sav').map((row) => row.kind)).toEqual(['save'])
  })
})

describe('withoutToken', () => {
  it('takes a command token out of the box and trims what is left', () => {
    expect(withoutToken('/save  Review this please', { start: 0, end: 5 })).toBe('Review this please')
    expect(withoutToken('Review this\n/save', { start: 12, end: 17 })).toBe('Review this')
  })
})

describe('mergeSavedPrompts', () => {
  it('replace takes the incoming list', () => {
    expect(mergeSavedPrompts([p('a', 'One')], [p('b', 'Two')], 'replace')).toEqual([p('b', 'Two')])
  })
  it('merge adds incoming prompts whose name is new', () => {
    const merged = mergeSavedPrompts([p('a', 'One')], [p('x', 'one', 'different'), p('b', 'Two')], 'merge')
    expect(merged.map((x) => x.name)).toEqual(['One', 'Two'])
  })
  it('merge gives an incoming prompt a fresh id when its id is taken', () => {
    const merged = mergeSavedPrompts([p('a', 'One')], [p('a', 'Two')], 'merge')
    expect(new Set(merged.map((x) => x.id)).size).toBe(2)
  })
})

describe('settings', () => {
  it('defaults to none and survives a migrate', () => {
    expect(defaultSettings().savedPrompts).toEqual([])
    expect(migrateSettings({ savedPrompts: [p('a', 'One'), { bad: true }] }).savedPrompts).toEqual([p('a', 'One')])
  })
})
