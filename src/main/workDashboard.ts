import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { branchNameProblem } from '../shared/gitBranches'
import { aggregateWork, classifyWork, shiftAnchor, ticketFromBranch, workWindow, type WorkItem, type WorkPeriod, type WorkReport } from '../shared/workDashboard'
import type { Project, ResumeSession } from '../shared/types'
import { activeSpans } from '../shared/sessionDetail'
import { normalizePath } from '../shared/sessionMatch'
import { listSessionSources } from './sessionIndex'
import { runBranch } from './orch/worktrees'

const TTL = 10_000
const commitCache = new Map<string, { at: number; job: Promise<string[]> }>()
type CommitReader = (folder: string, branch: string | null, start: number, end: number) => Promise<string[]>

const authorCache = new Map<string, Promise<string | null>>()

/** The repository's configured author email: only the user's own commits say what a session did. */
function repoAuthor(folder: string): Promise<string | null> {
  const known = authorCache.get(folder)
  if (known) return known
  const job = new Promise<string | null>((resolve) => {
    execFile('git', ['config', 'user.email'], { cwd: folder, windowsHide: true, timeout: 3000 }, (error, stdout) => resolve(error ? null : stdout.trim() || null))
  })
  authorCache.set(folder, job)
  return job
}

/**
 * Read-only, argument-safe git query of the user's own commits in the window (all authors when no email is set),
 * so a teammate's commits never turn a conversation into a change. Never changes a worktree.
 */
export const workCommits: CommitReader = (folder, branch, start, end) => {
  if ((branch && branchNameProblem(branch)) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return Promise.resolve([])
  const key = JSON.stringify([folder, branch, start, end])
  const cached = commitCache.get(key)
  if (cached && Date.now() - cached.at < TTL) return cached.job
  const job = repoAuthor(folder).then((author) => new Promise<string[]>((resolve) => {
    execFile('git', ['log', '--format=%s', `--since=${new Date(start).toISOString()}`, `--until=${new Date(end).toISOString()}`,
      ...(author ? ['--fixed-strings', `--author=${author}`] : []), branch ? `refs/heads/${branch}` : 'HEAD', '--'],
    { cwd: folder, windowsHide: true, timeout: 3000, maxBuffer: 2 * 1024 * 1024 },
    (error, stdout) => resolve(error ? [] : stdout.trim().split('\n').filter(Boolean)))
  }))
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
  /** Times of the run's events, for its active spans. */
  eventTimes?: readonly number[]
  /** Finished tasks: a cancelled run that finished none did no work. */
  approvedTasks?: number
  /** The branch an agent reported working on, when it is not the run's own branch. */
  workBranch?: string | null
  events: readonly { at: number }[]
  workSessionIds?: readonly string[]
  stage?: string
  story?: string
  plan?: string
}

/** Self-contained worker: synchronous SQLite/JSON work never runs on Electron's event loop. */
function collectRunHistory(): void {
  const { parentPort, workerData } = require('node:worker_threads') as typeof import('node:worker_threads')
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const db = new DatabaseSync(workerData as string, { readOnly: true })
  try {
    const activity = (table: string, field: string): Map<string, number> => new Map(
      (db.prepare(`SELECT run_id, MAX(json_extract(data, '$.${field}')) AS at FROM ${table} GROUP BY run_id`).all() as { run_id: string; at: number }[]).map(r => [r.run_id, r.at]))
    const tasks = activity('tasks', 'updatedAt'), events = activity('events', 'at')
    // Every event time, for the run's active spans, and how much work each run finished.
    const eventTimes = new Map<string, number[]>()
    for (const row of db.prepare("SELECT run_id, json_extract(data, '$.at') AS at FROM events").all() as { run_id: string; at: number }[]) {
      eventTimes.set(row.run_id, [...eventTimes.get(row.run_id) ?? [], row.at])
    }
    // The branch the work really landed on when an agent named one (a lead can make its own feature branch).
    const named = new Map<string, string>()
    for (const row of db.prepare("SELECT run_id, json_extract(data, '$.branch') AS branch FROM tasks WHERE json_extract(data, '$.branch') IS NOT NULL ORDER BY json_extract(data, '$.updatedAt')").all() as { run_id: string; branch: string }[]) {
      if (!row.branch.startsWith('orch/')) named.set(row.run_id, row.branch)
    }
    const approved = new Map((db.prepare("SELECT run_id, COUNT(*) AS n FROM tasks WHERE status = 'approved' GROUP BY run_id").all() as { run_id: string; n: number }[]).map(r => [r.run_id, r.n]))
    const ids = new Map<string, string[]>()
    for (const row of db.prepare("SELECT run_id, json_extract(data, '$.launch.args') AS args FROM agents").all() as { run_id: string; args: string | null }[]) {
      const args: string[] = row.args ? JSON.parse(row.args) as string[] : []
      const i = args.indexOf('--session-id')
      if (i >= 0 && args[i + 1]) ids.set(row.run_id, [...ids.get(row.run_id) ?? [], args[i + 1]])
    }
    const runs = (db.prepare('SELECT data FROM runs').all() as { data: string }[]).map(row => {
      const run = JSON.parse(row.data) as import('../shared/orch/types').OrchRun
      return { id: run.id, title: run.title, kind: run.kind, projectId: run.projectId ?? null, projectPath: run.projectPath,
        createdAt: run.createdAt, finishedAt: run.finishedAt, stage: run.stage, story: run.story, plan: run.plan,
        tasks: [{ updatedAt: tasks.get(run.id) ?? run.createdAt }], events: [{ at: events.get(run.id) ?? run.createdAt }], workSessionIds: ids.get(run.id) ?? [],
        eventTimes: eventTimes.get(run.id) ?? [], approvedTasks: approved.get(run.id) ?? 0, workBranch: named.get(run.id) ?? null }
    })
    parentPort!.postMessage(runs)
  } finally { db.close() }
}

const runCache = new Map<string, { at: number; job: Promise<WorkRun[]> }>()
/** History stays visible with the runtime off; coalesce/cache before opening SQLite. */
export function readWorkRuns(path: string): Promise<WorkRun[]> {
  const cached = runCache.get(path)
  if (cached && Date.now() - cached.at < TTL) return cached.job
  const job = access(path).then(() => new Promise<WorkRun[]>((resolve, reject) => {
    const worker = new Worker(`(${collectRunHistory.toString()})()`, { eval: true, workerData: path })
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Work history took too long to read.')) }, 15_000)
    worker.once('message', (runs: Omit<WorkRun, 'branch'>[]) => { clearTimeout(timer); resolve(runs.map(r => ({ ...r, branch: runBranch(r.id) }))) })
    worker.once('error', () => { clearTimeout(timer); reject(new Error('Could not read orchestrator work history.')) })
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Could not read orchestrator work history.')) })
  }), () => [])
  if (runCache.size >= 50) runCache.delete(runCache.keys().next().value!)
  runCache.set(path, { at: Date.now(), job })
  job.catch(() => { if (runCache.get(path)?.job === job) runCache.delete(path) })
  return job
}

function belongsToRun(session: ResumeSession, run: Pick<WorkRun, 'branch' | 'workSessionIds'>): boolean {
  return Boolean(run.workSessionIds?.includes(session.id) || (session.workBranch && session.workBranch.startsWith(`${run.branch.replace(/\/run$/, '')}/`)))
}

export async function sessionWorkItems(sessions: readonly ResumeSession[], projects: readonly Project[], runBranches: readonly string[], commits: CommitReader = workCommits, childIds: readonly string[] = []): Promise<WorkItem[]> {
  const byId = new Map(projects.map(p => [p.id, p]))
  const children = new Set(childIds)
  const seen = new Set<string>()
  const candidates = sessions.filter(s => {
    const key = `${s.agent}:${s.id}`
    if (seen.has(key) || children.has(s.id) || s.orchestrated || !byId.has(s.projectId)) return false
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
        agent: s.agent, branch, ticket: ticketFromBranch(branch), type: classifyWork(branch, subjects), startedAt: s.startedAt, endedAt, ...(s.activeSpans ? { spans: s.activeSpans } : {}), session: s })
    }
  }))
  return items
}

