import { formatTokens, formatUsd } from '../usage'
import type { OrchRunDetail } from './api'
import type { OrchEvent, OrchRole, TaskStatus } from './types'
import type { CostSource, RunUsage } from './usage'

// Pure logic behind the Orchestrator boards and the run dashboard: cards, filters, usage rows.

export type BoardColumnId = 'todo' | 'progress' | 'review' | 'needs' | 'done'

export const BOARD_COLUMN_LIST: { id: BoardColumnId; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'progress', label: 'In progress' },
  { id: 'review', label: 'Review' },
  { id: 'needs', label: 'Needs you' },
  { id: 'done', label: 'Done' }
]

const COLUMN_OF: Record<TaskStatus, BoardColumnId> = {
  todo: 'todo',
  assigned: 'progress',
  in_progress: 'progress',
  done_pending_review: 'review',
  in_review: 'review',
  waiting_on_human: 'needs',
  blocked: 'needs',
  stalled: 'needs',
  approved: 'done',
  cancelled: 'done'
}

export interface BoardCard {
  id: string
  key: string
  runId: string
  runTitle: string
  runTag: string
  projectId: string | null
  projectName: string | null
  title: string
  status: TaskStatus
  column: BoardColumnId
  role: OrchRole
  agent: { role: OrchRole; runner: string; model: string } | null
  reviewRound: number
  attempts: number
  search: string
}

export type StatusFilter = 'open' | 'all' | 'done'

export interface BoardFilter {
  query: string
  projectId: string
  runId: string
  status: StatusFilter
  role: string
  model: string
  needsOnly: boolean
  includeFinished: boolean
}

export const DEFAULT_BOARD_FILTER: BoardFilter = {
  query: '',
  projectId: '',
  runId: '',
  status: 'open',
  role: '',
  model: '',
  needsOnly: false,
  includeFinished: false
}

export interface ProjectTab {
  id: string
  label: string
  count: number
}

type ProjectRef = { id: string; name: string }

const RUN_TAG_LENGTH = 12

export const runTag = (title: string): string => {
  const first = title.trim().split(/\s+/)[0] ?? ''
  return first.length > RUN_TAG_LENGTH ? `${first.slice(0, RUN_TAG_LENGTH - 1)}…` : first
}

/** The model name shown on a badge: the model, or the runner when the CLI default is used. */
export const modelName = (runner: string, model: string): string => (model && model !== 'default' ? model : runner.replace(/-local$/, ''))

export const isFinishedRun = (run: Pick<OrchRunDetail, 'stage'>): boolean => run.stage === 'done' || run.stage === 'cancelled'

/** Project chips for the board; each count is the number of cards the board shows for it with `filter`. */
export function projectTabs(runs: readonly OrchRunDetail[], projects: readonly ProjectRef[], filter: BoardFilter): ProjectTab[] {
  const count = (projectId: string): number => boardCards(runs, projects, { ...filter, projectId, runId: '' }).length
  const tabs = projects
    .filter((p) => runs.some((r) => r.projectId === p.id))
    .map((p) => ({ id: p.id, label: p.name, count: count(p.id) }))
  return [{ id: '', label: 'All projects', count: count('') }, ...tabs]
}

function cardsOf(run: OrchRunDetail, projects: readonly ProjectRef[]): BoardCard[] {
  const projectName = projects.find((p) => p.id === run.projectId)?.name ?? null
  return run.tasks.map((t) => {
    const found = t.assignee ? run.agents.find((a) => a.id === t.assignee) : undefined
    return {
      id: t.id,
      key: t.key,
      runId: run.id,
      runTitle: run.title,
      runTag: runTag(run.title),
      projectId: run.projectId,
      projectName,
      title: t.title,
      status: t.status,
      column: COLUMN_OF[t.status],
      role: t.role,
      agent: found ? { role: found.role, runner: found.runner, model: found.model } : null,
      reviewRound: t.reviewRound,
      attempts: t.attempts ?? 0,
      search: [t.title, t.spec, t.summary, t.feedback].filter(Boolean).join('\n').toLowerCase()
    }
  })
}

export function boardCards(runs: readonly OrchRunDetail[], projects: readonly ProjectRef[], filter: BoardFilter): BoardCard[] {
  const query = filter.query.trim().toLowerCase()
  return runs
    .filter((r) => (filter.includeFinished || filter.runId === r.id || !isFinishedRun(r)) && (!filter.runId || r.id === filter.runId) && (!filter.projectId || r.projectId === filter.projectId))
    .flatMap((r) => cardsOf(r, projects))
    .filter((c) => {
      if (filter.status === 'open' && c.column === 'done') return false
      if (filter.status === 'done' && c.column !== 'done') return false
      if (filter.needsOnly && c.column !== 'needs') return false
      if (filter.role && (c.agent?.role ?? c.role) !== filter.role) return false
      if (filter.model && (!c.agent || modelName(c.agent.runner, c.agent.model) !== filter.model)) return false
      return !query || c.search.includes(query)
    })
}

export function groupByColumn(cards: readonly BoardCard[]): { id: BoardColumnId; label: string; cards: BoardCard[] }[] {
  return BOARD_COLUMN_LIST.map((col) => ({ ...col, cards: cards.filter((c) => c.column === col.id) }))
}

export interface UsageRow {
  agentId: string
  role: OrchRole
  runner: string
  model: string
  input: string
  output: string
  cache: string
  cost: string
  marker: string
  markerTitle: string
}

export interface UsageTotal {
  input: string
  output: string
  cache: string
  cost: string
  incomplete: boolean
  agents: number
}

const SOURCE: Record<CostSource, { marker: string; title: string }> = {
  reported: { marker: 'R', title: 'Reported by the CLI' },
  estimated: { marker: 'E', title: 'Estimated from your price table' },
  free: { marker: 'L', title: 'Local model, free' },
  unpriced: { marker: '–', title: 'No price set for this model' },
  none: { marker: '–', title: 'No usage yet' }
}

function costText(costUsd: number | null, source: CostSource): string {
  if (source === 'unpriced') return 'no price'
  if (source === 'none' || costUsd === null) return '–'
  return formatUsd(costUsd)
}

export function usageRows(usage: RunUsage): { rows: UsageRow[]; total: UsageTotal } {
  const rows = usage.agents.map((a) => ({
    agentId: a.agentId,
    role: a.role,
    runner: a.runner,
    model: a.model,
    input: formatTokens(a.inputTokens),
    output: formatTokens(a.outputTokens),
    cache: formatTokens(a.cacheReadTokens + a.cacheWriteTokens),
    cost: costText(a.costUsd, a.costSource),
    marker: SOURCE[a.costSource].marker,
    markerTitle: SOURCE[a.costSource].title
  }))
  const t = usage.total
  return {
    rows,
    total: {
      input: formatTokens(t.inputTokens),
      output: formatTokens(t.outputTokens),
      cache: formatTokens(t.cacheReadTokens + t.cacheWriteTokens),
      cost: formatUsd(t.costUsd),
      incomplete: !t.complete,
      agents: rows.length
    }
  }
}

/** Newest first, optionally only the events of one task (by its key, e.g. T-3). */
export function timelineEvents(events: readonly OrchEvent[], runId: string, taskKey: string | null): OrchEvent[] {
  const wanted = taskKey ? `${runId}:${taskKey}` : null
  return events.filter((e) => !wanted || e.taskId === wanted || e.taskId === taskKey).sort((a, b) => b.at - a.at)
}
