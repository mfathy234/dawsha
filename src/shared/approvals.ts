import { detectPermissionPrompt } from './permissionPrompt'

export type ApprovalKind = 'command' | 'edit' | 'other'
export type ApprovalRestriction = 'outside-project' | 'config'
export type ApprovalAnswerSource = 'phone' | 'desktop'

export type ApprovalSelection = 'allow-once' | 'other' | 'unknown'
export type AllowBlock = ApprovalRestriction | 'truncated' | 'kind' | 'selection'

export interface ExtractedPrompt {
  selected: ApprovalSelection
  truncated: boolean
  text: string
  kind: ApprovalKind
  summary: string
  fingerprint: string
}

export interface ApprovalItem {
  id: string
  projectId: string | null
  projectName: string
  agent: string
  title: string
  text: string
  kind: ApprovalKind
  summary: string
  fingerprint: string
  since: number
  restriction: ApprovalRestriction | null
  allowBlock: AllowBlock | null
  canAllow: boolean
}

export interface ApprovalHistoryEntry {
  id: string
  time: number
  allowed: boolean
  summary: string
  kind: ApprovalKind
  agent: string
  projectName: string
  source: ApprovalAnswerSource
  device: string
  reason: boolean
}

export interface ApprovalsPayload {
  items: ApprovalItem[]
  history: ApprovalHistoryEntry[]
  notify: boolean
}