export function runWorkItems(runs: readonly WorkRun[], projects: readonly Project[], sessions: readonly ResumeSession[] = []): WorkItem[] {
  // A cancelled run that finished nothing is not work done (a wrong project, a false start).
  return runs.filter(run => !(run.stage === 'cancelled' && (run.approvedTasks ?? 0) === 0)).map(run => {
    const own = sessions.filter(s => belongsToRun(s, run))
    const spans = activeSpans([...run.eventTimes ?? [], ...own.flatMap(s => (s.activeSpans ?? []).flat())])
    const project = projects.find(p => p.id === run.projectId || normalizePath(p.folder) === normalizePath(run.projectPath))
    return { id: run.id, title: run.title, projectId: project?.id ?? run.projectId ?? run.projectPath, project: project?.name ?? run.projectPath,
      type: run.kind, agent: 'orchestrator', branch: run.workBranch ?? run.branch, ticket: ticketFromBranch(run.workBranch ?? run.branch), startedAt: run.createdAt,
      endedAt: run.finishedAt ?? Math.max(run.createdAt, ...run.tasks.map(t => t.updatedAt), ...run.events.map(e => e.at), ...sessions.filter(s => belongsToRun(s, run)).map(s => s.lastActivityAt ?? s.modifiedAt)),
      ...(spans.length > 0 ? { spans } : {}),
      run: { stage: run.stage ?? '', story: run.story ?? '', plan: run.plan ?? '' } }
  })
}

type SourceReader = (projects: Project[], since: number) => Promise<ResumeSession[]>
const readSources: SourceReader = async (projects, since) => (await listSessionSources(projects, {}, undefined, since)).map(s => s.session)

/** Lazy collection: opening the dashboard triggers work, never app startup. */
export class WorkService {
  private cached: { key: string; at: number; job: Promise<WorkItem[]> } | null = null
  constructor(private readonly sources: SourceReader = readSources) {}

  async report(period: WorkPeriod, projects: Project[], runs: readonly WorkRun[], offset = 0): Promise<WorkReport> {
    const now = Date.now()
    const anchor = shiftAnchor(period, now, offset)
    // Include the week when it straddles the month boundary.
    const since = Math.min(workWindow('month', anchor).start, workWindow('week', anchor).start)
    const key = JSON.stringify([projects, runs, since])
    if (!this.cached || this.cached.key !== key || now - this.cached.at >= TTL) {
      const job = this.sources(projects, since).then(async sessions => [
        ...await sessionWorkItems(sessions, projects, runs.map(r => r.branch), workCommits, runs.flatMap(r => r.workSessionIds ?? [])),
        ...runWorkItems(runs, projects, sessions)
      ])
      this.cached = { key, at: now, job }
      job.catch(() => { if (this.cached?.job === job) this.cached = null })
    }
    return aggregateWork(await this.cached.job, period, now, anchor)
  }
}
