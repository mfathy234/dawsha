import { cleanSessionName, type SessionTag } from './sessionTags'
import { formatTokens, formatUsd } from './usage'
import type { UsageTotals } from './sessionCost'
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

// Asking first only makes sense for a crowd: a few sessions are what someone reopening a day expects.
export const REOPEN_CONFIRM_OVER = 4

export const reopenGroupLabel = (count: number, day: ClosedDayLabel, project: string): string =>
  `Reopen ${count} session${count === 1 ? '' : 's'} from ${day} in ${project}`

/** Renames a closed session; an empty name, or one that changes nothing, leaves the list as it is. */
export function renameKept(kept: readonly KeptSession[], target: Pick<KeptSession, 'agent' | 'sessionId'>, raw: string): KeptSession[] {
  const title = cleanSessionName(raw)
  return kept.map((item) => (title && sameKept(item, target) ? { ...item, title, renamed: true as const } : item))
}

export function tagKept(kept: readonly KeptSession[], target: Pick<KeptSession, 'agent' | 'sessionId'>, tag: SessionTag | null): KeptSession[] {
  return kept.map((item) => {
    if (!sameKept(item, target)) return item
    const { tag: _tag, ...rest } = item
    return tag ? { ...rest, tag } : rest
  })
}

// Dollars when the cost is known (Claude), tokens otherwise; null when nothing was recorded.
export function closedUsageShort(usage: UsageTotals | undefined): string | null {
  if ((usage?.costUsd ?? 0) > 0) return formatUsd(usage!.costUsd as number)
  return usage && usage.tokens > 0 ? formatTokens(usage.tokens) : null
}

export function closedUsageTooltip(usage: UsageTotals | undefined): string {
  if (!usage) return ''
  const parts: string[] = []
  if ((usage.costUsd ?? 0) > 0) parts.push(formatUsd(usage.costUsd as number))
  if (usage.tokens > 0) parts.push(`${formatTokens(usage.tokens)} tokens`)
  return parts.join(' · ')
}
