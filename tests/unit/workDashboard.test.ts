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
    const originalZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    process.env.TZ = 'America/New_York'
    try {
      const window = workWindow('today', new Date(2026, 2, 8, 12).getTime())
      expect(window.end - window.start).toBe(23 * 3_600_000)
      expect(new Date(window.end).getHours()).toBe(0)
    } finally {
      if (previous === undefined) {
        // On Windows, deleting TZ alone leaves Node's timezone cache on the assigned zone.
        process.env.TZ = originalZone
        delete process.env.TZ
      }
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
    // Time spent is the part inside today only: an item that started yesterday counts from midnight.
    expect(report.projects.map(p => [p.project, p.total, p.durationMs])).toEqual([['Alpha', 3, 39600000], ['Beta', 1, 3600000]])
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

describe('active time', () => {
  it('merges activity into spans and counts only the active part inside the period', async () => {
    const { activeSpans } = await import('../../src/shared/sessionDetail')
    const { activeMs } = await import('../../src/shared/workDashboard')
    const min = 60_000
    // Two bursts an hour apart: 10 and 4 minutes of work, not the 74 minutes from first to last.
    const spans = activeSpans([0, 3 * min, 6 * min, 10 * min, 70 * min, 74 * min])
    expect(spans).toEqual([[0, 10 * min], [70 * min, 74 * min]])
    expect(activeMs({ startedAt: 0, endedAt: 74 * min, spans }, 0, 100 * min)).toBe(14 * min)
    // Only the part inside the period counts: a session left open across days.
    expect(activeMs({ startedAt: 0, endedAt: 74 * min, spans }, 72 * min, 100 * min)).toBe(2 * min)
    // A lone message is a minute of work.
    expect(activeSpans([5 * min])).toEqual([[5 * min, 6 * min]])
  })
})

describe('tickets', () => {
  it('counts the sessions on one branch of one project as one ticket, typed by its strongest evidence', async () => {
    const { workTickets } = await import('../../src/shared/workDashboard')
    const tickets = workTickets([
      item('s1', { branch: 'fix/18550', ticket: '#18550', type: 'conversation', title: 'Look at login', startedAt: stamp(16, 8), endedAt: stamp(16, 9) }),
      item('s2', { branch: 'fix/18550', ticket: '#18550', type: 'bug', title: 'Fix login', endedAt: stamp(16, 11) }),
      item('s3', { branch: 'feature/26412-stock', ticket: '#26412', type: 'feature' }),
      // Same branch name in another project is another ticket.
      item('s4', { branch: 'feature/26412-stock', ticket: '#26412', projectId: 'b', project: 'Beta' }),
      // A chat on a base branch is not a ticket; commits on it are their own ticket.
      item('s5', { branch: 'main', type: 'conversation' }),
      item('s6', { branch: 'main', type: 'bug', title: 'Hotfix on main' }),
      item('s7', { branch: null, type: 'conversation' }),
      // A run is its own ticket.
      item('run_1', { agent: 'orchestrator', branch: 'orch/abc/run', type: 'feature', title: 'Run' })
    ], 0, stamp(17, 0))
    expect(tickets.map((t) => [t.project, t.ticket, t.type, t.items.map((i) => i.id)])).toEqual([
      ['Alpha', '#18550', 'bug', ['s2', 's1']],
      ['Alpha', '#26412', 'feature', ['s3']],
      ['Beta', '#26412', 'feature', ['s4']],
      ['Alpha', null, 'bug', ['s6']],
      ['Alpha', null, 'feature', ['run_1']]
    ].sort(() => 0))
    const fix = tickets.find((t) => t.ticket === '#18550')!
    expect(fix.title).toBe('Look at login')
    expect(fix.activeMs).toBe(2 * 3_600_000)
  })

  it('types a ticket whose sessions only talked from its branch name', async () => {
    const { workTickets } = await import('../../src/shared/workDashboard')
    expect(workTickets([item('s1', { branch: 'feature/x', type: 'conversation' })], 0, stamp(17, 0))[0].type).toBe('feature')
    expect(workTickets([item('s1', { branch: 'spike/x', type: 'conversation' })], 0, stamp(17, 0))[0].type).toBe('other')
  })
})

describe('stepping through periods', () => {
  it('moves the anchor back a day, a week or a month, and never past now', async () => {
    const { shiftAnchor } = await import('../../src/shared/workDashboard')
    expect(workWindow('today', shiftAnchor('today', now, -1))).toEqual({ start: stamp(15, 0), end: stamp(16, 0) })
    expect(workWindow('week', shiftAnchor('week', now, -1)).start).toBe(stamp(5, 0))
    // From October 31 one month back is September, not October 1 again.
    const lateMonth = new Date(2026, 9, 31, 12).getTime()
    expect(new Date(workWindow('month', shiftAnchor('month', lateMonth, -1)).start).getMonth()).toBe(8)
    expect(shiftAnchor('today', now, 3)).toBe(now)
  })

  it('counts a past period up to its own end and reports its range', () => {
    const items = [item('yesterday', { endedAt: stamp(15, 23) }), item('today', { endedAt: stamp(16, 9) })]
    const past = aggregateWork(items, 'today', now, stamp(15, 12))
    expect(past.items.map((i) => i.id)).toEqual(['yesterday'])
    expect([past.start, past.end]).toEqual([stamp(15, 0), stamp(16, 0)])
    expect(aggregateWork(items, 'today', now).items.map((i) => i.id)).toEqual(['today'])
  })
})
