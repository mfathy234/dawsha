/** What the owner and Dawsha remember about one session besides its terminal: unread, a note, a snooze and a when-done rule. */

export const NOTE_MAX = 200
export const RULE_TRIES_MAX = 10
export const RULE_TRIES_DEFAULT = 3
export const RULE_COMMANDS_MAX = 8
export const HOUR_MS = 3_600_000
export const TOMORROW_HOUR = 9

export type SnoozeKind = 'time' | 'checks' | 'needs'
export type RulePass = 'nothing' | 'commit' | 'notify'

export interface CareNote {
  text: string
  at: number
}

export interface Snooze {
  kind: SnoozeKind
  /** When a timed snooze ends; null for the other kinds. */
  until: number | null
  /** How it reads in the sidebar fold, such as "1 hour". */
  label: string
}

export interface DoneRule {
  /** Ids of the project's run commands to run in the session's folder. */
  commandIds: string[]
  /** How many times a failure may go back to the agent in a row. */
  tries: number
  onPass: RulePass
}

export interface SessionCare {
  unread?: true
  note?: CareNote
  snooze?: Snooze
  rule?: DoneRule
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function sanitizeNote(value: unknown): CareNote | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null
  const text = value.text.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX)
  const at = typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0
  return text ? { text, at } : null
}

function sanitizeSnooze(value: unknown): Snooze | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (kind !== 'time' && kind !== 'checks' && kind !== 'needs') return null
  const until = typeof value.until === 'number' && Number.isFinite(value.until) ? value.until : null
  if (kind === 'time' && until === null) return null
  const label = typeof value.label === 'string' ? value.label.slice(0, 60) : ''
  return { kind, until: kind === 'time' ? until : null, label }
}

export function sanitizeRule(value: unknown): DoneRule | null {
  if (!isRecord(value)) return null
  const ids = Array.isArray(value.commandIds) ? value.commandIds : []
  const commandIds = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 512 && !id.includes('\0')))].slice(0, RULE_COMMANDS_MAX)
  if (commandIds.length === 0) return null
  const tries = typeof value.tries === 'number' && Number.isFinite(value.tries) ? Math.min(RULE_TRIES_MAX, Math.max(0, Math.round(value.tries))) : RULE_TRIES_DEFAULT
  const onPass: RulePass = value.onPass === 'commit' || value.onPass === 'notify' ? value.onPass : 'nothing'
  return { commandIds, tries, onPass }
}

/** Keeps only well-formed parts; nothing left means no care at all. */
export function sanitizeCare(value: unknown): SessionCare | undefined {
  if (!isRecord(value)) return undefined
  const care: SessionCare = {}
  if (value.unread === true) care.unread = true
  const note = sanitizeNote(value.note)
  if (note) care.note = note
  const snooze = sanitizeSnooze(value.snooze)
  if (snooze) care.snooze = snooze
  const rule = sanitizeRule(value.rule)
  if (rule) care.rule = rule
  return Object.keys(care).length > 0 ? care : undefined
}

/** The care with some parts replaced; a key set to undefined is removed, and empty care becomes undefined. */
export function withCare(care: SessionCare | undefined, patch: { [K in keyof SessionCare]?: SessionCare[K] | undefined }): SessionCare | undefined {
  const next: SessionCare = { ...care }
  for (const key of Object.keys(patch) as (keyof SessionCare)[]) {
    if (patch[key] === undefined) delete next[key]
    else (next as Record<string, unknown>)[key] = patch[key]
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export const isUnreadCare = (care: SessionCare | undefined): boolean => care?.unread === true
export const isSnoozedCare = (care: SessionCare | undefined): boolean => care?.snooze !== undefined

/** Nine in the morning on the next calendar day, in the local zone. */
export function tomorrowMorning(now: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, TOMORROW_HOUR, 0, 0, 0).getTime()
}

export type SnoozeChoice = 'hour' | 'tomorrow' | 'checks' | 'needs'

export const SNOOZE_LABELS: Readonly<Record<SnoozeChoice, string>> = {
  hour: '1 hour',
  tomorrow: 'Tomorrow 9:00',
  checks: 'Until its PR checks finish',
  needs: 'Until it needs me'
}

export function snoozeFor(choice: SnoozeChoice, now: number): Snooze {
  if (choice === 'hour') return { kind: 'time', until: now + HOUR_MS, label: SNOOZE_LABELS.hour }
  if (choice === 'tomorrow') return { kind: 'time', until: tomorrowMorning(now), label: SNOOZE_LABELS.tomorrow }
  return { kind: choice, until: null, label: SNOOZE_LABELS[choice] }
}

export interface WakeFacts {
  now: number
  /** The session needs the owner (a question or a permission). */
  needs: boolean
  /** The session's PR has checks still running; null when no PR is known. */
  checksPending: boolean | null
}

/** A snooze ends on its own terms, and always when the session needs the owner. */
export function shouldWake(snooze: Snooze, facts: WakeFacts): boolean {
  if (facts.needs) return true
  if (snooze.kind === 'time') return snooze.until !== null && facts.now >= snooze.until
  if (snooze.kind === 'checks') return facts.checksPending === false
  return false
}

export const noteLine = (note: CareNote | undefined): string => (note ? `Next: ${note.text}` : '')

/** "you, yesterday 18:40" style stamp for a note. */
export function noteStamp(note: CareNote, now: number): string {
  const date = new Date(note.at)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(note.at).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return `today ${time}`
  if (days === 1) return `yesterday ${time}`
  return `${days} days ago`
}
