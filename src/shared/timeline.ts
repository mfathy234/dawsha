import type { EditChange } from './editChange'
import type { SessionState } from './sessionState'

export type TimelineKind = 'prompt' | 'reply' | 'read' | 'edit' | 'command' | 'test' | 'error' | 'state' | 'approval'

export interface TimelineEvent {
  id: string
  at: number
  kind: TimelineKind
  /** The words shown for the event and searched by the search box. */
  text: string
  path?: string
  paths?: string[]
  added?: number
  removed?: number
  /** The text an edit wrote, for finding its lines again. */
  change?: EditChange
  /** Edit calls are attempts until the transcript records a successful tool result. */
  editStatus?: 'pending' | 'succeeded' | 'failed'
  editCompletedAt?: number
  command?: string
  passed?: number
  failed?: number
  ok?: boolean
  state?: SessionState
  allowed?: boolean
  source?: 'desktop'
}

export type TimelineFilter = 'all' | 'prompts' | 'edits' | 'commands' | 'approvals' | 'tests'

export const TIMELINE_FILTERS: readonly { id: TimelineFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'edits', label: 'Edits' },
  { id: 'commands', label: 'Commands' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'tests', label: 'Tests' }
]

const FILTER_KINDS: Record<Exclude<TimelineFilter, 'all'>, readonly TimelineKind[]> = {
  prompts: ['prompt'],
  edits: ['edit'],
  commands: ['command', 'test'],
  approvals: ['approval'],
  tests: ['test']
}

export function filterEvents(events: readonly TimelineEvent[], filter: TimelineFilter): TimelineEvent[] {
  if (filter === 'all') return [...events]
  const kinds = FILTER_KINDS[filter]
  return events.filter((event) => kinds.includes(event.kind))
}

export const basename = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path

