export type BgKind = 'claude' | 'codex'
export type BgStatus = 'running' | 'done' | 'failed'
export type BgRange = '1h' | '2h' | '24h' | '7d'

export const BG_KINDS: readonly BgKind[] = ['claude', 'codex']
export const BG_STATUSES: readonly BgStatus[] = ['running', 'done', 'failed']
export const BG_RANGES: readonly { value: BgRange; label: string; phrase: string; ms: number }[] = [
  { value: '1h', label: 'Last hour', phrase: 'the last hour', ms: 3_600_000 },
  { value: '2h', label: 'Last 2 hours', phrase: 'the last 2 hours', ms: 7_200_000 },
  { value: '24h', label: 'Last 24 hours', phrase: 'the last 24 hours', ms: 86_400_000 },
  { value: '7d', label: 'Last 7 days', phrase: 'the last 7 days', ms: 604_800_000 }
]
export const DEFAULT_BG_RANGE: BgRange = '24h'
/** An agent with no activity for this long and no end marker is treated as interrupted. */
export const RUNNING_WINDOW_MS = 10 * 60_000
/** Projects that are not in Dawsha are grouped under this filter value. */
export const OTHER_PROJECT = 'other'

export const isBgRange = (value: unknown): value is BgRange => BG_RANGES.some((range) => range.value === value)
export const rangeMs = (range: BgRange): number => BG_RANGES.find((entry) => entry.value === range)?.ms ?? 86_400_000

export interface BackgroundAgent {
  /** `${kind}:${id}`: unique across both tools. */
  key: string
  id: string
  kind: BgKind
  parentId: string
  parentTitle: string
  projectId: string | null
  projectLabel: string
  description: string
  type: string
  automatic: boolean
  model: string | null
  depth: number
  parentAgentId: string | null
  startedAt: number
  endedAt: number | null
  lastActivityAt: number
  status: BgStatus
  statusNote: string | null
  tokens: number
  tokensApprox: boolean
  costUsd: number | null
  lastStep: string
  result: string
}

export interface BackgroundAgentsReport {
  generatedAt: number
  range: BgRange
  agents: BackgroundAgent[]
}

export interface BgFilters {
  /** Empty means every status. */
  statuses: readonly BgStatus[]
  /** Empty means both tools. */
  kinds: readonly BgKind[]
  /** A Dawsha project id, OTHER_PROJECT, or null for all. */
  project: string | null
  range: BgRange
  query: string
  showAutomatic: boolean
}

export const DEFAULT_BG_FILTERS: BgFilters = { statuses: [], kinds: [], project: null, range: DEFAULT_BG_RANGE, query: '', showAutomatic: false }

export const toggleIn = <T>(items: readonly T[], item: T): T[] => (items.includes(item) ? items.filter((entry) => entry !== item) : [...items, item])

/** True when anything but the range differs from the defaults, or the range is not the default one. */
export const filtersActive = (filters: BgFilters): boolean =>
  filters.statuses.length > 0 || filters.kinds.length > 0 || filters.project !== null || filters.query.trim() !== '' || filters.showAutomatic || filters.range !== DEFAULT_BG_RANGE

const projectKey = (agent: BackgroundAgent): string => agent.projectId ?? OTHER_PROJECT

/** Filters in the view's order; `skip: 'status'` keeps the status chips' own counts steady. */
export function applyFilters(agents: readonly BackgroundAgent[], filters: BgFilters, skip?: 'status'): BackgroundAgent[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return agents.filter((agent) => {
    if (agent.automatic && !filters.showAutomatic) return false
    if (skip !== 'status' && filters.statuses.length > 0 && !filters.statuses.includes(agent.status)) return false
    if (filters.kinds.length > 0 && !filters.kinds.includes(agent.kind)) return false
    if (filters.project !== null && projectKey(agent) !== filters.project) return false
    if (!query) return true
    return [agent.description, agent.parentTitle, agent.type].some((text) => text.toLocaleLowerCase().includes(query))
  })
}

export function statusCounts(agents: readonly BackgroundAgent[]): Record<BgStatus, number> {
  const counts: Record<BgStatus, number> = { running: 0, done: 0, failed: 0 }
  for (const agent of agents) counts[agent.status] += 1
  return counts
}

export interface BgTotals {
  tokens: number
  costUsd: number | null
  approx: boolean
}

/** Cost is null until at least one shown agent could be priced. */
export function totalsOf(agents: readonly BackgroundAgent[]): BgTotals {
  let costUsd: number | null = null
  let tokens = 0
  let approx = false
  for (const agent of agents) {
    tokens += agent.tokens
    approx ||= agent.tokensApprox
    if (agent.costUsd !== null) costUsd = (costUsd ?? 0) + agent.costUsd
  }
  return { tokens, costUsd, approx }
}

