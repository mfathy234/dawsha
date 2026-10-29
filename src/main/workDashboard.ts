import { execFile } from 'node:child_process'
import { branchNameProblem } from '../shared/gitBranches'
import { aggregateWork, classifyWork, shiftAnchor, ticketFromBranch, workWindow, type WorkItem, type WorkPeriod, type WorkReport } from '../shared/workDashboard'
import type { Project, ResumeSession } from '../shared/types'
import { listSessionSources } from './sessionIndex'
import { WorkSpanReader } from './workSpans'

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

export async function sessionWorkItems(sessions: readonly ResumeSession[], projects: readonly Project[], commits: CommitReader = workCommits): Promise<WorkItem[]> {
  const byId = new Map(projects.map(p => [p.id, p]))
  const seen = new Set<string>()
  const candidates = sessions.filter(s => {
    const key = `${s.agent}:${s.id}`
    if (seen.has(key) || !byId.has(s.projectId)) return false
    seen.add(key)
    return true
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

type WorkSession = ResumeSession & { sourcePath?: string }
type SourceReader = (projects: Project[], since: number) => Promise<WorkSession[]>
const readSources: SourceReader = async (projects, since) => (await listSessionSources(projects, {}, undefined, since)).map(s => ({ ...s.session, sourcePath: s.path }))

/** Lazy collection: opening the dashboard triggers work, never app startup. */
export class WorkService {
  private cached: { key: string; at: number; job: Promise<WorkSession[]> } | null = null
  private readonly spans = new WorkSpanReader()
  constructor(private readonly sources: SourceReader = readSources) {}

  async report(period: WorkPeriod, projects: Project[], offset = 0): Promise<WorkReport> {
    const now = Date.now()
    const anchor = shiftAnchor(period, now, offset)
    // Include the week when it straddles the month boundary.
    const since = Math.min(workWindow('month', anchor).start, workWindow('week', anchor).start)
    const key = JSON.stringify([projects, since])
    if (!this.cached || this.cached.key !== key || now - this.cached.at >= TTL) {
      const job = this.sources(projects, since)
      this.cached = { key, at: now, job }
      job.catch(() => { if (this.cached?.job === job) this.cached = null })
    }
    const indexed = await this.cached.job
    const { start, end } = workWindow(period, anchor)
    const inPeriod = (at: number): boolean => at >= start && at < end && at <= now
    const candidates = indexed.filter(session => inPeriod(session.lastActivityAt ?? session.modifiedAt))
    const sessions: WorkSession[] = []
    let next = 0
    // Bound worker count and memory while keeping parsing off Electron's event loop.
    await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
      while (next < candidates.length) {
        const session = candidates[next++]
        try {
          sessions.push(session.sourcePath ? { ...session, activeSpans: await this.spans.read(session.sourcePath, session.agent) } : session)
        } catch {
          // Deleted/rotated or inaccessible transcripts are skipped, just as in the index.
        }
      }
    }))
    return aggregateWork(await sessionWorkItems(sessions, projects), period, now, anchor)
  }
}