/** The path relative to the project folder when it lies inside it, with forward slashes. */
export function relativePath(path: string, folder: string): string {
  const clean = path.replace(/\\/g, '/')
  const root = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  if (root !== '' && clean.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return clean.slice(root.length + 1)
  return clean.replace(/^\.\//, '')
}

export const formatClock = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function formatSpan(ms: number): string {
  if (ms < 60_000) return ms >= 1000 ? `${Math.round(ms / 1000)}s` : '0m'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** Merges the session log's events with the ones this app recorded, oldest first. Reads that follow each other collapse into one. */
export function mergeTimeline(log: readonly TimelineEvent[], local: readonly TimelineEvent[]): TimelineEvent[] {
  const all = [...log, ...local].map((event, index) => ({ event, index }))
  all.sort((a, b) => a.event.at - b.event.at || a.index - b.index)
  const out: TimelineEvent[] = []
  for (const { event } of all) {
    const last = out[out.length - 1]
    if (event.kind === 'read' && last?.kind === 'read') {
      const paths = [...(last.paths ?? []), ...(event.paths ?? [])]
      out[out.length - 1] = { ...last, paths, text: readText(paths) }
      continue
    }
    out.push(event)
  }
  return out.map((event, index) => ({ ...event, id: `${index}` }))
}

export function readText(paths: readonly string[]): string {
  const unique = new Set(paths)
  const count = Math.max(unique.size, 1)
  const first = [...unique][0]
  if (count === 1 && first) return `Read ${basename(first)}`
  return `Read ${count} files`
}

export interface StateSegment {
  state: SessionState
  start: number
  end: number
}

/** Turns the recorded state changes into spans, the last one running to `end`. */
export function stateSegments(events: readonly TimelineEvent[], end: number): StateSegment[] {
  const changes = events.filter((event) => event.kind === 'state' && event.state)
  const out: StateSegment[] = []
  changes.forEach((event, index) => {
    const next = changes[index + 1]
    const stop = next ? next.at : Math.max(end, event.at)
    if (stop > event.at) out.push({ state: event.state as SessionState, start: event.at, end: stop })
  })
  return out
}

export interface TimelineSpan {
  startedAt: number
  endedAt: number
}

export function timelineSpan(events: readonly TimelineEvent[], now: number, live: boolean): TimelineSpan | null {
  if (events.length === 0) return null
  const startedAt = Math.min(...events.map((event) => event.at))
  const last = Math.max(...events.map((event) => event.at))
  return { startedAt, endedAt: live ? Math.max(now, last) : last }
}

export interface TestTrendPoint {
  at: number
  ok: boolean
  passed?: number
  failed?: number
}

export interface TimelineInsights {
  time: { working: number; needs: number; done: number } | null
  waits: { total: number; longest: number; count: number } | null
  files: { path: string; edits: number; added: number; removed: number }[]
  commands: number
  tests: TestTrendPoint[]
  permissions: { prompts: number; allowed: number; denied: number } | null
}

const TOP_FILES = 5

export function computeInsights(events: readonly TimelineEvent[], now: number): TimelineInsights {
  const segments = stateSegments(events, now)
  const spent = (state: SessionState): number =>
    segments.filter((segment) => segment.state === state).reduce((sum, segment) => sum + (segment.end - segment.start), 0)
  const needs = segments.filter((segment) => segment.state === 'needs')
  const byFile = new Map<string, { path: string; edits: number; added: number; removed: number }>()
  for (const event of events) {
    if (event.kind !== 'edit' || !event.path) continue
    const known = byFile.get(event.path) ?? { path: event.path, edits: 0, added: 0, removed: 0 }
    byFile.set(event.path, {
      path: event.path,
      edits: known.edits + 1,
      added: known.added + (event.added ?? 0),
      removed: known.removed + (event.removed ?? 0)
    })
  }
  const files = [...byFile.values()].sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path)).slice(0, TOP_FILES)
  const tests = events
    .filter((event) => event.kind === 'test')
    .map((event): TestTrendPoint => ({
      at: event.at,
      ok: event.ok ?? (event.failed ?? 0) === 0,
      passed: event.passed,
      failed: event.failed
    }))
  const approvals = events.filter((event) => event.kind === 'approval')
  const prompts = events.filter((event) => event.kind === 'state' && event.state === 'needs').length
  const allowed = approvals.filter((event) => event.allowed === true).length
  return {
    time: segments.length === 0 ? null : { working: spent('working'), needs: spent('needs'), done: spent('done') },
    waits:
      needs.length === 0
        ? null
        : {
            total: needs.reduce((sum, segment) => sum + (segment.end - segment.start), 0),
            longest: Math.max(...needs.map((segment) => segment.end - segment.start)),
            count: needs.length
          },
    files,
    commands: events.filter((event) => event.kind === 'command' || event.kind === 'test').length,
    tests,
    permissions: prompts + approvals.length === 0 ? null : { prompts: Math.max(prompts, approvals.length), allowed, denied: approvals.length - allowed }
  }
}

const STATE_WORDS: Record<SessionState, string> = {
  needs: 'Needs you',
  working: 'Working',
  done: 'Done',
  idle: 'Idle',
  exited: 'Exited'
}

export const stateWord = (state: SessionState): string => STATE_WORDS[state]

export function approvalText(event: Pick<TimelineEvent, 'allowed' | 'text'>): string {
  const verb = event.allowed ? 'Allowed' : 'Denied'
  return event.text ? `${verb}: ${event.text}` : `${verb} a permission prompt`
}

const needle = (query: string): string => query.trim().toLowerCase()

export function eventSearchText(event: TimelineEvent): string {
  const parts = [event.text, event.path, event.command, ...(event.paths ?? [])]
  return parts.filter((part): part is string => Boolean(part)).join('\n')
}

export function searchEvents(events: readonly TimelineEvent[], query: string): number[] {
  const wanted = needle(query)
  if (wanted === '') return []
  const hits: number[] = []
  events.forEach((event, index) => {
    if (eventSearchText(event).toLowerCase().includes(wanted)) hits.push(index)
  })
  return hits
}

export interface TextPart {
  text: string
  match: boolean
}

export function highlightParts(text: string, query: string): TextPart[] {
  const wanted = needle(query)
  if (wanted === '' || text === '') return [{ text, match: false }]
  const lower = text.toLowerCase()
  const parts: TextPart[] = []
  let from = 0
  for (let at = lower.indexOf(wanted, from); at >= 0; at = lower.indexOf(wanted, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false })
    parts.push({ text: text.slice(at, at + wanted.length), match: true })
    from = at + wanted.length
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false })
  return parts
}

