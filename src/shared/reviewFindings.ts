import { SEVERITIES, type Severity } from './reviewDrafts'
import type { AgentKind } from './types'

export interface Finding {
  file: string
  line: number
  severity: Severity
  title: string
  explanation: string
  fix: string
}

export type ReviewScope = 'reply' | 'session' | 'uncommitted'

export const REVIEW_SCOPES: readonly { id: ReviewScope; label: string; detail: string }[] = [
  { id: 'reply', label: 'Last reply', detail: 'Only what the last reply changed' },
  { id: 'session', label: 'Whole session', detail: 'Everything this session changed' },
  { id: 'uncommitted', label: 'Uncommitted changes', detail: 'Everything not committed yet in this folder' }
]

export interface ParsedFindings {
  findings: Finding[]
  /** True when at least one finding was read, or the reviewer clearly said there is nothing. */
  ok: boolean
  raw: string
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 }

export const severityRank = (severity: Severity): number => RANK[severity]

/** Most severe first, then by file and line. */
export function sortFindings<T extends { severity: Severity; file?: string; path?: string; line: number }>(items: readonly T[]): T[] {
  return items.slice().sort((a, b) => {
    const bySeverity = RANK[a.severity] - RANK[b.severity]
    if (bySeverity !== 0) return bySeverity
    const left = a.file ?? a.path ?? ''
    const right = b.file ?? b.path ?? ''
    return left === right ? a.line - b.line : left < right ? -1 : 1
  })
}

const SEVERITY_WORDS: Record<string, Severity> = {
  critical: 'high', blocker: 'high', blocking: 'high', high: 'high', major: 'high', error: 'high', severe: 'high',
  medium: 'medium', moderate: 'medium', med: 'medium', warning: 'medium', warn: 'medium',
  low: 'low', minor: 'low', nit: 'low', nitpick: 'low', style: 'low',
  info: 'info', note: 'info', suggestion: 'info', information: 'info'
}

export function normalizeSeverity(value: unknown): Severity {
  const word = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return SEVERITY_WORDS[word] ?? 'medium'
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '')

function lineOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  const match = /\d+/.exec(str(value))
  return match ? Number(match[0]) : 0
}

function toFinding(value: unknown): Finding | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const title = str(raw.title ?? raw.summary ?? raw.issue)
  const explanation = str(raw.explanation ?? raw.description ?? raw.details ?? raw.body)
  if (title === '' && explanation === '') return null
  if (/^path\/relative\/to/i.test(str(raw.file ?? raw.path)) || title === 'short title') return null
  return {
    file: str(raw.file ?? raw.path).replace(/\\/g, '/').replace(/^\.\//, ''),
    line: lineOf(raw.line ?? raw.start_line ?? raw.lines),
    severity: normalizeSeverity(raw.severity),
    title: title || explanation.slice(0, 80),
    explanation,
    fix: str(raw.suggested_fix ?? raw.suggestedFix ?? raw.fix ?? raw.suggestion)
  }
}

