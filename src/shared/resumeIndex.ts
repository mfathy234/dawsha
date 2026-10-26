import { AGENT_NAMES } from './agents'
import { formatDuration } from './sessionCost'
import { formatAge } from './statusLine'
import type { ResumeSession } from './types'

export type AgeGroup = 'Today' | 'Yesterday' | 'This week' | 'Older'

export const RESUME_LIMIT = 50

const DAY_MS = 86_400_000
const GROUPS: AgeGroup[] = ['Today', 'Yesterday', 'This week', 'Older']

function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function ageGroup(modifiedAt: number, now: number): AgeGroup {
  const today = startOfDay(now)
  if (modifiedAt >= today) return 'Today'
  if (modifiedAt >= today - DAY_MS) return 'Yesterday'
  if (modifiedAt >= today - 6 * DAY_MS) return 'This week'
  return 'Older'
}

export function groupSessions<T extends { modifiedAt: number }>(
  sessions: T[],
  now: number
): { label: AgeGroup; sessions: T[] }[] {
  const sorted = [...sessions].sort((a, b) => b.modifiedAt - a.modifiedAt)
  return GROUPS.map((label) => ({ label, sessions: sorted.filter((s) => ageGroup(s.modifiedAt, now) === label) })).filter(
    (group) => group.sessions.length > 0
  )
}

export function matchesQuery(session: ResumeSession, projectName: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const fields = [session.title, projectName, AGENT_NAMES[session.agent], session.firstPrompt ?? ''].map((f) => f.toLowerCase())
  return needle.split(/\s+/).every((word) => fields.some((field) => field.includes(word)))
}

export const messageWord = (count: number): string => `${count} message${count === 1 ? '' : 's'}`

export const sessionSummary = (count: number, projects: number): string =>
  `${count} session${count === 1 ? '' : 's'} across ${projects} project${projects === 1 ? '' : 's'}`

function whenText(time: number, now: number): string {
  const clock = new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const group = ageGroup(time, now)
  if (group === 'Today' || group === 'Yesterday') return `${group} ${clock}`
  return `${new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}, ${clock}`
}

/** Small facts for the preview; each is left out when the index did not capture it. */
export function sessionFacts(session: ResumeSession, now: number): string[] {
  const worked = (session.activeSpans ?? []).reduce((total, [start, end]) => total + (end - start), 0)
  return [
    session.messageCount > 0 ? messageWord(session.messageCount) : '',
    worked > 0 ? `${formatDuration(worked)} of work` : '',
    whenText(session.startedAt, now)
  ].filter(Boolean)
}
