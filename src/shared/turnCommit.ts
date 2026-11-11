/** Helpers for "Commit this reply": the suggested message and the wording around the commit box. */

const FEAT = /\b(add|adds|added|implement|create|introduce|support|new|build)\b/i
const FIX = /\b(fix|fixes|fixed|bug|error|crash|broken|wrong|regression|issue|fail|failing)\b/i
const DOCS = /\b(docs?|readme|changelog|documentation|comment)\b/i
const TEST = /\b(tests?|spec|coverage)\b/i
const REFACTOR = /\b(refactor|tidy|rename|clean ?up|restructure|simplify|extract|move)\b/i
const PERF = /\b(perf|performance|faster|speed|slow|optimi[sz]e)\b/i

const PRELUDE = /^(?:sure|okay|ok|done|great|alright|all set|i(?:'ve| have| will|'ll)|let me|here(?:'s| is))[,.:!]?\s+/i
const MAX_SUBJECT = 72

export type CommitType = 'feat' | 'fix' | 'docs' | 'test' | 'refactor' | 'perf' | 'chore'

export function commitTypeFor(request: string): CommitType {
  if (FIX.test(request)) return 'fix'
  if (PERF.test(request)) return 'perf'
  if (REFACTOR.test(request)) return 'refactor'
  if (DOCS.test(request) && !FEAT.test(request)) return 'docs'
  if (TEST.test(request) && !FEAT.test(request)) return 'test'
  if (FEAT.test(request)) return 'feat'
  return 'chore'
}

const firstLine = (text: string): string => {
  const line = text.split(/\r?\n/).map((part) => part.replace(/^[#>*\-\s`]+/, '').trim()).find((part) => part !== '')
  return line ?? ''
}

function tidy(text: string): string {
  let line = firstLine(text).replace(/`/g, '')
  for (let pass = 0; pass < 2; pass += 1) line = line.replace(PRELUDE, '')
  line = line.split(/(?<=[.!?])\s/)[0] ?? line
  line = line.replace(/[.:!\s]+$/, '')
  return line.charAt(0).toLowerCase() + line.slice(1)
}

function fit(text: string): string {
  if (text.length <= MAX_SUBJECT) return text
  const cut = text.slice(0, MAX_SUBJECT - 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > 30 ? cut.slice(0, at) : cut).trimEnd()}…`
}

export interface MessageInput {
  /** What the user asked for. */
  request: string
  /** The agent's reply text. */
  reply: string
}

/** A conventional-commit subject built on this machine from the request and the first line of the reply. */
export function suggestCommitMessage(input: MessageInput): string {
  const type = commitTypeFor(input.request || input.reply)
  const fromReply = tidy(input.reply)
  const fromRequest = tidy(input.request)
  const usable = (text: string): boolean => text.length >= 8 && text.length <= 90
  const subject = usable(fromReply) ? fromReply : usable(fromRequest) ? fromRequest : fromReply || fromRequest || 'update files'
  return `${type}: ${fit(subject)}`
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** "Commits these 2 files on fix/date-parsing. 3 other changed files stay uncommitted." */
export function commitNote(count: number, branch: string, others: number): string {
  const where = branch ? ` on ${branch}` : ''
  const rest = others > 0 ? ` ${plural(others, 'other changed file')} stay${others === 1 ? 's' : ''} uncommitted.` : ''
  return `Commits ${count === 1 ? 'this file' : `these ${count} files`}${where}.${rest}`
}

export const commitButtonLabel = (count: number): string => `Commit ${plural(count, 'file')}`

export interface CommitFile {
  path: string
  /** Edited since the reply, by the user or another session. */
  other: boolean
}

/** The paths ticked at first: every file the reply changed except those edited since. */
export const initialTicks = (files: readonly CommitFile[]): string[] => files.filter((file) => !file.other).map((file) => file.path)
