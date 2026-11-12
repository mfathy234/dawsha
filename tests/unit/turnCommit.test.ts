import { describe, expect, it } from 'vitest'
import { commitButtonLabel, commitNote, commitTypeFor, initialTicks, suggestCommitMessage } from '../../src/shared/turnCommit'

describe('suggestCommitMessage', () => {
  it('writes a conventional subject from the reply when it is short enough', () => {
    expect(suggestCommitMessage({ request: 'Fix date parsing', reply: 'Dates without a time zone are now read as UTC.\n\nI changed parseDate.' })).toBe('fix: dates without a time zone are now read as UTC')
  })

  it('falls back to the request when the reply has nothing usable', () => {
    expect(suggestCommitMessage({ request: 'Add a retry to the sender', reply: 'Done.' })).toBe('feat: add a retry to the sender')
  })

  it('drops filler openings and markdown from the reply', () => {
    expect(suggestCommitMessage({ request: 'tidy the sidebar', reply: "## Sure, I've renamed the sidebar helpers" })).toBe('refactor: renamed the sidebar helpers')
  })

  it('keeps the subject to 72 characters', () => {
    const message = suggestCommitMessage({ request: 'add things', reply: `${'word '.repeat(30)}end` })
    expect(message.length - 'feat: '.length).toBeLessThanOrEqual(72)
  })

  it('still gives a message when both are empty', () => {
    expect(suggestCommitMessage({ request: '', reply: '' })).toBe('chore: update files')
  })
})

describe('commitTypeFor', () => {
  it.each([
    ['fix the crash', 'fix'],
    ['make it faster', 'perf'],
    ['rename the helper', 'refactor'],
    ['update the readme', 'docs'],
    ['write tests for the parser', 'test'],
    ['add a tests folder', 'feat'],
    ['hello', 'chore']
  ])('%s is %s', (request, type) => {
    expect(commitTypeFor(request)).toBe(type)
  })
})

describe('commit wording', () => {
  it('says how many files and how many others stay out', () => {
    expect(commitNote(2, 'fix/date-parsing', 3)).toBe('Commits these 2 files on fix/date-parsing. 3 other changed files stay uncommitted.')
    expect(commitNote(1, 'main', 1)).toBe('Commits this file on main. 1 other changed file stays uncommitted.')
    expect(commitNote(2, '', 0)).toBe('Commits these 2 files.')
  })

  it('names the button after the count', () => {
    expect(commitButtonLabel(1)).toBe('Commit 1 file')
    expect(commitButtonLabel(4)).toBe('Commit 4 files')
  })

  it('unticks files that also have other changes', () => {
    expect(initialTicks([{ path: 'a', other: false }, { path: 'b', other: true }])).toEqual(['a'])
  })
})
