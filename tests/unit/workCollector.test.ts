import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { WorkService, sessionWorkItems, runWorkItems, workCommits, readWorkRuns } from '../../src/main/workDashboard'
import { OrchStore } from '../../src/main/orch/store'
import type { ResumeSession } from '../../src/shared/types'

const session = (overrides: Partial<ResumeSession> = {}): ResumeSession => ({
  id: 's', agent: 'claude', projectId: 'p', title: 'Stock service', startedAt: 1000,
  modifiedAt: 9000, lastActivityAt: 2000, messageCount: 2, workBranch: 'feature/26412-stock', ...overrides
})
const projects = [{ id: 'p', name: 'Project', folder: 'C:/project', defaultAgent: 'claude' as const }]
it('classifies indexed sessions and drops orchestrator children and duplicates', async () => {
  const items = await sessionWorkItems([session(), session(), session({ id: 'child', workBranch: 'orch/abcdefgh/t-1' })], projects,
    ['orch/abcdefgh/run'], async () => ['fix: crash'])
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ type: 'bug', branch: 'feature/26412-stock', ticket: '#26412', startedAt: 1000, endedAt: 2000 })
})
it('types runs by kind and uses latest task/event activity for unfinished runs', () => {
  const items = runWorkItems([{ id: 'run_x', title: 'Repair', kind: 'bug', projectId: 'p', projectPath: 'C:/project', branch: 'orch/x/run', createdAt: 1000, finishedAt: null,
    tasks: [{ updatedAt: 3000 }], events: [{ at: 4000 }] }], projects)
  expect(items[0]).toMatchObject({ type: 'bug', agent: 'orchestrator', startedAt: 1000, endedAt: 4000 })
})
it('reads commits from the recorded branch and time window, all authors, safely', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'dawsha-work-git-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, windowsHide: true, env: { ...process.env,
    GIT_AUTHOR_NAME: 'Work Test', GIT_AUTHOR_EMAIL: 'work@example.invalid', GIT_COMMITTER_NAME: 'Work Test', GIT_COMMITTER_EMAIL: 'work@example.invalid',
    GIT_AUTHOR_DATE: '2026-10-16T10:30:00Z', GIT_COMMITTER_DATE: '2026-10-16T10:30:00Z' } }).toString()
  git('init', '-b', 'feature/123')
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
  const reports = await Promise.all([service.report('today', projects, []), service.report('today', projects, [])])
  expect(scans).toBe(1)
  expect(reports[0]).toEqual(reports[1])
  await service.report('week', projects, [])
  expect(scans).toBe(1)
})

it('reads persisted run history even when orchestration is disabled, suppressing branchless child sessions', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'dawsha-work-runs-')), 'orchestrator.db')
  const store = new OrchStore(path)
  const run = { id: 'run_abcdefgh', kind: 'feature' as const, projectPath: 'C:/project', projectId: 'p', title: 'Stock', story: '', plan: '', stage: 'done' as const, createdAt: 1000, finishedAt: 2000 }
  store.putRun(run)
  store.putAgent({ id: 'a', runId: run.id, role: 'lead', runner: 'claude', model: '', token: 'test-token', taskId: null, createdAt: 1000, usage: null,
    launch: { agent: 'claude', args: ['--session-id', 'child'], env: {}, files: [] } })
  store.close()
  const runs = await readWorkRuns(path)
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({ id: run.id, workSessionIds: ['child'], branch: 'orch/abcdefgh/run' })
  expect(await sessionWorkItems([session({ id: 'child', workBranch: null })], projects, runs.map(r => r.branch), async () => [], runs.flatMap(r => r.workSessionIds ?? []))).toEqual([])
  expect(await readWorkRuns(path + '.missing')).toEqual([])
})
