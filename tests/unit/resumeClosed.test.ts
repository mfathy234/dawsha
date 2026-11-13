import { describe, expect, it } from 'vitest'
import { closedFor, closedTitle, reopenAllLabel, reopenTargets } from '../../src/shared/resumeClosed'
import type { KeptSession, ResumeSession } from '../../src/shared/types'

const resume = (id: string, title = id): ResumeSession => ({ agent: 'claude', id, title, projectId: 'p', modifiedAt: 1, startedAt: 1, messageCount: 1 })
const kept = (id: string, extra: Partial<KeptSession> = {}): KeptSession => ({ projectId: 'p', agent: 'claude', sessionId: id, title: id, closedAt: 1, ...extra })

describe('closedFor', () => {
  it('finds the kept entry for a row that is not open', () => {
    expect(closedFor(resume('a'), [kept('a')], new Set())?.sessionId).toBe('a')
  })
  it('ignores sessions that are open or were never kept', () => {
    expect(closedFor(resume('a'), [kept('a')], new Set(['claude:a']))).toBeUndefined()
    expect(closedFor(resume('b'), [kept('a')], new Set())).toBeUndefined()
  })
})

describe('closedTitle', () => {
  it('shows the user name only when the session was renamed', () => {
    expect(closedTitle(resume('a', 'Agent title'), kept('a', { title: 'Mine', renamed: true }))).toBe('Mine')
    expect(closedTitle(resume('a', 'Agent title'), kept('a', { title: 'Old agent title' }))).toBe('Agent title')
    expect(closedTitle(resume('a', 'Agent title'), undefined)).toBe('Agent title')
  })

  it('shortens closed titles only for display and preserves manual titles', () => {
    const long = 'Please fix the failing invoice export and add regression coverage today'
    const entry = resume('a', long)
    expect(closedTitle(entry, undefined)).toBe('Fix the failing invoice export')
    expect(entry.title).toBe(long)
    expect(closedTitle({ ...entry, nameSource: 'user' }, undefined)).toBe(long)
    expect(closedTitle(entry, kept('a', { title: long, renamed: true }))).toBe(long)
  })
})

describe('reopenTargets', () => {
  const entries = [kept('a'), kept('b'), kept('c', { projectId: 'q' })]
  it('needs at least two closed sessions of one project', () => {
    expect(reopenTargets([resume('a'), resume('b')], entries, new Set())?.sessions.map((s) => s.sessionId)).toEqual(['a', 'b'])
    expect(reopenTargets([resume('a')], entries, new Set())).toBeNull()
    expect(reopenTargets([resume('a'), resume('b')], entries, new Set(['claude:b']))).toBeNull()
  })
  it('gives no target when the group mixes projects', () => {
    expect(reopenTargets([resume('a'), resume('c')], entries, new Set())).toBeNull()
  })
})

describe('reopenAllLabel', () => {
  it('names count, day and project', () => {
    expect(reopenAllLabel(3, 'Today', 'Smoke')).toBe('Reopen 3 closed sessions from Today in Smoke')
    expect(reopenAllLabel(1, 'Older', 'Smoke')).toBe('Reopen 1 closed session from Older in Smoke')
  })
})
