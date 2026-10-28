import { describe, expect, it } from 'vitest'
import { buildReviewMessage, draftCommitMessage, orderedComments, selectCommitFiles, stepReview } from '../../src/shared/review'

const c = (path: string, line: number, text: string, id = `${path}:${line}`) => ({ id, path, line, text })

describe('buildReviewMessage', () => {
  it('lists file:line references in file and line order', () => {
    const message = buildReviewMessage([c('b.ts', 2, 'two'), c('a.ts', 30, 'late'), c('a.ts', 4, 'early')])
    expect(message.split('\n')).toEqual(['Review of your changes: 3 comments.', '', 'a.ts:4  early', 'a.ts:30  late', 'b.ts:2  two'])
  })
  it('adds the overall note when there is one', () => {
    expect(buildReviewMessage([c('a.ts', 1, 'x')], '  looks good\nmostly ')).toBe('Review of your changes: 1 comment.\n\na.ts:1  x\n\nOverall: looks good mostly')
  })
  it('uses project-relative paths inside a sub folder project', () => {
    expect(buildReviewMessage([c('pkg/web/a.ts', 1, 'x')], '', 'pkg/web')).toContain('\na.ts:1  x')
  })
  it('keeps each comment on one line so it cannot submit early', () => {
    expect(buildReviewMessage([c('a.ts', 1, 'one\ntwo\r\nthree')])).toContain('a.ts:1  one two three')
  })
  it('is empty without comments, and drops blank ones', () => {
    expect(buildReviewMessage([], 'note')).toBe('')
    expect(orderedComments([c('a.ts', 1, '  ')])).toEqual([])
  })
})

describe('commit file selection and draft', () => {
  it('removes the unticked files and keeps the order', () => {
    expect(selectCommitFiles(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c'])
    expect(selectCommitFiles(['a'], new Set(['a']))).toEqual([])
  })
  it('drafts from the session name first', () => {
    expect(draftCommitMessage({ sessionTitle: ' Fix  the sidebar ', paths: ['a.ts'] })).toBe('Fix the sidebar')
  })
  it('ignores a generic session name and uses a plan title', () => {
    expect(draftCommitMessage({ sessionTitle: 'Claude 2', paths: ['src/a.ts', 'docs/plans/2026-10-17-work-search.md'] })).toBe('Work search')
  })
  it('falls back to a count', () => {
    expect(draftCommitMessage({ paths: ['src/a.ts'] })).toBe('Update a.ts')
    expect(draftCommitMessage({ paths: ['a', 'b'] })).toBe('Update 2 files')
    expect(draftCommitMessage({ paths: [] })).toBe('')
  })
})

describe('stepReview', () => {
  it('moves and wraps', () => {
    expect(stepReview(3, 0, 1)).toBe(1)
    expect(stepReview(3, 2, 1)).toBe(0)
    expect(stepReview(3, 0, -1)).toBe(2)
    expect(stepReview(3, -1, 1)).toBe(0)
    expect(stepReview(3, -1, -1)).toBe(2)
    expect(stepReview(0, 0, 1)).toBe(-1)
  })
})
