import { describe, expect, it } from 'vitest'
import { classifyWork, ticketFromBranch, workWindow, aggregateWork, type WorkItem } from '../../src/shared/workDashboard'

describe('work classification', () => {
  it.each([
    ['fix/18550', [], 'bug'], ['bugfix/login', [], 'bug'], ['hotfix/a', [], 'bug'], ['bug/a', [], 'bug'],
    ['feature/26412-stock', [], 'feature'], ['feat/a', [], 'feature'],
    ['main', ['fix: crash'], 'bug'], ['main', ['fix(ui): crash'], 'bug'],
    ['main', ['feat: chart'], 'feature'], ['main', ['feat(ui): chart'], 'feature'],
    ['feature/a', ['fix: crash'], 'bug'], ['fix/a', ['feat: chart'], 'bug'],
    ['main', ['feat: chart', 'fix(ui): crash'], 'bug'],
    ['main', ['docs: guide'], 'other'], ['main', [], 'conversation'],
    ['prefix/fix/a', ['prefix fix: nope'], 'other'], ['featureless', [], 'conversation']
  ])('%s and %j become %s', (branch, commits, expected) => {
    expect(classifyWork(branch, commits as string[])).toBe(expected)
  })
  it.each([['fix/18550', '#18550'], ['feature/26412-service-stock', '#26412'], ['feat/ABC-123-name', '#123'], ['main', null], ['feature/v2', null]])('extracts a ticket from %s', (branch, expected) => {
    expect(ticketFromBranch(branch)).toBe(expected)
  })
})

const now = new Date(2026, 9, 16, 12).getTime()
const stamp = (day: number, hour = 10) => new Date(2026, 9, day, hour).getTime()
const item = (id: string, overrides: Partial<WorkItem> = {}): WorkItem => ({
  id, title: id, projectId: 'a', project: 'Alpha', type: 'feature', agent: 'claude',
  branch: null, ticket: null, startedAt: stamp(16), endedAt: stamp(16, 11), ...overrides
})

describe('local calendar periods', () => {
  it('uses midnight today and an exclusive next midnight', () => {
    expect(workWindow('today', now)).toEqual({ start: stamp(16, 0), end: stamp(17, 0) })
  })
  it('starts weeks on Monday, including when today is Sunday', () => {
    expect(workWindow('week', now)).toEqual({ start: stamp(12, 0), end: stamp(19, 0) })
    expect(workWindow('week', stamp(18))).toEqual({ start: stamp(12, 0), end: stamp(19, 0) })
  })
  it('handles month and year transitions', () => {
    expect(workWindow('month', new Date(2026, 11, 31).getTime())).toEqual({ start: new Date(2026, 11, 1).getTime(), end: new Date(2027, 0, 1).getTime() })
    expect(workWindow('week', new Date(2027, 0, 1).getTime()).start).toBe(new Date(2026, 11, 28).getTime())
  })
  it('handles leap February and preserves local midnight across DST', () => {
    expect(workWindow('month', new Date(2028, 1, 29, 12).getTime())).toEqual({ start: new Date(2028, 1, 1).getTime(), end: new Date(2028, 2, 1).getTime() })
    const previous = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      const window = workWindow('today', new Date(2026, 2, 8, 12).getTime())
      expect(window.end - window.start).toBe(23 * 3_600_000)
      expect(new Date(window.end).getHours()).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.TZ
      else process.env.TZ = previous
    }
  })
})

describe('aggregation', () => {
  it('counts each item once on its last activity day; excludes future and out-of-period items', () => {
    const report = aggregateWork([
      item('one', { startedAt: stamp(15), endedAt: stamp(16, 9) }),
      item('two', { type: 'bug', projectId: 'b', project: 'Beta' }),
      item('three', { type: 'other' }), item('four', { type: 'conversation' }),
      item('old', { endedAt: stamp(15) }), item('future', { endedAt: stamp(17, 0) })
    ], 'today', now)
    expect(report.total).toBe(4)
    expect(report.counts).toEqual({ feature: 1, bug: 1, other: 1, conversation: 1 })
    expect(report.projects.map(p => [p.project, p.total, p.durationMs])).toEqual([['Alpha', 3, 90000000], ['Beta', 1, 3600000]])
    expect(report.items.map(i => i.id)).toEqual(['two', 'three', 'four', 'one'])
    expect(report.buckets[0].counts).toEqual(report.counts)
  })
  it('zero fills days and sums durations without mutating input', () => {
    const items = Object.freeze([Object.freeze(item('one', { endedAt: stamp(16, 9) }))])
    const report = aggregateWork(items, 'week', now)
    expect(report.buckets).toHaveLength(7)
    expect(report.buckets[0]).toMatchObject({ key: '2026-10-12', total: 0 })
    expect(report.projects[0].durationMs).toBe(0)
    expect(aggregateWork([], 'month', now).buckets).toHaveLength(31)
    expect(aggregateWork([], 'today', now).total).toBe(0)
  })
})
