import { toProjectPath } from './projectPaths'

export type DraftAuthor = 'you' | 'reviewer'
export type DraftStatus = 'open' | 'sent' | 'dismissed'
export type Severity = 'high' | 'medium' | 'low' | 'info'

export const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low', 'info']

/** What a reviewer said about a line, kept with the comment so the card can show it. */
export interface ReviewerNote {
  agent: string
  severity: Severity
  title: string
  fix: string
}

/** A review comment on a line of a diff. Open ones are drafts; sent ones stay as resolved history. */
export interface ReviewDraft {
  id: string
  /** The checkout the diff is from. */
  folder: string
  /** The session the comment is for, when it was written from one. */
  paneId?: string
  /** Repo-relative path, as Files lists it. */
  path: string
  line: number
  endLine?: number
  /** A short hash of the line's text when the comment was written, to find the line again after it moves. */
  hash: string
  /** A few lines around the commented line, as sent to the agent. */
  snippet: string[]
  text: string
  author: DraftAuthor
  status: DraftStatus
  createdAt: number
  sentAt?: number
  reviewer?: ReviewerNote
}

export const MAX_DRAFTS = 300
export const MAX_TEXT = 4000
const SNIPPET_LINES = 3
const SNIPPET_CHARS = 160
const SEARCH_LIMIT = 4000

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** A short, stable hash of a line's text, ignoring spacing at the ends and runs of blanks. */
export function lineHash(text: string): string {
  const clean = oneLine(text)
  let hash = 0x811c9dc5
  for (let index = 0; index < clean.length; index += 1) {
    hash ^= clean.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).padStart(6, '0').slice(-6)
}

export interface Anchor {
  /** The line the comment belongs to now, or null when its line is gone. */
  line: number | null
  outdated: boolean
  moved: boolean
}

/** Where a comment sits in the file as it is now: the same line if it still matches, else the nearest line with the same content, else outdated. */
export function anchorDraft(draft: Pick<ReviewDraft, 'line' | 'hash'>, lines: readonly string[]): Anchor {
  const at = draft.line
  // Without a hash (a finding whose file could not be read) the line number is all there is.
  if (draft.hash === '') return { line: at >= 1 && at <= lines.length ? at : null, outdated: !(at >= 1 && at <= lines.length), moved: false }
  if (at >= 1 && at <= lines.length && lineHash(lines[at - 1]) === draft.hash) return { line: at, outdated: false, moved: false }
  let best: number | null = null
  const limit = Math.min(lines.length, SEARCH_LIMIT * 2)
  for (let index = 0; index < limit; index += 1) {
    if (lineHash(lines[index]) !== draft.hash) continue
    const number = index + 1
    if (best === null || Math.abs(number - at) < Math.abs(best - at)) best = number
  }
  if (best === null) return { line: null, outdated: true, moved: false }
  return { line: best, outdated: false, moved: best !== at }
}

