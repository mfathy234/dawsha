import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { branchNameProblem } from '../shared/gitBranches'
import { aggregateWork, classifyWork, ticketFromBranch, workWindow, type WorkItem, type WorkPeriod, type WorkReport } from '../shared/workDashboard'
import type { Project, ResumeSession } from '../shared/types'
import { normalizePath } from '../shared/sessionMatch'
import { listSessionSources } from './sessionIndex'
import { runBranch } from './orch/worktrees'
import type { OrchAgent, OrchEvent, OrchRun, OrchTask } from '../shared/orch/types'

const TTL = 10_000
const commitCache = new Map<string, { at: number; job: Promise<string[]> }>()
type CommitReader = (folder: string, branch: string | null, start: number, end: number) => Promise<string[]>

/** Read-only, argument-safe git query, with no author filter. Never changes a worktree. */
export const workCommits: CommitReader = (folder, branch, start, end) => {
  if ((branch && branchNameProblem(branch)) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return Promise.resolve([])
  const key = JSON.stringify([folder, branch, start, end])
  const cached = commitCache.get(key)
  if (cached && Date.now() - cached.at < TTL) return cached.job
  const job = new Promise<string[]>((resolve) => {
    execFile('git', ['log', '--format=%s', `--since=${new Date(start).toISOString()}`, `--until=${new Date(end).toISOString()}`,
      branch ? `refs/heads/${branch}` : 'HEAD', '--'], { cwd: folder, windowsHide: true, timeout: 3000, maxBuffer: 2 * 1024 * 1024 },
    (error, stdout) => resolve(error ? [] : stdout.trim().split('\n').filter(Boolean)))
  })
  if (commitCache.size >= 2000) commitCache.delete(commitCache.keys().next().value!)
  commitCache.set(key, { at: Date.now(), job })
  return job
}

export interface WorkRun {
  id: string
  title: string
  kind: 'feature' | 'bug'
  projectId: string | null
  projectPath: string
  branch: string
  createdAt: number
  finishedAt: number | null
  tasks: readonly { updatedAt: number }[]
  events: readonly { at: number }[]
  workSessionIds?: readonly string[]
}

/** History stays visible with the experimental runtime off. Open the existing store read-only on demand. */
export async function readWorkRuns(path: string): Promise<WorkRun[]> {
  try { await access(path) } catch { return [] }
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const records = <T>(table: string): T[] => (db.prepare(`SELECT data FROM ${table}`).all() as { data: string }[]).map(row => JSON.parse(row.data) as T)
    const tasks = records<OrchTask>('tasks')
    const events = records<OrchEvent>('events')
    const agents = records<OrchAgent>('agents')
    return records<OrchRun>('runs').map(run => ({
      ...run, projectId: run.projectId ?? null, branch: runBranch(run.id),
      tasks: tasks.filter(t => t.runId === run.id).map(t => ({ updatedAt: t.updatedAt })),
      events: events.filter(e => e.runId === run.id).map(e => ({ at: e.at })),
      workSessionIds: agents.filter(a => a.runId === run.id).flatMap(a => {
        const args = a.launch?.args ?? []
        const i = args.indexOf('--session-id')
        return i >= 0 && args[i + 1] ? [args[i + 1]] : []
      })
    }))
  } finally { db.close() }
}

export async function sessionWorkItems(sessions: readonly ResumeSession[], projects: readonly Project[], runBranches: readonly string[], commits: CommitReader = workCommits, childIds: readonly string[] = []): Promise<WorkItem[]> {
  const byId = new Map(projects.map(p => [p.id, p]))
  const children = new Set(childIds)
  const seen = new Set<string>()
  const candidates = sessions.filter(s => {
    const key = `${s.agent}:${s.id}`
    if (seen.has(key) || children.has(s.id) || !byId.has(s.projectId)) return false
    seen.add(key)
    return !s.workBranch || !runBranches.some(b => s.workBranch!.startsWith(`${b.replace(/\/run$/, '')}/`))
  })
  const items: WorkItem[] = []
  let next = 0
  // Bound simultaneous git processes even for very large project collections.
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (next < candidates.length) {
      const s = candidates[next++]
      const project = byId.get(s.projectId)!
      const branch = s.workBranch ?? null
      const endedAt = s.lastActivityAt ?? s.modifiedAt
      const subjects = await commits(project.folder, branch, s.startedAt, endedAt)
      items.push({ id: `${s.agent}:${s.id}`, title: s.title, projectId: project.id, project: project.name,
        agent: s.agent, branch, ticket: ticketFromBranch(branch), type: classifyWork(branch, subjects), startedAt: s.startedAt, endedAt, session: s })
    }
  }))
  return items
}

export function runWorkItems(runs: readonly WorkRun[], projects: readonly Project[]): WorkItem[] {
  return runs.map(run => {
    const project = projects.find(p => p.id === run.projectId || normalizePath(p.folder) === normalizePath(run.projectPath))
    return { id: run.id, title: run.title, projectId: project?.id ?? run.projectId ?? run.projectPath, project: project?.name ?? run.projectPath,
      type: run.kind, agent: 'orchestrator', branch: run.branch, ticket: ticketFromBranch(run.branch), startedAt: run.createdAt,
      endedAt: run.finishedAt ?? Math.max(run.createdAt, ...run.tasks.map(t => t.updatedAt), ...run.events.map(e => e.at)) }
  })
}

type SourceReader = (projects: Project[], since: number) => Promise<ResumeSession[]>
const readSources: SourceReader = async (projects, since) => (await listSessionSources(projects, {}, undefined, since)).map(s => s.session)

/** Lazy collection: opening the dashboard triggers work, never app startup. */
export class WorkService {
  private cached: { key: string; at: number; job: Promise<WorkItem[]> } | null = null
  constructor(private readonly sources: SourceReader = readSources) {}

  async report(period: WorkPeriod, projects: Project[], runs: readonly WorkRun[]): Promise<WorkReport> {
    const now = Date.now()
    // Include the week when it straddles the month boundary.
    const since = Math.min(workWindow('month', now).start, workWindow('week', now).start)
    const key = JSON.stringify([projects, runs, since])
    if (!this.cached || this.cached.key !== key || now - this.cached.at >= TTL) {
      const job = this.sources(projects, since).then(async sessions => [
        ...await sessionWorkItems(sessions, projects, runs.map(r => r.branch), workCommits, runs.flatMap(r => r.workSessionIds ?? [])),
        ...runWorkItems(runs, projects)
      ])
      this.cached = { key, at: now, job }
      job.catch(() => { if (this.cached?.job === job) this.cached = null })
    }
    return aggregateWork(await this.cached.job, period, now)
  }
}