export const MAX_PROMPT_TEXT = 1500
export const MAX_SUMMARY = 120
export const MAX_REASON = 280
export const MAX_HISTORY = 50
const TAIL_LINES = 18
const CONTEXT_LINES = 6
const HEADER_WINDOW = 14
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]', 'g')
const BOX_EDGES = /^[\s│┃|╭╮╰╯─━]+|[\s│┃|╭╮╰╯─━]+$/g
const OPTION_LINE = /^\W{0,3}\d\.\s+\S/
const HINT_LINE = /Esc to cancel|esc to cancel/
const COMMAND_HEADER = /\b(Bash command|run the following command|run this command|Run shell command|Allow execution|wants to run|Shell command)\b/i
const EDIT_HEADER = /\b(Edit file|Create file|Write file|Update file|Overwrite file|make (?:this|the following) edits?|Apply (?:this )?(?:change|patch)|edit to|wants to (?:edit|create|write)|Do you want to (?:create|overwrite|write))\b/i
const CURSOR_OPTION = /^[❯›▶●◉>]\s*(\d)\.\s+(.*)$/
const ALLOW_ONCE_LABEL = /^(Yes|Allow once|Yes, proceed|Yes, just this once)\b/i
const BROAD_LABEL = /(don'?t ask|do not ask|always|all edits|allow all|this session|every time|and allow|remember|from now on)/i
const QUESTION = /Do you want to|Would you like to|Allow |Apply this/i

export function stripAnsi(value: string): string {
  return value.replace(ANSI, '')
}

export function hashText(value: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0'))
}

function cleanLines(tail: string): string[] {
  return stripAnsi(tail).split('\n').map((line) => line.replace(/\r/g, '').replace(BOX_EDGES, '')).filter((line) => line.trim() !== '').slice(-TAIL_LINES)
}

function cap(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

export function classifyPrompt(text: string): ApprovalKind {
  const command = COMMAND_HEADER.exec(text)
  const edit = EDIT_HEADER.exec(text)
  if (command && (!edit || command.index <= edit.index)) return 'command'
  if (edit) return 'edit'
  return 'other'
}

export function extractPaths(text: string): string[] {
  const found = new Set<string>()
  for (const raw of text.split(/[\s"'`(),;<>[\]{}=]+/)) {
    const token = raw.replace(/^[+\-*]+(?=[./~\w])/, '').replace(/[:?!.]+$/, '')
    if (token.length < 2 || token.length > 260 || /^[a-z]+:\/\//i.test(token)) continue
    const hasSeparator = /[\\/]/.test(token)
    const hasExtension = /[A-Za-z0-9_-]\.[A-Za-z0-9]{1,8}$/.test(token)
    const dotfile = /^\.[A-Za-z]/.test(token)
    if (hasSeparator || hasExtension || dotfile) found.add(token)
  }
  return [...found]
}

function summarize(lines: string[], kind: ApprovalKind): string {
  if (kind === 'command') {
    const header = lines.findIndex((line) => COMMAND_HEADER.test(line))
    const after = header >= 0 ? lines.slice(header + 1) : []
    const body = after.find((line) => !QUESTION.test(line) && !OPTION_LINE.test(line))
    if (body) return cap(body.replace(/^[$>]\s*/, '').trim(), MAX_SUMMARY)
  }
  if (kind === 'edit') {
    const path = lines.flatMap((line) => extractPaths(line)).find((token) => /[\\/]/.test(token) || /\.[A-Za-z0-9]{1,8}$/.test(token))
    if (path) return cap(`Edit ${path}`, MAX_SUMMARY)
  }
  const question = lines.findLastIndex((line) => QUESTION.test(line))
  const pick = question > 0 ? lines[question - 1] : lines[0] ?? ''
  return cap(pick.trim(), MAX_SUMMARY)
}

export function selectedOption(options: string[]): ApprovalSelection {
  for (const line of options) {
    const match = CURSOR_OPTION.exec(line)
    if (!match) continue
    const label = match[2].replace(/’/g, "'")
    return match[1] === '1' && ALLOW_ONCE_LABEL.test(label) && !BROAD_LABEL.test(label) ? 'allow-once' : 'other'
  }
  return 'unknown'
}

export function extractPermissionPrompt(tail: string): ExtractedPrompt | null {
  if (!detectPermissionPrompt(stripAnsi(tail))) return null
  const lines = cleanLines(tail)
  const yes = lines.findLastIndex((line) => /\b1\.\s+Yes\b/.test(line))
  if (yes < 0) return null
  let end = yes
  for (let index = yes; index < lines.length; index += 1) {
    if (OPTION_LINE.test(lines[index]) || HINT_LINE.test(lines[index])) end = index
  }
  const windowStart = Math.max(0, yes - HEADER_WINDOW)
  const found = lines.slice(windowStart, yes).findIndex((line) => COMMAND_HEADER.test(line) || EDIT_HEADER.test(line))
  const block = lines.slice(found >= 0 ? windowStart + found : Math.max(0, yes - CONTEXT_LINES), end + 1)
  const joined = block.join('\n')
  const truncated = found < 0 || joined.length > MAX_PROMPT_TEXT
  const text = joined.length > MAX_PROMPT_TEXT ? `…${joined.slice(joined.length - MAX_PROMPT_TEXT + 1)}` : joined
  const kind = classifyPrompt(text)
  return { selected: selectedOption(lines.slice(yes, end + 1)), truncated, text, kind, summary: summarize(block, kind), fingerprint: hashText(text) }
}

const CONFIG_PATTERNS: RegExp[] = [
  /(^|\/)\.(github|claude|git|husky|vscode)\//,
  /(^|\/)\.npmrc$/,
  /(^|\/)makefile$/,
  /\.(sh|ps1|bat|cmd)$/,
  /(^|\/)\.gitlab-ci\.ya?ml$/,
  /\.ya?ml$/,
  /(^|\/)package\.json$/,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|poetry\.lock|gemfile\.lock|composer\.lock|go\.sum)$/,
  /(^|\/)\.env([./].*)?$/,
  /(^|\/)(jenkinsfile|dockerfile)$/
]

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function isConfigPath(path: string): boolean {
  const normalized = normalizePath(path)
  return CONFIG_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isOutsideProject(path: string, folder: string | null): boolean {
  const normalized = normalizePath(path)
  if (normalized.split('/').includes('..')) return true
  const absolute = /^[a-z]:\//.test(normalized) || normalized.startsWith('/') || normalized.startsWith('~')
  if (!absolute) return false
  if (!folder) return true
  const root = normalizePath(folder)
  return !(normalized === root || normalized.startsWith(`${root}/`))
}

/**
 * Best effort: reads path-like words out of the prompt text, so a path the agent does not print
 * (or prints in a form this does not recognise) is not caught. Commands are not checked.
 */
export function editRestriction(kind: ApprovalKind, text: string, folder: string | null): ApprovalRestriction | null {
  if (kind === 'command') return null
  const paths = extractPaths(text)
  if (paths.some((path) => isOutsideProject(path, folder))) return 'outside-project'
  if (paths.some((path) => isConfigPath(path))) return 'config'
  return null
}

/** One line of plain text for the agent: no control characters and no leading slash-command or shell marker. */
export function sanitizeDenyReason(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(CONTROL, ' ').replace(/\s+/g, ' ').replace(/^[\s/!#@]+/, '').trim().slice(0, MAX_REASON).trim()
}

export function pushHistory(history: ApprovalHistoryEntry[], entry: ApprovalHistoryEntry): ApprovalHistoryEntry[] {
  return [entry, ...history].slice(0, MAX_HISTORY)
}

export function waitingLabel(since: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - since) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
