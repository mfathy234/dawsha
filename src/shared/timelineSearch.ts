import {
  filterEvents,
  highlightParts,
  mergeTimeline,
  searchEvents,
  type TextPart,
  type TimelineEvent,
  type TimelineFilter,
  type TimelineKind
} from './timeline'
import type { AgentKind, ResumeSession } from './types'

export const SEARCH_HITS_SHOWN = 3
export const SEARCH_MAX_GROUPS = 50
const SNIPPET_RADIUS = 48

export interface SearchHit {
  at: number
  kind: TimelineKind
  /** The event's own text, used to find it again in the session's timeline. */
  text: string
  snippet: TextPart[]
}

export interface SessionHits<S> {
  session: S
  hits: SearchHit[]
  total: number
}

export interface TimelineSearchRequest {
  id: string
  query: string
  projectId?: string
  agent?: AgentKind
  filter: TimelineFilter
}

export type TimelineSearchResult =
  | { status: 'ok'; groups: SessionHits<ResumeSession>[]; scanned: number; more: boolean }
  | { status: 'cancelled' }

const needle = (query: string): string => query.trim().toLowerCase()

/** The part of an event the query matched: its words, command or a path. */
export function matchedField(event: TimelineEvent, query: string): string {
  const wanted = needle(query)
  const fields = [event.text, event.command, event.path, ...(event.paths ?? [])].filter((field): field is string => Boolean(field))
  return fields.find((field) => field.toLowerCase().includes(wanted)) ?? event.text
}

/** A short stretch of text around the first match, with the matches marked. */
export function snippetParts(text: string, query: string, radius = SNIPPET_RADIUS): TextPart[] {
  const flat = text.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(needle(query))
  if (at < 0 || needle(query) === '') return [{ text: flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat, match: false }]
  const start = Math.max(0, at - radius)
  const end = Math.min(flat.length, at + needle(query).length + radius)
  const body = `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
  return highlightParts(body, query)
}

export function searchSessionEvents(
  events: readonly TimelineEvent[],
  query: string,
  filter: TimelineFilter
): { hits: SearchHit[]; total: number } {
  const shown = filterEvents(mergeTimeline(events, []), filter)
  const matches = searchEvents(shown, query)
  const hits = matches.slice(0, SEARCH_HITS_SHOWN).map((index): SearchHit => {
    const event = shown[index]
    return { at: event.at, kind: event.kind, text: event.text, snippet: snippetParts(matchedField(event, query), query) }
  })
  return { hits, total: matches.length }
}

export interface SearchRun<S> {
  sessions: readonly S[]
  load(session: S): Promise<readonly TimelineEvent[] | null>
  query: string
  filter: TimelineFilter
  isCancelled(): boolean
  maxGroups?: number
  /** Called between sessions so a long search lets other work run. */
  pause?(): Promise<void>
}

export interface SearchOutcome<S> {
  groups: SessionHits<S>[]
  scanned: number
  more: boolean
  cancelled: boolean
}

/** Looks through sessions newest first and stops at `maxGroups` sessions with matches, or as soon as it is cancelled. */
export async function runTimelineSearch<S>(run: SearchRun<S>): Promise<SearchOutcome<S>> {
  const maxGroups = run.maxGroups ?? SEARCH_MAX_GROUPS
  const groups: SessionHits<S>[] = []
  let scanned = 0
  if (needle(run.query) === '') return { groups, scanned, more: false, cancelled: false }
  for (const session of run.sessions) {
    if (run.isCancelled()) return { groups, scanned, more: false, cancelled: true }
    if (groups.length >= maxGroups) return { groups, scanned, more: true, cancelled: false }
    const events = await run.load(session).catch(() => null)
    scanned += 1
    if (run.isCancelled()) return { groups, scanned, more: false, cancelled: true }
    if (events) {
      const found = searchSessionEvents(events, run.query, run.filter)
      if (found.total > 0) groups.push({ session, ...found })
    }
    if (run.pause) await run.pause()
  }
  return { groups, scanned, more: false, cancelled: false }
}
