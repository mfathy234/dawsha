import { AGENT_NAMES } from './agents'
import type { AgentKind, Project } from './types'
import { dayKey, projectKeyFor } from './usage'
import type { SessionDetail } from './usageDetail'

export type ExportRange = 'today' | 'week' | 'month' | 'lastMonth' | 'all'
export type ExportGrouping = 'dayProjectAgent' | 'day' | 'project' | 'session'

export const EXPORT_RANGES: { value: ExportRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'all', label: 'All' }
]

export const EXPORT_GROUPINGS: { value: ExportGrouping; label: string }[] = [
  { value: 'dayProjectAgent', label: 'Day, project and agent' },
  { value: 'day', label: 'Day' },
  { value: 'project', label: 'Project' },
  { value: 'session', label: 'Session' }
]

export type UsageExportResult =
  | { status: 'saved'; path: string; name: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export const EXPORT_COLUMNS_NOTE = 'Columns: date, project, agent, model, input, output, cache read, cache write, cost.'

export const isExportRange = (value: unknown): value is ExportRange => EXPORT_RANGES.some((entry) => entry.value === value)
export const isExportGrouping = (value: unknown): value is ExportGrouping => EXPORT_GROUPINGS.some((entry) => entry.value === value)

export interface ExportSession extends SessionDetail {
  /** Unique per session: its id, else its file name. */
  key: string
}

/** Cost a Claude session reported, counted on the day of its last report. */
export interface ExportCost {
  day: string
  sessionKey: string
  cwd: string | null
  usd: number
}

export interface DayWindow {
  /** First and last day included, as YYYY-MM-DD; null means no limit. */
  from: string | null
  to: string | null
}

const at = (year: number, month: number, date: number): string => dayKey(new Date(year, month, date).getTime())

/** The days a range covers, in local time. A week starts on Monday. */
export function exportWindow(range: ExportRange, now: number): DayWindow {
  const today = new Date(now)
  const [year, month, date] = [today.getFullYear(), today.getMonth(), today.getDate()]
  switch (range) {
    case 'today':
      return { from: at(year, month, date), to: at(year, month, date) }
    case 'week':
      return { from: at(year, month, date - ((today.getDay() + 6) % 7)), to: at(year, month, date) }
    case 'month':
      return { from: at(year, month, 1), to: at(year, month, date) }
    case 'lastMonth':
      return { from: at(year, month - 1, 1), to: at(year, month, 0) }
    default:
      return { from: null, to: null }
  }
}

export const inWindow = (window: DayWindow, day: string): boolean => (window.from === null || day >= window.from) && (window.to === null || day <= window.to)

/** One CSV field. Quotes it when needed, and prefixes a text that a spreadsheet could run as a formula with a quote mark. */
export function csvCell(value: string | number | null): string {
  if (value === null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export const csvLine = (cells: readonly (string | number | null)[]): string => cells.map(csvCell).join(',')

export const CSV_HEADER = ['date', 'project', 'agent', 'model', 'input', 'output', 'cache read', 'cache write', 'cost']

interface Group {
  day: string
  project: string
  agent: AgentKind | null
  models: Set<string>
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number | null
}

export interface CsvInput {
  now: number
  range: ExportRange
  grouping: ExportGrouping
  projects: Pick<Project, 'id' | 'name' | 'folder'>[]
  sessions: readonly ExportSession[]
  costs: readonly ExportCost[]
}

const OTHER = 'Other'

function groupKey(grouping: ExportGrouping, day: string, project: string, agent: AgentKind, session: string): string {
  switch (grouping) {
    case 'day':
      return day
    case 'project':
      return project
    case 'session':
      return session
    default:
      return [day, project, agent].join('\0')
  }
}

const emptyGroup = (day: string, project: string, agent: AgentKind): Group => ({
  day,
  project,
  agent,
  models: new Set(),
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: null
})

/** What each group shows; a column that the grouping does not split stays empty. */
function shown(grouping: ExportGrouping, group: Group): { day: string; project: string; agent: string } {
  const agent = group.agent === null ? '' : AGENT_NAMES[group.agent]
  switch (grouping) {
    case 'day':
      return { day: group.day, project: '', agent: '' }
    case 'project':
      return { day: '', project: group.project, agent: '' }
    default:
      return { day: group.day, project: group.project, agent }
  }
}

/** The usage as CSV text: a header row and one row per group, oldest first. Lines end with CRLF. */
export function buildUsageCsv(input: CsvInput): string {
  const window = exportWindow(input.range, input.now)
  const names = new Map(input.projects.map((project) => [project.id, project.name]))
  const projectOf = (cwd: string | null): string => names.get(projectKeyFor(cwd, input.projects) ?? '') ?? OTHER
  const groups = new Map<string, Group>()
  const touch = (key: string, day: string, project: string, agent: AgentKind): Group => {
    const known = groups.get(key) ?? emptyGroup(day, project, agent)
    const next = day < known.day ? { ...known, day } : known
    groups.set(key, next)
    return next
  }
  for (const session of input.sessions) {
    const project = projectOf(session.cwd)
    for (const row of session.rows) {
      if (!inWindow(window, row.day)) continue
      const group = touch(groupKey(input.grouping, row.day, project, session.agent, session.key), row.day, project, session.agent)
      if (row.model) group.models.add(row.model)
      group.input += row.input
      group.output += row.output
      group.cacheRead += row.cacheRead
      group.cacheWrite += row.cacheWrite
    }
  }
  for (const cost of input.costs) {
    if (!inWindow(window, cost.day)) continue
    const project = projectOf(cost.cwd)
    const group = touch(groupKey(input.grouping, cost.day, project, 'claude', cost.sessionKey), cost.day, project, 'claude')
    group.cost = (group.cost ?? 0) + cost.usd
  }
  const rows = [...groups.values()]
    .map((group) => ({ group, ...shown(input.grouping, group) }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.project.localeCompare(b.project) || a.agent.localeCompare(b.agent))
    .map(({ group, day, project, agent }) =>
      csvLine([day, project, agent, [...group.models].sort().join('; '), group.input, group.output, group.cacheRead, group.cacheWrite, group.cost === null ? null : Number(group.cost.toFixed(4))])
    )
  return [csvLine(CSV_HEADER), ...rows].join('\r\n') + '\r\n'
}

/** A file name such as dawsha-usage-this-month-2026-11-11.csv. */
export function exportFileName(range: ExportRange, now: number): string {
  const label = EXPORT_RANGES.find((entry) => entry.value === range)?.label ?? 'usage'
  return `dawsha-usage-${label.toLowerCase().replace(/\s+/g, '-')}-${dayKey(now)}.csv`
}
