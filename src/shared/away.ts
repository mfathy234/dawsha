/** Detecting that the owner is away from the computer, and what to tell them when they come back. */

import type { SessionState } from './sessionState'

export const AWAY_MIN_MS = 20 * 60_000
/** System idle time after which the owner counts as away even with Dawsha in front. */
export const IDLE_AWAY_SECONDS = 300

export const AWAY_IPC = { changed: 'away:changed' } as const

export interface AwayChange {
  away: boolean
  /** When the owner left, in epoch ms; for a return, when they had left. */
  since: number
}

export interface AwayFacts {
  windowFocused: boolean
  locked: boolean
  suspended: boolean
  idleSeconds: number
}

export interface AwayMemory {
  since: number | null
}

export const initialAway = (): AwayMemory => ({ since: null })

export const isAway = (facts: AwayFacts): boolean => !facts.windowFocused || facts.locked || facts.suspended || facts.idleSeconds >= IDLE_AWAY_SECONDS

/** One look at the facts: the new memory, and a change when the owner just left or just came back. */
export function stepAway(memory: AwayMemory, facts: AwayFacts, now: number): { memory: AwayMemory; change: AwayChange | null } {
  const away = isAway(facts)
  if (away && memory.since === null) {
    const idleStart = facts.windowFocused && !facts.locked && !facts.suspended ? now - facts.idleSeconds * 1000 : now
    return { memory: { since: idleStart }, change: { away: true, since: idleStart } }
  }
  if (!away && memory.since !== null) return { memory: { since: null }, change: { away: false, since: memory.since } }
  return { memory, change: null }
}

export function isAwayChange(value: unknown): value is AwayChange {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.away === 'boolean' && typeof record.since === 'number' && Number.isFinite(record.since)
}

/** "1h 52m", "38m". */
export function awayLength(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60_000))
  if (total < 60) return `${total}m`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

export interface CatchUpSession {
  paneId: string
  name: string
  state: SessionState
  unread: boolean
  since: number
  /** One line of what it is waiting on or what it finished. */
  line: string
  /** The session ran while the owner was away. */
  worked: boolean
  /** The failing check of its pull request, as one line; empty when its checks are fine. */
  ciFailed: string
  changed: number | null
}

export type CatchUpKind = 'needs' | 'done' | 'ci'

export interface CatchUpRow {
  paneId: string
  kind: CatchUpKind
  label: string
  name: string
  what: string
}

const wait = (ms: number): string => {
  const total = Math.floor(Math.max(0, ms) / 60_000)
  return total < 1 ? '' : total < 60 ? ` · ${total}m` : ` · ${Math.floor(total / 60)}h`
}

/** One row per session that needs the owner, finished, or has a failing check; the longest wait first. */
export function catchUpRows(sessions: readonly CatchUpSession[], now: number): CatchUpRow[] {
  const rows: CatchUpRow[] = []
  for (const session of [...sessions].sort((a, b) => a.since - b.since)) {
    if (session.state === 'needs') rows.push({ paneId: session.paneId, kind: 'needs', label: `Needs you${wait(now - session.since)}`, name: session.name, what: session.line })
    else if (session.ciFailed !== '') rows.push({ paneId: session.paneId, kind: 'ci', label: 'CI failed', name: session.name, what: session.ciFailed })
    else if (session.unread && (session.state === 'done' || session.state === 'idle')) rows.push({ paneId: session.paneId, kind: 'done', label: 'Done', name: session.name, what: session.line })
  }
  const order: Record<CatchUpKind, number> = { needs: 0, done: 1, ci: 2 }
  return rows.sort((a, b) => order[a.kind] - order[b.kind])
}

export function limitSentence(before: number | null, after: number | null): string {
  if (before === null || after === null || Math.round(before) === Math.round(after)) return ''
  return `5h limit went from ${Math.round(before)}% to ${Math.round(after)}%`
}

export function catchUpHeadline(awayMs: number, worked: number, limit: string): string {
  const sessions = worked === 1 ? '1 session worked' : `${worked} sessions worked`
  return [awayLength(awayMs), worked > 0 ? sessions : '', limit].filter(Boolean).join(' · ')
}

export const catchUpWanted = (awayMs: number, enabled: boolean, rows: readonly CatchUpRow[]): boolean => enabled && awayMs >= AWAY_MIN_MS && rows.length > 0