const clip = (text: string): string => (text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}…` : text)

/** The commented line with the line before it, as diff-style rows: `+` for a line the agent added, a space for the rest. */
export function snippetAt(lines: readonly string[], line: number, added: ReadonlySet<number> = new Set()): string[] {
  if (line < 1 || line > lines.length) return []
  const from = Math.max(1, line - (SNIPPET_LINES - 2))
  const to = Math.min(lines.length, line + (SNIPPET_LINES - 2))
  const rows: string[] = []
  for (let number = from; number <= to; number += 1) rows.push(`${added.has(number) ? '+' : ' '} ${clip(lines[number - 1].replace(/\s+$/, ''))}`)
  return rows
}

export interface NewDraft {
  folder: string
  paneId?: string
  path: string
  line: number
  endLine?: number
  lineText: string
  snippet: string[]
  text: string
  author?: DraftAuthor
  reviewer?: ReviewerNote
}

export function makeDraft(input: NewDraft, id: string, now: number): ReviewDraft {
  return {
    id,
    folder: input.folder,
    ...(input.paneId ? { paneId: input.paneId } : {}),
    path: input.path,
    line: input.line,
    ...(input.endLine && input.endLine > input.line ? { endLine: input.endLine } : {}),
    hash: input.lineText === '' ? '' : lineHash(input.lineText),
    snippet: input.snippet.slice(0, SNIPPET_LINES),
    text: input.text,
    author: input.author ?? 'you',
    status: 'open',
    createdAt: now,
    ...(input.reviewer ? { reviewer: input.reviewer } : {})
  }
}

/** Comments in file and line order, with empty and dismissed ones dropped. */
export function sendable(drafts: readonly ReviewDraft[]): ReviewDraft[] {
  return drafts
    .filter((draft) => draft.status === 'open' && oneLine(draft.text) !== '')
    .slice()
    .sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1))
}

const lineRef = (draft: ReviewDraft): string => (draft.endLine ? `${draft.line}-${draft.endLine}` : String(draft.line))

export interface MessageOptions {
  /** The project's place inside its repository, so paths read as the agent sees them from its folder. */
  prefix?: string
  note?: string
}

/** One compact message for the session: for each comment its file and lines, a few rows of the diff, and the comment. */
export function buildDraftMessage(drafts: readonly ReviewDraft[], options: MessageOptions = {}): string {
  const ordered = sendable(drafts)
  if (ordered.length === 0) return ''
  const count = ordered.length
  const lines = [`Review of your changes: ${count} comment${count === 1 ? '' : 's'}.`]
  ordered.forEach((draft, index) => {
    lines.push('', `${index + 1}. ${toProjectPath(options.prefix ?? '', draft.path)}:${lineRef(draft)}`)
    for (const row of draft.snippet) lines.push(`   ${row}`)
    lines.push(`   ${draft.reviewer ? `Reviewer (${draft.reviewer.severity}): ` : ''}${oneLine(draft.text)}`)
    if (draft.reviewer?.fix) lines.push(`   Suggested fix: ${oneLine(draft.reviewer.fix)}`)
  })
  const overall = oneLine(options.note ?? '')
  if (overall) lines.push('', `Overall: ${overall}`)
  return lines.join('\n')
}

export function markSent(drafts: readonly ReviewDraft[], ids: ReadonlySet<string>, at: number): ReviewDraft[] {
  return drafts.map((draft) => (ids.has(draft.id) ? { ...draft, status: 'sent' as const, sentAt: at } : draft))
}

export const openDrafts = (drafts: readonly ReviewDraft[], folder: string): ReviewDraft[] => drafts.filter((draft) => draft.folder === folder && draft.status === 'open')

const isStatus = (value: unknown): value is DraftStatus => value === 'open' || value === 'sent' || value === 'dismissed'
const isSeverity = (value: unknown): value is Severity => SEVERITIES.includes(value as Severity)
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

function sanitizeNote(value: unknown): ReviewerNote | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (!isSeverity(raw.severity)) return undefined
  return { agent: text(raw.agent, 40), severity: raw.severity, title: text(raw.title, 200), fix: text(raw.fix, MAX_TEXT) }
}

function sanitizeOne(value: unknown): ReviewDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const line = typeof raw.line === 'number' && Number.isInteger(raw.line) && raw.line >= 0 ? raw.line : null
  if (typeof raw.id !== 'string' || raw.id === '' || typeof raw.folder !== 'string' || typeof raw.path !== 'string' || raw.path === '' || line === null) return null
  const body = text(raw.text, MAX_TEXT)
  if (oneLine(body) === '') return null
  const reviewer = sanitizeNote(raw.reviewer)
  return {
    id: raw.id.slice(0, 80),
    folder: raw.folder,
    ...(typeof raw.paneId === 'string' && raw.paneId !== '' ? { paneId: raw.paneId } : {}),
    path: raw.path,
    line,
    ...(typeof raw.endLine === 'number' && Number.isInteger(raw.endLine) && raw.endLine > line ? { endLine: raw.endLine } : {}),
    hash: text(raw.hash, 12),
    snippet: Array.isArray(raw.snippet) ? raw.snippet.filter((row): row is string => typeof row === 'string').slice(0, SNIPPET_LINES).map(clip) : [],
    text: body,
    author: raw.author === 'reviewer' ? 'reviewer' : 'you',
    status: isStatus(raw.status) ? raw.status : 'open',
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    ...(typeof raw.sentAt === 'number' && Number.isFinite(raw.sentAt) ? { sentAt: raw.sentAt } : {}),
    ...(reviewer ? { reviewer } : {})
  }
}

/** Saved drafts read back safely; when there are too many, the oldest finished ones go first. */
export function sanitizeDrafts(value: unknown): ReviewDraft[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const all: ReviewDraft[] = []
  for (const entry of value) {
    const draft = sanitizeOne(entry)
    if (!draft || seen.has(draft.id)) continue
    seen.add(draft.id)
    all.push(draft)
  }
  return keepDrafts(all)
}

export function keepDrafts(drafts: readonly ReviewDraft[]): ReviewDraft[] {
  if (drafts.length <= MAX_DRAFTS) return [...drafts]
  const done = drafts.filter((draft) => draft.status !== 'open').sort((a, b) => a.createdAt - b.createdAt)
  const drop = new Set(done.slice(0, drafts.length - MAX_DRAFTS).map((draft) => draft.id))
  const rest = drafts.filter((draft) => !drop.has(draft.id))
  return rest.slice(Math.max(0, rest.length - MAX_DRAFTS))
}
