import { describe, expect, it } from 'vitest'
import { aggregateWork, workTickets, type WorkItem } from '../../src/shared/workDashboard'
import { filterWorkItems, filterWorkReport, filterWorkTickets, workProjectOptions } from '../../src/shared/workSearch'

const now = new Date(2026, 9, 17, 12).getTime()
const item = (id: string, patch: Partial<WorkItem> = {}): WorkItem => ({
  id, title: 'Investigate login', projectId: 'a', project: 'Alpha', agent: 'claude',
  branch: 'fix/18550', ticket: '#18550', type: 'bug', startedAt: now - 120_000, endedAt: now - 60_000, ...patch
})
const items = Object.freeze([
  Object.freeze(item('one')),
  Object.freeze(item('two', { title: 'Expired token', agent: 'codex' })),
  Object.freeze(item('three', { projectId: 'b', project: 'Beta', title: 'Stock service', branch: 'feat/26412-stock', ticket: '#26412', type: 'feature' })),
  Object.freeze(item('four', { title: 'Explore ideas', branch: null, ticket: null, type: 'conversation', agent: 'gemini' }))
])

describe('Work search', () => {
  it.each(['LOGIN 18550', 'alpha investigate', 'fix/18550 claude code', '#18550', 'expired CODEX'])('matches all words across session fields: %s', query => {
    expect(filterWorkItems(items, query).map(i => i.id)).toEqual(query === 'expired CODEX' ? ['two'] : query === '#18550' ? ['one', 'two'] : ['one'])
  })
  it('handles whitespace, missing fields, no matches and project intersections without mutating input', () => {
    expect(filterWorkItems(items, ' \t\n ')).toEqual(items)
    expect(filterWorkItems(items, 'gemini explore').map(i => i.id)).toEqual(['four'])
    expect(filterWorkItems(items, 'login stock')).toEqual([])
    expect(filterWorkItems(items, 'login', 'b')).toEqual([])
    expect(filterWorkItems(items, '', 'b').map(i => i.id)).toEqual(['three'])
    expect(filterWorkItems(items, '', 'missing')).toEqual([])
  })
  it('matches ticket names, links, branch, number, project and all grouped session titles', () => {
    const tickets = workTickets(items, now - 1_000_000, now)
    const notes = { 'branch:a:fix/18550': { name: 'Customer access', link: 'https://issues.example/urgent' } }
    for (const query of ['customer 18550', 'issues.example alpha', 'urgent token', 'investigate expired', 'FIX/18550', 'login']) {
      const result = filterWorkTickets(tickets, query, null, notes)
      expect(result.map(t => t.key)).toEqual(['branch:a:fix/18550'])
      expect(result[0].items).toHaveLength(2)
      expect(result[0].activeMs).toBe(120_000)
    }
    expect(filterWorkTickets(tickets, 'customer', 'b', notes)).toEqual([])
    expect(filterWorkTickets(tickets, 'unknown', null, notes)).toEqual([])
    expect(filterWorkTickets(tickets, '', 'b', {})).toHaveLength(1)
  })
  it('recomputes searched summary, project totals, time and chart from the same sessions', () => {
    const report = aggregateWork(items, 'today', now)
    const filtered = filterWorkReport(report, '18550', null, now)
    expect(filtered.total).toBe(2)
    expect(filtered.counts).toEqual({ feature: 0, bug: 2, other: 0, conversation: 0 })
    expect(filtered.projects).toEqual([{ projectId: 'a', project: 'Alpha', total: 2, counts: filtered.counts, durationMs: 120_000 }])
    expect(filtered.buckets[0].total).toBe(2)
    expect(filterWorkReport(report, '18550', 'b', now).total).toBe(0)
    expect(report.total).toBe(4)
  })
  it('offers each project with its mode-specific period count, including duplicate names', () => {
    expect(workProjectOptions(items)).toEqual([{ projectId: 'a', project: 'Alpha', count: 3 }, { projectId: 'b', project: 'Beta', count: 1 }])
    expect(workProjectOptions(workTickets(items, 0, now))).toEqual([{ projectId: 'a', project: 'Alpha', count: 1 }, { projectId: 'b', project: 'Beta', count: 1 }])
    expect(workProjectOptions([item('x'), item('y', { projectId: 'b' })])).toHaveLength(2)
    expect(workProjectOptions([])).toEqual([])
  })
})
