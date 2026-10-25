import { describe, expect, it } from 'vitest'
import { closedAgoShort, closedDayLabel, closedSessionsFor, groupClosedByDay, insertKept } from '../../src/shared/keptSessions'
import type { KeptSession } from '../../src/shared/types'

const session = (sessionId: string, closedAt: number, projectId = 'p1'): KeptSession =>
  ({ projectId, agent: 'claude', sessionId, title: sessionId, closedAt })

describe('closed sessions in the sidebar', () => {
  it('lists the most recently closed first', () => {
    const kept = [session('old', 100), session('newest', 300), session('middle', 200)]
    expect(closedSessionsFor(kept, 'p1', new Set()).map((s) => s.sessionId)).toEqual(['newest', 'middle', 'old'])
  })

  it('keeps only the project and leaves out sessions that are open again', () => {
    const kept = [session('a', 1), session('b', 2, 'p2'), session('c', 3)]
    expect(closedSessionsFor(kept, 'p1', new Set(['claude:c'])).map((s) => s.sessionId)).toEqual(['a'])
  })

  it('does not reorder the stored list', () => {
    const kept = [session('a', 1), session('b', 2)]
    closedSessionsFor(kept, 'p1', new Set())
    expect(kept.map((s) => s.sessionId)).toEqual(['a', 'b'])
  })

  it('says how long ago a session was closed in a few characters', () => {
    const now = 1_000_000_000_000
    expect(closedAgoShort(now - 20_000, now)).toBe('now')
    expect(closedAgoShort(now + 60_000, now)).toBe('now')
    expect(closedAgoShort(now - 5 * 60_000, now)).toBe('5m')
    expect(closedAgoShort(now - 3 * 3_600_000, now)).toBe('3h')
    expect(closedAgoShort(now - 2 * 86_400_000, now)).toBe('2d')
    expect(closedAgoShort(now - 15 * 86_400_000, now)).toBe('2w')
    expect(closedAgoShort(now - 400 * 86_400_000, now)).toBe('1y')
  })
})

describe('putting a removed session back', () => {
  it('inserts at the original index without touching the input', () => {
    const kept = [session('a', 1), session('c', 3)]
    const next = insertKept(kept, session('b', 2), 1)
    expect(next.map((s) => s.sessionId)).toEqual(['a', 'b', 'c'])
    expect(kept).toHaveLength(2)
  })

  it('clamps the index and ignores a session that is already there', () => {
    const kept = [session('a', 1)]
    expect(insertKept(kept, session('z', 9), 50).map((s) => s.sessionId)).toEqual(['a', 'z'])
    expect(insertKept(kept, session('z', 9), -3).map((s) => s.sessionId)).toEqual(['z', 'a'])
    expect(insertKept(kept, session('a', 1), 0)).toHaveLength(1)
  })
})

describe('closed sessions by day', () => {
  const now = new Date(2026, 9, 14, 10).getTime()
  const at = (day: number, hour: number): number => new Date(2026, 9, day, hour).getTime()

  it('uses local calendar days, not 24 hour windows', () => {
    expect(closedDayLabel(at(14, 0), now)).toBe('Today')
    expect(closedDayLabel(at(14, 23), now)).toBe('Today')
    expect(closedDayLabel(at(13, 23), now)).toBe('Yesterday')
    expect(closedDayLabel(at(12, 9), now)).toBe('This week')
    expect(closedDayLabel(at(8, 23), now)).toBe('This week')
    expect(closedDayLabel(at(7, 23), now)).toBe('Earlier')
    expect(closedDayLabel(new Date(2026, 8, 1).getTime(), now)).toBe('Earlier')
  })

  it('groups newest-first sessions and skips empty groups', () => {
    const list = [session('a', at(14, 9)), session('b', at(14, 1)), session('c', at(12, 9)), session('d', at(1, 9))]
    const groups = groupClosedByDay(list, now)
    expect(groups.map((g) => [g.label, g.sessions.map((s) => s.sessionId)])).toEqual([
      ['Today', ['a', 'b']],
      ['This week', ['c']],
      ['Earlier', ['d']]
    ])
    expect(groupClosedByDay([], now)).toEqual([])
  })
})
