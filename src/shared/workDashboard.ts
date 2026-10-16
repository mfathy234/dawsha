import type { AgentKind, ResumeSession } from './types'

export const WORK_TYPES = ['feature', 'bug', 'other', 'conversation'] as const
export type WorkType = typeof WORK_TYPES[number]
export type WorkPeriod = 'today' | 'week' | 'month'
export const WORK_LABELS: Record<WorkType, string> = { feature: 'Feature', bug: 'Bug', other: 'Other change', conversation: 'Conversation' }
export type WorkCounts = Record<WorkType, number>
export interface WorkItem {
  id: string
  title: string
  projectId: string
  project: string
  type: WorkType
  agent: AgentKind | 'orchestrator'
  branch: string | null
  ticket: string | null
  startedAt: number
  endedAt: number
  session?: ResumeSession
  run?: { stage: string; story: string; plan: string }
}
export interface WorkReport {
  period: WorkPeriod
  total: number
  counts: WorkCounts
  items: WorkItem[]
  projects: { projectId: string; project: string; counts: WorkCounts; total: number; durationMs: number }[]
  buckets: { key: string; counts: WorkCounts; total: number }[]
}
export function classifyWork(branch: string | null, commits: readonly string[]): WorkType {
  if (/^(fix|bugfix|hotfix|bug)\//i.test(branch ?? '') || commits.some(c => /^fix[:(]/i.test(c))) return 'bug'
  if (/^(feature|feat)\//i.test(branch ?? '') || commits.some(c => /^feat[:(]/i.test(c))) return 'feature'
  return commits.length ? 'other' : 'conversation'
}
export function ticketFromBranch(branch: string | null): string | null {
  const number = /(?:^|[\/-])(\d+)(?=$|[\/-])/.exec(branch ?? '')?.[1]
  return number ? `#${number}` : null
}
export function workWindow(period: WorkPeriod, now: number): { start: number; end: number } {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (period === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  if (period === 'month') start.setDate(1)
  const end = new Date(start)
  if (period === 'month') end.setMonth(end.getMonth() + 1)
  else end.setDate(end.getDate() + (period === 'week' ? 7 : 1))
  return { start: start.getTime(), end: end.getTime() }
}
const emptyCounts = (): WorkCounts => ({ feature: 0, bug: 0, other: 0, conversation: 0 })
function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** One item is counted on its last activity day; elapsed durations span the whole item. */
export function aggregateWork(input: readonly WorkItem[], period: WorkPeriod, now: number): WorkReport {
  const { start, end } = workWindow(period, now)
  const items = input.filter(i => i.endedAt >= start && i.endedAt < end && i.endedAt <= now).sort((a, b) => b.endedAt - a.endedAt)
  const buckets: WorkReport['buckets'] = []
  for (const d = new Date(start); d.getTime() < end; d.setDate(d.getDate() + 1)) buckets.push({ key: dayKey(d.getTime()), counts: emptyCounts(), total: 0 })
  const days = new Map(buckets.map(b => [b.key, b]))
  const counts = emptyCounts()
  const projects = new Map<string, WorkReport['projects'][number]>()
  for (const item of items) {
    counts[item.type]++
    const row = projects.get(item.projectId) ?? { projectId: item.projectId, project: item.project, counts: emptyCounts(), total: 0, durationMs: 0 }
    row.counts[item.type]++
    row.total++
    row.durationMs += Math.max(0, item.endedAt - item.startedAt)
    projects.set(item.projectId, row)
    const day = days.get(dayKey(item.endedAt))!
    day.counts[item.type]++
    day.total++
  }
  return { period, total: items.length, counts, items, buckets, projects: [...projects.values()].sort((a, b) => b.total - a.total || a.project.localeCompare(b.project)) }
}