/** Next hit index (wrapping) from the current one; direction 1 forward, -1 back. */
export function stepMatch(count: number, current: number, direction: 1 | -1): number {
  if (count === 0) return -1
  if (current < 0) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}

export interface TimelineMarkdownInput {
  title: string
  events: readonly TimelineEvent[]
  insights: TimelineInsights
  span: TimelineSpan | null
  prompts: number
  costUsd?: number | null
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()
const tick = (text: string): string => `\`${text.replace(/`/g, "'")}\``

export function eventMarkdown(event: TimelineEvent): string {
  switch (event.kind) {
    case 'prompt':
      return `**You:** ${oneLine(event.text)}`
    case 'reply':
      return `**Agent:** ${oneLine(event.text)}`
    case 'read':
      return event.text
    case 'edit':
      return `Edited ${tick(event.path ?? event.text)}${event.added || event.removed ? ` (+${event.added ?? 0} -${event.removed ?? 0})` : ''}`
    case 'command':
      return `Ran ${tick(oneLine(event.command ?? event.text))}`
    case 'test':
      return `Tests ${tick(oneLine(event.command ?? 'tests'))}: ${event.text}`
    case 'error':
      return `Error: ${oneLine(event.text)}`
    case 'approval':
      return approvalText(event)
    case 'state':
      return event.state ? stateWord(event.state) : event.text
  }
}

export function insightLines(insights: TimelineInsights, costUsd?: number | null): string[] {
  const lines: string[] = []
  if (insights.time) {
    const { working, needs, done } = insights.time
    lines.push(`Time: working ${formatSpan(working)}, needs you ${formatSpan(needs)}, done ${formatSpan(done)}`)
  }
  if (insights.waits) {
    lines.push(`You kept it waiting ${formatSpan(insights.waits.total)} in total, longest ${formatSpan(insights.waits.longest)}`)
  }
  if (insights.files.length > 0) {
    lines.push(`Files touched most: ${insights.files.map((file) => `${tick(file.path)} (${file.edits})`).join(', ')}`)
  }
  if (insights.commands > 0) lines.push(`Commands run: ${insights.commands}`)
  if (insights.tests.length > 0) {
    lines.push(`Test runs: ${insights.tests.length} (${insights.tests.map((run) => (run.ok ? 'pass' : 'fail')).join(', ')})`)
  }
  if (insights.permissions) {
    const { prompts, allowed, denied } = insights.permissions
    lines.push(`Permission prompts: ${prompts} (${allowed} allowed, ${denied} denied from here)`)
  }
  if (costUsd !== undefined && costUsd !== null) lines.push(`Cost: $${costUsd.toFixed(2)}`)
  return lines
}

export function renderTimelineMarkdown(input: TimelineMarkdownInput): string {
  const out: string[] = [`# Timeline: ${oneLine(input.title) || 'Session'}`]
  const facts: string[] = []
  if (input.span) facts.push(formatSpan(input.span.endedAt - input.span.startedAt))
  facts.push(`${input.prompts} prompt${input.prompts === 1 ? '' : 's'}`)
  out.push(facts.join(' · '))
  const insights = insightLines(input.insights, input.costUsd)
  if (insights.length > 0) out.push('## Insights', insights.map((line) => `- ${line}`).join('\n'))
  out.push(
    '## Events',
    input.events.length === 0
      ? '_No events yet._'
      : input.events.map((event) => `- ${formatClock(event.at)} ${eventMarkdown(event)}`).join('\n')
  )
  return `${out.join('\n\n')}\n`
}

export function timelineFileName(project: string, now: Date): string {
  const slug = project.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'session'
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${slug}-timeline-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}.md`
}

export interface TimelineRequest {
  agent: 'claude' | 'codex' | 'gemini' | 'shell'
  sessionId?: string
  folder: string
  /** The version of the events the caller already holds; an unchanged log answers 'unchanged'. */
  version?: string
}

export type TimelineResult =
  | { status: 'ok'; events: TimelineEvent[]; version: string; truncated: boolean }
  | { status: 'unchanged' }
  | { status: 'no-session' }

export const TIMELINE_EXPORT_MAX = 5 * 1024 * 1024

export interface TimelineExportRequest {
  name: string
  text: string
}

export type TimelineExportResult =
  | { status: 'saved'; path: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
