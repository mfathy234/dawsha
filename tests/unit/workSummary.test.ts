import { expect, it } from 'vitest'
import { aggregateWork, type WorkItem } from '../../src/shared/workDashboard'
import { formatWorkSummary } from '../../src/shared/workSummary'

const now = new Date(2026, 9, 17, 12).getTime()
const start = new Date(2026, 9, 16, 10).getTime()
const item = (id: string, extra: Partial<WorkItem> = {}): WorkItem => ({
  id, title: 'Repair login', projectId: 'p', project: 'Platforms', type: 'bug', agent: 'claude',
  branch: 'fix/18550', ticket: '#18550', startedAt: start, endedAt: start + 10 * 60_000, ...extra
})
const report = aggregateWork([
  item('a'), item('b', { startedAt: start + 20 * 60_000, endedAt: start + 30 * 60_000 }),
  item('chat', { type: 'conversation', branch: 'main', ticket: null, title: 'Private chat topic' }),
  item('other', { projectId: 'd', project: 'dawsha', type: 'feature', branch: 'feature/dashboard', ticket: null, title: 'Dashboard' })
], 'today', now, start)
const notes = { 'branch:p:fix/18550': { name: 'Login crash on expired token', link: 'https://issues.example/18550' } }

it('groups tickets before counted conversations, uses saved names and links, and totals the shown time', () => {
  expect(formatWorkSummary(report, { now, periodLabel: 'Yesterday', notes })).toBe([
    'Work · Fri, Oct 16 (Yesterday)', '', 'Platforms',
    '- Bug #18550 Login crash on expired token (fix/18550) · 20m · 2 sessions',
    '  https://issues.example/18550', '- 1 conversation · 10m', '', 'dawsha',
    '- Feature Dashboard (feature/dashboard) · 10m', '', 'Total: 2 tickets, 1 conversation · 40m'
  ].join('\n'))
})

it('applies session search before grouping and clips active time to now', () => {
  const today = aggregateWork([item('a', { startedAt: now - 70 * 60_000, endedAt: now, spans: [[now - 70 * 60_000, now + 60_000]] })], 'today', now)
  expect(formatWorkSummary(today, { now, periodLabel: 'Today', query: 'login', projectId: 'p' }))
    .toContain('Total: 1 ticket, 0 conversations · 1h 10m')
  expect(formatWorkSummary(report, { now, periodLabel: 'Yesterday', query: 'no match' }))
    .toContain('Total: 0 tickets, 0 conversations · 0m')
})

it('matches saved ticket notes in Tickets mode and retains every session of the matching ticket', () => {
  const text = formatWorkSummary(report, { now, periodLabel: 'Yesterday', notes, mode: 'tickets', query: 'expired token', projectId: 'p' })
  expect(text).toContain('· 20m · 2 sessions')
  expect(text).toContain('Total: 1 ticket, 0 conversations · 20m')
  expect(text).not.toContain('\ndawsha\n')
})

it('labels week and month ranges, keeps different project IDs separate, and never lists conversation titles', () => {
  const week = aggregateWork([item('a'), item('b', { projectId: 'other' })], 'week', now)
  const text = formatWorkSummary(week, { now, periodLabel: 'This week' })
  expect(text).toMatch(/^Work · Oct 12 – Oct 18 \(This week\)/)
  expect(text.match(/\nPlatforms\n/g)).toHaveLength(2)
  expect(formatWorkSummary({ ...week, period: 'month' }, { now, periodLabel: 'This month' })).toMatch(/^Work · October 2026 \(This month\)/)
  expect(formatWorkSummary(report, { now, periodLabel: 'Yesterday' })).not.toContain('Private chat topic')
})
