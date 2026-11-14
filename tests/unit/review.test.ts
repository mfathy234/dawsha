import { describe, expect, it } from 'vitest'
import { draftCommitMessage, selectCommitFiles, stepReview } from '../../src/shared/review'

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
