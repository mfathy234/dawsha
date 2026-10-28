import type { RateLimitWindow } from './types'
import { formatPercent } from './statusLine'
import { SESSION_STATE_LABELS, compareSessionStates, type SessionState } from './sessionState'

export type MoreView = 'projects' | 'usage' | 'work' | 'orchestrator' | 'agents' | 'skills' | 'layouts'

// Everything the top bar does not show: Sessions, Agents and Files stay in the bar, the rest lives under More.
export const MORE_VIEWS: readonly { view: MoreView; label: string }[] = [
  { view: 'projects', label: 'Projects' },
  { view: 'usage', label: 'Usage' },
  { view: 'work', label: 'Work' },
  { view: 'orchestrator', label: 'Orchestrator' },
  { view: 'agents', label: 'Agent tools' },
  { view: 'skills', label: 'Skills' },
  { view: 'layouts', label: 'Layouts' }
]

export function moreLabel(view: string): string {
  const match = MORE_VIEWS.find((item) => item.view === view)
  return match ? `More · ${match.label}` : 'More'
}

/** "1h 39m", "39m", "2d 3h"; null when unknown or already past. */
export function formatResetIn(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null
  const minutes = Math.floor((resetsAt - now) / 60_000)
  if (minutes < 0) return null
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** Text next to the bar: "62% · 1h 39m" for the 5h window, just the percent otherwise. */
export function limitText(window: RateLimitWindow, now: number): string {
  const reset = window.key === 'five_hour' ? formatResetIn(window.resetsAt, now) : null
  return reset ? `${formatPercent(window.percent)} · ${reset}` : formatPercent(window.percent)
}

/** "needs you · 2m": the lowercase state word plus how long since the last activity when known. */
/** "needs you · 2m"; the suffix is time in that state (see formatTimeInState), empty to omit. */
export function stateWord(state: SessionState, inState: string): string {
  const word = SESSION_STATE_LABELS[state].toLowerCase()
  return inState ? `${word} · ${inState}` : word
}

/** The last `count` non-empty lines of terminal text. */
export function lastLines(text: string, count: number): string[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .slice(-count)
}

/** Most urgent first; stable, so equal states keep their pane order. */
export function sortByUrgency<T extends { state: SessionState }>(entries: readonly T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => compareSessionStates(a.entry.state, b.entry.state) || a.index - b.index)
    .map(({ entry }) => entry)
}

/** A one-line summary of what the session is doing, or '' when nothing is known. */
export function cardSummary(view: { snapshot: { plan: { title: string | null } | null } | null }): string {
  return view.snapshot?.plan?.title?.trim().replace(/\s+/g, ' ') ?? ''
}
