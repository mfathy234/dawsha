import type { AgentKind, ResumeSession } from './types'

export const WORK_TYPES = ['feature', 'bug', 'other', 'conversation'] as const
export type WorkType = typeof WORK_TYPES[number]
export type WorkPeriod = 'today' | 'week' | 'month'
export const WORK_LABELS: Record<WorkType, string> = { feature: 'Feature', bug: 'Bug', other: 'Other change', conversation: 'Conversation' }
export const WORK_NOUNS: Record<WorkType, { one: string; many: string }> = {
  feature: { one: 'feature', many: 'features' },
  bug: { one: 'bug', many: 'bugs' },
  other: { one: 'other change', many: 'other changes' },
  conversation: { one: 'conversation', many: 'conversations' }
}
export type WorkCounts = Record<WorkType, number>
export interface WorkItem {
  id: string
  title: string
  projectId: string
  project: string
  type: WorkType
  agent: AgentKind
  branch: string | null
  ticket: string | null
  startedAt: number
  endedAt: number
  /** When the work was active; without them, the whole start-to-end span counts. */
  spans?: [number, number][]
  session?: ResumeSession
}
export interface WorkReport {
  period: WorkPeriod
  /** The shown period: [start, end) in local time. */
  start: number
  end: number
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
/** Active time of an item inside [start, end): the overlap of its active spans with the window. */
export function activeMs(item: Pick<WorkItem, 'startedAt' | 'endedAt' | 'spans'>, start: number, end: number): number {
  const spans = item.spans && item.spans.length > 0 ? item.spans : [[item.startedAt, item.endedAt] as [number, number]]
  return spans.reduce((sum, [from, to]) => sum + Math.max(0, Math.min(to, end) - Math.max(from, start)), 0)
}

/** One item is counted on its last activity day; time spent is its active time inside the period. */
/** How far back to step: at most about ten years of days. */
export const MAX_STEPS_BACK = 3650

/** A moment inside the period `offset` steps from now (negative is the past; the future is now). */
export function shiftAnchor(period: WorkPeriod, now: number, offset: number): number {
  const steps = Math.max(-MAX_STEPS_BACK, Math.min(0, Math.trunc(offset)))
  if (steps === 0) return now
  const at = new Date(now)
  at.setHours(12, 0, 0, 0)
  if (period === 'today') at.setDate(at.getDate() + steps)
  else if (period === 'week') at.setDate(at.getDate() + 7 * steps)
  else {
    // The first of the month first, so October 31 minus one month is September, not "September 31" = October 1.
    at.setDate(1)
    at.setMonth(at.getMonth() + steps)
  }
  return at.getTime()
}

/** Counts the period that contains `anchor` (now by default); nothing after `now` counts. */
export function aggregateWork(input: readonly WorkItem[], period: WorkPeriod, now: number, anchor = now): WorkReport {
  const { start, end } = workWindow(period, anchor)
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
    row.durationMs += activeMs(item, start, Math.min(end, now))
    projects.set(item.projectId, row)
    const day = days.get(dayKey(item.endedAt))!
    day.counts[item.type]++
    day.total++
  }
  return { period, start, end, total: items.length, counts, items, buckets, projects: [...projects.values()].sort((a, b) => b.total - a.total || a.project.localeCompare(b.project)) }
}

/** One ticket: the work on one branch of one project, however many sessions it took. */
export interface WorkTicket {
  key: string
  title: string
  ticket: string | null
  branch: string | null
  projectId: string
  project: string
  type: WorkType
  /** Most recent first. */
  items: WorkItem[]
  activeMs: number
  lastAt: number
}

/** Branches that hold everyone's work: a chat on one is not a ticket. */
const BASE_BRANCH = /^(main|master|develop|dev|stage|staging|prod|production|release)$/i
const TYPE_WEIGHT: Record<WorkType, number> = { bug: 3, feature: 2, other: 1, conversation: 0 }

function ticketKeyOf(item: WorkItem): string | null {
  if (item.branch && !BASE_BRANCH.test(item.branch)) return `branch:${item.projectId}:${item.branch}`
  // On a base branch or none, only work that changed something is a ticket of its own.
  return item.type === 'conversation' ? null : `item:${item.id}`
}

/** Groups items into tickets, with active time inside [start, end); most recently active first. */
export function workTickets(items: readonly WorkItem[], start: number, end: number): WorkTicket[] {
  const groups = new Map<string, WorkItem[]>()
  for (const item of items) {
    const key = ticketKeyOf(item)
    if (key) groups.set(key, [...groups.get(key) ?? [], item])
  }
  const tickets = [...groups].map(([key, group]): WorkTicket => {
    const recent = [...group].sort((a, b) => b.endedAt - a.endedAt)
    const first = [...group].sort((a, b) => a.startedAt - b.startedAt)[0]
    const strongest = group.reduce((best, i) => TYPE_WEIGHT[i.type] > TYPE_WEIGHT[best] ? i.type : best, 'conversation' as WorkType)
    // Only talk on a ticket's branch: its name says what it is.
    const fromBranch = classifyWork(first.branch, [])
    const type = strongest !== 'conversation' ? strongest : fromBranch === 'conversation' ? 'other' : fromBranch
    return {
      key, title: first.title, ticket: group.find(i => i.ticket)?.ticket ?? null, branch: first.branch,
      projectId: first.projectId, project: first.project, type, items: recent,
      activeMs: group.reduce((sum, i) => sum + activeMs(i, start, end), 0), lastAt: recent[0].endedAt
    }
  })
  return tickets.sort((a, b) => b.lastAt - a.lastAt)
}