export interface BgProjectOption {
  value: string
  label: string
}

/** Known projects that have agents, then the "Other folders" bucket when needed. */
export function projectOptions(agents: readonly BackgroundAgent[], projects: readonly { id: string; name: string }[]): BgProjectOption[] {
  const present = new Set(agents.map(projectKey))
  const options = projects.filter((project) => present.has(project.id)).map((project) => ({ value: project.id, label: project.name }))
  return present.has(OTHER_PROJECT) ? [...options, { value: OTHER_PROJECT, label: 'Other folders' }] : options
}

export interface BgLane {
  key: string
  kind: BgKind
  parentId: string
  title: string
  projectLabel: string
  agents: BackgroundAgent[]
  lastActivityAt: number
  running: number
}

/** One lane per parent session, the most recently active first; agents inside run oldest to newest. */
export function buildLanes(agents: readonly BackgroundAgent[]): BgLane[] {
  const groups = new Map<string, BackgroundAgent[]>()
  for (const agent of agents) groups.set(`${agent.kind}:${agent.parentId}`, [...(groups.get(`${agent.kind}:${agent.parentId}`) ?? []), agent])
  return [...groups.entries()]
    .map(([key, members]): BgLane => {
      const sorted = [...members].sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key))
      const newest = sorted.reduce((best, agent) => (agent.lastActivityAt > best.lastActivityAt ? agent : best), sorted[0])
      return {
        key,
        kind: newest.kind,
        parentId: newest.parentId,
        title: newest.parentTitle,
        projectLabel: newest.projectLabel,
        agents: sorted,
        lastActivityAt: newest.lastActivityAt,
        running: sorted.filter((agent) => agent.status === 'running').length
      }
    })
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.key.localeCompare(b.key))
}

export interface BgWindow {
  start: number
  end: number
  /** Where "now" sits, in percent of the axis. */
  nowPct: number
}

/** The axis covers the range plus a little room after now so running bars show their growing edge. */
export function axisWindow(range: BgRange, now: number): BgWindow {
  const span = rangeMs(range)
  const end = now + span * 0.05
  return { start: now - span, end, nowPct: (span / (span * 1.05)) * 100 }
}

const MIN_BAR_PCT = 0.8

/** Percent position on the axis, clipped to it; running agents reach now. */
export function barGeometry(agent: Pick<BackgroundAgent, 'startedAt' | 'endedAt' | 'lastActivityAt' | 'status'>, window: BgWindow, now: number): { left: number; width: number } {
  const span = window.end - window.start
  const to = agent.status === 'running' ? now : agent.endedAt ?? agent.lastActivityAt
  const from = Math.min(Math.max(agent.startedAt, window.start), window.end)
  const end = Math.min(Math.max(to, from), window.end)
  const left = Math.min(((from - window.start) / span) * 100, 100 - MIN_BAR_PCT)
  const width = Math.max(((end - from) / span) * 100, MIN_BAR_PCT)
  return { left, width: Math.min(width, 100 - left) }
}

export const AXIS_TICKS = 6

const MINUTE = 60_000
const TICK_STEPS = [10, 15, 20, 30, 60, 120, 180, 240, 360, 720, 1440].map((minutes) => minutes * MINUTE)

/** Ticks on round local times (12:00, 12:30, Tue 00:00), about AXIS_TICKS of them across the window. */
export function axisTicks(window: BgWindow, tzOffsetMinutes = new Date(window.start).getTimezoneOffset()): { at: number; pct: number }[] {
  const span = window.end - window.start
  const step = TICK_STEPS.find((candidate) => span / candidate <= AXIS_TICKS) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const shift = -tzOffsetMinutes * MINUTE
  const ticks: { at: number; pct: number }[] = []
  for (let at = Math.ceil((window.start + shift) / step) * step - shift; at < window.end; at += step) ticks.push({ at, pct: ((at - window.start) / span) * 100 })
  return ticks
}

export function compactTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`
  return String(count)
}

export const costLabel = (usd: number | null): string => (usd === null ? '' : usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`)

/** "42s", "12m", "1h 05m". */
export function spanLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export const STATUS_LABELS: Record<BgStatus, string> = { running: 'running', done: 'done', failed: 'failed' }

/** The accessible name of a timeline bar. */
export function barLabel(agent: BackgroundAgent, now: number): string {
  const end = agent.status === 'running' ? now : agent.endedAt ?? agent.lastActivityAt
  const kind = agent.automatic ? 'automatic review' : agent.type
  return `${agent.description}, ${kind}, ${STATUS_LABELS[agent.status]}, ${spanLabel(end - agent.startedAt)}`
}
