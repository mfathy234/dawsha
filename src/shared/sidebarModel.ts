import { closedAgoShort } from './keptSessions'
import { orderProjects } from './projectOrder'
import { SESSION_STATE_LABELS, type SessionState } from './sessionState'
import type { Project } from './types'

/** Fired on window to open the sidebar filter field. */
export const SIDEBAR_FILTER_EVENT = 'dawsha:sidebar-filter'

export type SidebarSort = 'recent' | 'name' | 'manual'

export const SIDEBAR_SORTS: readonly { sort: SidebarSort; label: string }[] = [
  { sort: 'recent', label: 'Recent activity' },
  { sort: 'name', label: 'Name' },
  { sort: 'manual', label: 'Manual' }
]

export const isSidebarSort = (value: unknown): value is SidebarSort => SIDEBAR_SORTS.some((item) => item.sort === value)

const DAY_MS = 86_400_000

/** "now", "4m", "1h", "yesterday", "3d": how long ago something last happened. */
export function sessionAge(at: number, now: number): string {
  const elapsed = Math.max(0, now - at)
  if (elapsed >= DAY_MS && elapsed < 2 * DAY_MS) return 'yesterday'
  return closedAgoShort(at, now)
}

const byName = (a: Project, b: Project): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })

/** Pinned projects stay first. Manual keeps the stored order, Name sorts A to Z, Recent puts the busiest-lately first (ties keep the stored order). */
export function sortProjects(projects: readonly Project[], sort: SidebarSort, activity: Readonly<Record<string, number>>): Project[] {
  const ordered = orderProjects(projects)
  if (sort === 'manual') return ordered
  const pinned = ordered.filter((project) => project.pinned === true)
  const rest = ordered.filter((project) => project.pinned !== true)
  const compare = sort === 'name' ? byName : (a: Project, b: Project): number => (activity[b.id] ?? 0) - (activity[a.id] ?? 0)
  return [...[...pinned].sort(compare), ...[...rest].sort(compare)]
}

/** Drops projects that have no open or closed sessions when asked to. */
export function hideEmptyProjects<T extends { views: readonly unknown[]; closed: readonly unknown[] }>(entries: readonly T[], hide: boolean): T[] {
  return hide ? entries.filter((entry) => entry.views.length + entry.closed.length > 0) : [...entries]
}

/** Sessions blocked on the user, newest first; ties keep their order. */
export function waitingOnYou<T extends { state: SessionState; at: number }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.state === 'needs')
    .sort((a, b) => b.item.at - a.item.at || a.index - b.index)
    .map(({ item }) => item)
}

export interface ProjectSummary {
  text: string
  tone: 'needs' | 'live' | 'idle' | 'none'
}

/** The quiet word on the right of a project row: "needs you", "2 live" (something is working), "1 idle", or nothing. */
export function projectSummary(states: readonly SessionState[]): ProjectSummary {
  if (states.some((state) => state === 'needs')) return { text: 'needs you', tone: 'needs' }
  const open = states.filter((state) => state !== 'exited')
  if (open.length === 0) return { text: '', tone: 'none' }
  return open.some((state) => state === 'working') ? { text: `${open.length} live`, tone: 'live' } : { text: `${open.length} idle`, tone: 'idle' }
}

export interface SidebarZones<T> {
  /** False while filtering: every match sits in `active`, in one list. */
  grouped: boolean
  /** Projects with open sessions. */
  active: T[]
  /** Pinned projects without open sessions. */
  pinned: T[]
  /** The remaining projects, shown as compact one-line rows. */
  quiet: T[]
}

/** Splits already-sorted entries into the sidebar's zones, keeping the given order inside each. A live session puts its project in Active; a filter ungroups. */
export function sidebarZones<T extends { project: Project; views: readonly unknown[] }>(entries: readonly T[], filtering: boolean): SidebarZones<T> {
  if (filtering) return { grouped: false, active: [...entries], pinned: [], quiet: [] }
  const active = entries.filter((entry) => entry.views.length > 0)
  const rest = entries.filter((entry) => entry.views.length === 0)
  return { grouped: true, active, pinned: rest.filter((entry) => entry.project.pinned === true), quiet: rest.filter((entry) => entry.project.pinned !== true) }
}

/** Second line of a session row: "Working · 3 agents", "Idle", "Needs you". */
export function sessionStatusLine(state: SessionState, agents: number): string {
  const word = SESSION_STATE_LABELS[state]
  return state === 'working' && agents > 0 ? `${word} · ${agents} agent${agents === 1 ? '' : 's'}` : word
}

/** One or two letters for the rail: initials of the first two words, or the first two letters of a single word. */
export function monogram(name: string): string {
  const words = name.trim().split(/[\s\-_.]+/).filter(Boolean)
  const letters = words.length >= 2 ? [words[0], words[1]].map((word) => Array.from(word)[0]) : Array.from(words[0] ?? '?').slice(0, 2)
  return letters.join('').toUpperCase()
}

/** What the rail shows over a monogram: "!" when something needs you, else the working count, else nothing. */
export function railBadge(states: readonly SessionState[]): string {
  if (states.some((state) => state === 'needs')) return '!'
  const working = states.filter((state) => state === 'working').length
  return working > 0 ? String(working) : ''
}

/** Whether a project's session list is folded; a filter unfolds every match. */
export const isFolded = (folded: readonly string[], projectId: string, filtering: boolean): boolean => !filtering && folded.includes(projectId)
