import type { KeptSession } from './types'

// How many closed sessions a project shows before "Show all".
export const CLOSED_PREVIEW_COUNT = 5

export const keptSessionKey = (session: Pick<KeptSession, 'agent' | 'sessionId'>): string => `${session.agent}:${session.sessionId}`

// Settings keep closed sessions oldest first (new ones are appended and the oldest trimmed), so the sidebar sorts its own copy.
export function closedSessionsFor(kept: readonly KeptSession[], projectId: string, openKeys: ReadonlySet<string>): KeptSession[] {
  return kept
    .filter((session) => session.projectId === projectId && !openKeys.has(keptSessionKey(session)))
    .sort((a, b) => b.closedAt - a.closedAt)
}

export const sameKept = (a: Pick<KeptSession, 'agent' | 'sessionId'>, b: Pick<KeptSession, 'agent' | 'sessionId'>): boolean =>
  a.agent === b.agent && a.sessionId === b.sessionId

// Puts a removed session back where it was (storage order is oldest first); a session that came back in the meantime stays as it is.
export function insertKept(kept: readonly KeptSession[], session: KeptSession, index: number): KeptSession[] {
  if (kept.some((item) => sameKept(item, session))) return [...kept]
  const at = Math.max(0, Math.min(index, kept.length))
  return [...kept.slice(0, at), session, ...kept.slice(at)]
}

export type ClosedDayLabel = 'Today' | 'Yesterday' | 'This week' | 'Earlier'

export interface ClosedDayGroup {
  label: ClosedDayLabel
  sessions: KeptSession[]
}

const DAY_MS = 86_400_000
const startOfDay = (time: number): number => new Date(time).setHours(0, 0, 0, 0)

// Local calendar days, so a session closed at 23:50 is "Yesterday" at 00:10.
export function closedDayLabel(closedAt: number, now: number): ClosedDayLabel {
  const days = Math.round((startOfDay(now) - startOfDay(closedAt)) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return days < 7 ? 'This week' : 'Earlier'
}

// Expects the newest-first order of closedSessionsFor; groups come out in that order and empty ones are left out.
export function groupClosedByDay(sessions: readonly KeptSession[], now: number): ClosedDayGroup[] {
  const groups: ClosedDayGroup[] = []
  for (const session of sessions) {
    const label = closedDayLabel(session.closedAt, now)
    const last = groups[groups.length - 1]
    if (last?.label === label) groups[groups.length - 1] = { label, sessions: [...last.sessions, session] }
    else groups.push({ label, sessions: [session] })
  }
  return groups
}

export function closedAgoShort(closedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - closedAt) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  if (days < 365) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 365)}y`
}
