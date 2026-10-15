import type { SessionState } from './sessionState'
import type { AgentKind, TabAgent } from './types'

export type SessionsLayout = 'grid' | 'board'

export type BoardColumn = 'needs' | 'working' | 'done' | 'reviewed'

export const BOARD_COLUMNS: readonly { id: BoardColumn; label: string }[] = [
  { id: 'needs', label: 'Needs you' },
  { id: 'working', label: 'Working' },
  { id: 'done', label: 'Done, to review' },
  { id: 'reviewed', label: 'Reviewed' }
]

export const BOARD_EMPTY_TEXT: Record<BoardColumn, string> = {
  needs: 'Nothing waiting on you.',
  working: 'No session is working.',
  done: 'Nothing to review.',
  reviewed: 'Reviewed sessions land here.'
}

/** Done sessions leave the Done column once seen; idle and exited ones are already past review. */
export function boardColumn(state: SessionState): BoardColumn {
  if (state === 'needs') return 'needs'
  if (state === 'working') return 'working'
  if (state === 'done') return 'done'
  return 'reviewed'
}

export function groupByColumn<T extends { state: SessionState }>(entries: readonly T[]): Record<BoardColumn, T[]> {
  const groups: Record<BoardColumn, T[]> = { needs: [], working: [], done: [], reviewed: [] }
  for (const entry of entries) groups[boardColumn(entry.state)].push(entry)
  return groups
}

export interface BoardFilter {
  projectId: string | null
  agent: AgentKind | null
}

export const NO_BOARD_FILTER: BoardFilter = { projectId: null, agent: null }

export function matchesBoardFilter(entry: { projectId: string; agent: TabAgent }, filter: BoardFilter): boolean {
  if (filter.projectId !== null && entry.projectId !== filter.projectId) return false
  return filter.agent === null || entry.agent === filter.agent
}

export const isSessionsLayout = (value: unknown): value is SessionsLayout => value === 'grid' || value === 'board'

/** Whether a drop on `target` from `source` is a valid move: only a Done card can be moved, to Reviewed. */
export const canDropOn = (source: BoardColumn, target: BoardColumn): boolean => source === 'done' && target === 'reviewed'

/** The index to land on after an arrow key in a list of `count` items, staying inside it. */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1
  if (current < 0) return delta > 0 ? 0 : count - 1
  return Math.min(count - 1, Math.max(0, current + delta))
}

export interface FilterMenuOption {
  value: string
  label: string
}

/** Options whose label contains every word typed, case-insensitively; all of them for an empty query. */
export function filterMenuOptions<T extends FilterMenuOption>(options: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...options]
  return options.filter((option) => words.every((word) => option.label.toLowerCase().includes(word)))
}
