import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkService, sessionWorkItems, workCommits } from '../../src/main/workDashboard'
import type { ResumeSession } from '../../src/shared/types'

const session = (overrides: Partial<ResumeSession> = {}): ResumeSession => ({
  id: 's', agent: 'claude', projectId: 'p', title: 'Stock service', startedAt: 1000,
  modifiedAt: 9000, lastActivityAt: 2000, messageCount: 2, workBranch: 'feature/26412-stock', ...overrides
})
const projects = [{ id: 'p', name: 'Project', folder: 'C:/project', defaultAgent: 'claude' as const }]

// 'today' reports start at local midnight, so tests that build spans back from now pin the
// clock to a time of day that leaves room for them (only Date, so fs and timers stay real).
const pinClock = (hour: number, minute = 0): number => {
  const at = new Date()
  at.setHours(hour, minute, 0, 0)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at)
  return at.getTime()
}
afterEach(() => { vi.useRealTimers() })
it('classifies indexed sessions and drops duplicates', async () => {
  const items = await sessionWorkItems([session(), session()], projects, async () => ['fix: crash'])
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ type: 'bug', branch: 'feature/26412-stock', ticket: '#26412', startedAt: 1000, endedAt: 2000 })
})
it('reads commits from the recorded branch and time window, all authors, safely', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'dawsha-work-git-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, windowsHide: true, env: { ...process.env,
    GIT_AUTHOR_NAME: 'Work Test', GIT_AUTHOR_EMAIL: 'work@example.invalid', GIT_COMMITTER_NAME: 'Work Test', GIT_COMMITTER_EMAIL: 'work@example.invalid',
    GIT_AUTHOR_DATE: '2026-10-16T10:30:00Z', GIT_COMMITTER_DATE: '2026-10-16T10:30:00Z' } }).toString()
  git('init', '-b', 'feature/123')
  // This case exercises all authors; do not inherit the developer's global author filter.
  git('config', 'user.email', '')
  git('commit', '--allow-empty', '-m', 'feat: stock')
  git('checkout', '-b', 'fix/456')
  git('commit', '--allow-empty', '-m', 'fix: unrelated')
  const start = Date.parse('2026-10-16T10:00:00Z'), end = Date.parse('2026-10-16T11:00:00Z')
  expect(await workCommits(repo, 'feature/123', start, end)).toEqual(['feat: stock'])
  expect(await workCommits(repo, 'feature/123', end, end + 1000)).toEqual([])
  expect(await workCommits(repo, '--all', start, end)).toEqual([])
  expect(await workCommits(repo, 'missing', start, end)).toEqual([])
})
it('coalesces concurrent requests and reuses snapshots without scanning on construction', async () => {
  let scans = 0
  const service = new WorkService(async () => { scans++; return [] })
  expect(scans).toBe(0)
  const reports = await Promise.all([service.report('today', projects), service.report('today', projects)])
  expect(scans).toBe(1)
  expect(reports[0]).toEqual(reports[1])
  await service.report('week', projects)
  expect(scans).toBe(1)
})

it('reads exact spans only for the requested period, stays lazy, and notices transcript changes on refresh', async () => {
  const now = pinClock(12)
  const path = join(mkdtempSync(join(tmpdir(), 'dawsha-work-exact-')), 'session.jsonl')
  const start = now - 20 * 60_000
  const records = (minutes: number[]) => minutes.map(m => JSON.stringify({ timestamp: new Date(start + m * 60_000).toISOString() })).join('\n')
  writeFileSync(path, records([0, 4, 8, 12]))
  const service = new WorkService(async () => [
    { ...session({ startedAt: start, lastActivityAt: now - 60_000, activeSpans: [[start, start + 60_000]] }), sourcePath: path },
    { ...session({ id: 'old', startedAt: 1000, lastActivityAt: 2000 }), sourcePath: path + '.missing' }
  ])
  const first = await service.report('today', projects)
  expect(first.items).toHaveLength(1)
  expect(first.projects[0].durationMs).toBe(12 * 60_000)
  writeFileSync(path, records([0, 4, 8, 12, 16]))
  const refreshed = await service.report('today', projects)
  expect(refreshed.projects[0].durationMs).toBe(16 * 60_000)
})

it('keeps readable work visible when another indexed transcript is deleted or inaccessible', async () => {
  const now = pinClock(12), start = now - 10 * 60_000
  const path = join(mkdtempSync(join(tmpdir(), 'dawsha-work-missing-')), 'session.jsonl')
  writeFileSync(path, JSON.stringify({ timestamp: new Date(start).toISOString() }))
  const service = new WorkService(async () => [
    { ...session({ startedAt: start, lastActivityAt: now - 1000 }), sourcePath: path },
    { ...session({ id: 'missing', startedAt: start, lastActivityAt: now - 1000 }), sourcePath: path + '.missing' }
  ])
  const report = await service.report('today', projects)
  expect(report.items).toHaveLength(1)
  expect(report.projects[0].durationMs).toBe(60_000)
})
