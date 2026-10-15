import { stat } from 'node:fs/promises'
import { runTimelineSearch, type TimelineSearchRequest, type TimelineSearchResult } from '../shared/timelineSearch'
import type { TimelineEvent } from '../shared/timeline'
import type { Project } from '../shared/types'
import { listSessionSources, type SessionSource } from './sessionIndex'
import { parseLogFile } from './sessionTimeline'

const CACHE_LIMIT = 40

interface Parsed {
  key: string
  events: TimelineEvent[]
}

const parsed = new Map<string, Parsed>()
let active: { cancelled: boolean } | null = null

const pause = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Events of one session log, kept by path, size and modified time so a repeated search does not read it again. */
async function eventsOf(source: SessionSource): Promise<TimelineEvent[] | null> {
  const info = await stat(source.path)
  const key = `${info.size}:${Math.round(info.mtimeMs)}`
  const known = parsed.get(source.path)
  if (known?.key === key) {
    parsed.delete(source.path)
    parsed.set(source.path, known)
    return known.events
  }
  const events = await parseLogFile(source.session.agent, source.path, info.size)
  parsed.set(source.path, { key, events })
  while (parsed.size > CACHE_LIMIT) {
    const oldest = parsed.keys().next().value
    if (oldest === undefined) break
    parsed.delete(oldest)
  }
  return events
}

/** Searches every session log of the chosen projects. A newer search cancels the one still running. */
export async function searchTimelines(request: TimelineSearchRequest, projects: Project[]): Promise<TimelineSearchResult> {
  if (active) active.cancelled = true
  const mine = { cancelled: false }
  active = mine
  try {
    const query = String(request.query ?? '').slice(0, 200)
    if (query.trim() === '') return { status: 'ok', groups: [], scanned: 0, more: false }
    const sources = await listSessionSources(projects, { projectId: request.projectId, agent: request.agent })
    if (mine.cancelled) return { status: 'cancelled' }
    const outcome = await runTimelineSearch({
      sessions: sources,
      load: eventsOf,
      query,
      filter: request.filter,
      isCancelled: () => mine.cancelled,
      pause
    })
    if (outcome.cancelled) return { status: 'cancelled' }
    return { status: 'ok', groups: outcome.groups.map((group) => ({ ...group, session: group.session.session })), scanned: outcome.scanned, more: outcome.more }
  } finally {
    if (active === mine) active = null
  }
}