/** Candidate JSON texts in a reply: fenced blocks first, then the whole reply. */
function candidates(text: string): string[] {
  const found: string[] = []
  const fence = /```[a-zA-Z]*\s*\n?([\s\S]*?)```/g
  for (let match = fence.exec(text); match; match = fence.exec(text)) found.push(match[1])
  const open = /```[a-zA-Z]*\s*\n?([\s\S]*)$/.exec(text)
  if (open && !found.includes(open[1])) found.push(open[1])
  found.push(text)
  return found
}

/** Every complete `{ ... }` object in a text at any depth, in the order they close; strings and escapes are respected, so a reply cut off in the middle still yields what came through. */
export function completeObjects(text: string): string[] {
  const out: string[] = []
  const starts: number[] = []
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') starts.push(index)
    else if (char === '}' && starts.length > 0) out.push(text.slice(starts.pop() as number, index + 1))
  }
  return out
}

function fromWhole(text: string): Finding[] | null {
  const trimmed = text.trim()
  if (!/^[[{]/.test(trimmed)) return null
  try {
    const value = JSON.parse(trimmed) as unknown
    const list = Array.isArray(value) ? value : typeof value === 'object' && value !== null && Array.isArray((value as Record<string, unknown>).findings) ? ((value as Record<string, unknown>).findings as unknown[]) : null
    if (!list) return null
    return list.flatMap((item) => toFinding(item) ?? [])
  } catch {
    return null
  }
}

function fromPieces(text: string): Finding[] {
  const found: Finding[] = []
  for (const piece of completeObjects(text)) {
    try {
      const value = JSON.parse(piece) as Record<string, unknown>
      const finding = toFinding(value)
      if (finding && (finding.file !== '' || typeof value.severity === 'string')) found.push(finding)
    } catch {
      // A broken piece is skipped; the rest still count.
    }
  }
  return found
}

const NOTHING = /\b(no (?:findings|issues|problems)|nothing (?:blocking|to report)|looks good|lgtm)\b/i

/** Findings out of a reviewer's reply: strict JSON, JSON in a code fence, or whatever complete objects came through before it was cut off. */
export function parseFindings(text: string): ParsedFindings {
  const raw = text
  for (const candidate of candidates(text)) {
    const whole = fromWhole(candidate)
    if (whole && (whole.length > 0 || /^\s*(\[\s*\]|\{\s*"findings"\s*:\s*\[\s*\]\s*\})\s*$/.test(candidate))) return { findings: sortFindings(whole), ok: true, raw }
  }
  const pieces = fromPieces(text)
  if (pieces.length > 0) return { findings: sortFindings(pieces), ok: true, raw }
  return { findings: [], ok: NOTHING.test(text) && !/[{[]\s*"/.test(text), raw }
}

export function countBySeverity(findings: readonly { severity: Severity }[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  return counts
}

/** "3 findings: 1 high, 2 low", or "No findings". */
export function summaryLabel(findings: readonly { severity: Severity }[]): string {
  if (findings.length === 0) return 'No findings'
  const counts = countBySeverity(findings)
  const parts = SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => `${counts[severity]} ${severity}`)
  return `${findings.length} finding${findings.length === 1 ? '' : 's'}: ${parts.join(', ')}`
}

/** The agent that reviews by default: the other one, so Codex reads Claude's work and Claude reads Codex's. */
export function defaultReviewer(author: AgentKind): AgentKind {
  return author === 'claude' ? 'codex' : 'claude'
}

export interface ReviewPromptInput {
  scope: ReviewScope
  diff: string
  truncated: boolean
  /** Shell command that prints the full diff, for a diff that did not fit. */
  command: string
}

export const REVIEW_DIFF_MAX = 14_000

const SCOPE_WORDS: Record<ReviewScope, string> = {
  reply: 'the last reply of a coding session',
  session: 'everything a coding session changed',
  uncommitted: 'the uncommitted changes in this folder'
}

/** The text a diff is cut to, at a line, with a flag when something was left out. */
export function clipDiff(diff: string, max = REVIEW_DIFF_MAX): { text: string; truncated: boolean } {
  if (diff.length <= max) return { text: diff, truncated: false }
  const cut = diff.lastIndexOf('\n', max)
  return { text: diff.slice(0, cut > 0 ? cut : max), truncated: true }
}

/** The fixed review prompt: read only, findings as strict JSON and nothing else. */
export function buildReviewPrompt(input: ReviewPromptInput): string {
  return [
    `Review ${SCOPE_WORDS[input.scope]}. You are read only: do not edit, create, delete or move any file, and do not commit.`,
    'Look for bugs, broken edge cases, security problems and missing tests. Check each finding against the code before you report it. No style nitpicks.',
    'Answer with strict JSON only, no other text, in exactly this shape:',
    '{"findings":[{"file":"path/relative/to/the/repo","line":12,"severity":"high|medium|low","title":"short title","explanation":"what is wrong and why","suggested_fix":"what to change"}]}',
    'Use {"findings":[]} when there is nothing to report. "line" is the line number in the file as it is now.',
    input.truncated ? `The diff below is cut short. Run \`${input.command}\` to read all of it.` : 'The diff:',
    '```diff',
    input.diff.replace(/```/g, '` ` `'),
    '```'
  ].join('\n')
}

/** The comment text a finding becomes on its line. */
export function findingText(finding: Pick<Finding, 'title' | 'explanation'>): string {
  const title = finding.title.trim()
  const more = finding.explanation.trim()
  if (more === '' || more === title) return title
  return title === '' ? more : `${title}. ${more}`
}
