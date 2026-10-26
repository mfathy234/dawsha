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

export interface BgSessionGroup {
  sessionKey: string
  title: string
  project: string
  agentKind: BgKind
  running: number
  done: number
  failed: number
  agents: BackgroundAgent[]
}

const MINUTE = 60_000
const MIN_BAR_PCT = 3

const endOf = (agent: Pick<BackgroundAgent, 'endedAt' | 'lastActivityAt' | 'status'>, now: number): number => (agent.status === 'running' ? now : agent.endedAt ?? agent.lastActivityAt)

/** One group per parent session: groups with a running agent first, then the latest activity; inside, running first, then newest start. */
export function groupBySession(agents: readonly BackgroundAgent[], now: number): BgSessionGroup[] {
  const groups = new Map<string, BackgroundAgent[]>()
  for (const agent of agents) groups.set(`${agent.kind}:${agent.parentId}`, [...(groups.get(`${agent.kind}:${agent.parentId}`) ?? []), agent])
  return [...groups.entries()]
    .map(([sessionKey, members]) => {
      const sorted = [...members].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt || a.key.localeCompare(b.key))
      const newest = sorted.reduce((best, agent) => (agent.lastActivityAt > best.lastActivityAt ? agent : best), sorted[0])
      const latest = Math.max(...sorted.map((agent) => (agent.status === 'running' ? now : agent.lastActivityAt)))
      const group: BgSessionGroup = {
        sessionKey, title: newest.parentTitle, project: newest.projectLabel, agentKind: newest.kind, agents: sorted,
        running: sorted.filter((agent) => agent.status === 'running').length,
        done: sorted.filter((agent) => agent.status === 'done').length,
        failed: sorted.filter((agent) => agent.status === 'failed').length
      }
      return { group, latest }
    })
    .sort((a, b) => Number(b.group.running > 0) - Number(a.group.running > 0) || b.latest - a.latest || a.group.sessionKey.localeCompare(b.group.sessionKey))
    .map((entry) => entry.group)
}

/** Earliest start to latest end (running agents end at now), at least a minute wide. */
export function sessionSpan(agents: readonly BackgroundAgent[], now: number): { from: number; to: number } {
  const from = Math.min(...agents.map((agent) => agent.startedAt))
  const to = Math.max(...agents.map((agent) => endOf(agent, now)))
  return { from, to: Math.max(to, from + MINUTE) }
}

/** Percent position inside a session's span; at least 3% wide and never past 100%. */
export function barGeometry(agent: Pick<BackgroundAgent, 'startedAt' | 'endedAt' | 'lastActivityAt' | 'status'>, span: { from: number; to: number }, now: number): { left: number; width: number } {
  const total = span.to - span.from
  const start = Math.min(Math.max(agent.startedAt, span.from), span.to)
  const end = Math.min(Math.max(endOf(agent, now), start), span.to)
  const width = Math.max(((end - start) / total) * 100, MIN_BAR_PCT)
  const left = Math.min(((start - span.from) / total) * 100, 100 - width)
  return { left, width }
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
/** The accessible name of an agent card (the Agents tab is a list, no longer a timeline). */
/** The accessible name of a timeline bar. */
export function barLabel(agent: BackgroundAgent, now: number): string {
  const end = agent.status === 'running' ? now : agent.endedAt ?? agent.lastActivityAt
  const kind = agent.automatic ? 'automatic review' : agent.type
  return `${agent.description}, ${kind}, ${STATUS_LABELS[agent.status]}, ${spanLabel(end - agent.startedAt)}`
}
