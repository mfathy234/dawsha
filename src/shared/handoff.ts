import { agentLabel } from './agents'
import type { AgentKind } from './types'

export const HANDOFF_MAX_FILES = 30
export const HANDOFF_OUTPUT_LINES = 40
export const HANDOFF_LINE_MAX = 200
export const HANDOFF_TOTAL_MAX = 6000

export interface HandoffCheck {
  kind: 'build' | 'test'
  ok: boolean
  summary: string | null
}

export interface HandoffInput {
  from: AgentKind
  projectName: string
  title: string | null
  files: string[]
  plan: { title: string | null; done: number; total: number } | null
  check: HandoffCheck | null
  output: string
}

const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const CSI = /\u001b\[[0-9;?<=>]*[ -/]*[@-~]/g
const CHARSET = /\u001b[()][A-Za-z0-9]/g
const ESCAPE = /\u001b[@-Z\\-_]/g
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g

export function stripAnsi(text: string): string {
  return text
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(CHARSET, '')
    .replace(ESCAPE, '')
    .replace(/\r\n/g, '\n')
    .replace(CONTROL, '')
}

const clip = (line: string, limit: number = HANDOFF_LINE_MAX): string =>
  line.length > limit ? `${line.slice(0, limit - 3)}...` : line

export function tailLines(output: string, count: number = HANDOFF_OUTPUT_LINES): string[] {
  const lines = stripAnsi(output)
    .split('\n')
    .map((line) => clip(line.trimEnd()))
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  while (lines.length > 0 && lines[0].trim() === '') lines.shift()
  return lines.slice(-count)
}

const ERROR_LINE = /error|failed|failure|exception|traceback|timeout|timed out|fatal/i
const NO_ERROR = /\b(no|0|zero|without)\s+(errors?|failures?)\b|\b0 failed\b/i

export function lastErrorLine(lines: string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (line !== '' && ERROR_LINE.test(line) && !NO_ERROR.test(line)) return clip(line)
  }
  return null
}

export function parseNumstat(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.split('\n')) {
    const parts = raw.split('\t')
    if (parts.length < 3) continue
    const path = parts.slice(2).join('\t').trim()
    if (path) seen.add(path)
  }
  return [...seen]
}

function planText(plan: HandoffInput['plan']): { done: string; left: string } {
  if (!plan || plan.total <= 0) return { done: '', left: '' }
  const name = plan.title ? ` (${plan.title})` : ''
  const left = Math.max(0, plan.total - plan.done)
  return {
    done: `${plan.done} of ${plan.total} plan steps done${name}.`,
    left: left === 0 ? 'All plan steps are done.' : `${left} plan step${left === 1 ? '' : 's'}.`
  }
}

function checkText(check: HandoffCheck | null): string {
  if (!check) return ''
  const summary = check.summary ? `, ${check.summary}` : ''
  return `Last ${check.kind}: ${check.ok ? 'passed' : 'failed'}${summary}.`
}

function filesBlock(files: string[]): string[] {
  if (files.length === 0) return ['Files touched: none found']
  const shown = files.slice(0, HANDOFF_MAX_FILES)
  const rest = files.length - shown.length
  return [`Files touched (${files.length}):`, ...shown.map((file) => `- ${file}`), ...(rest > 0 ? [`- and ${rest} more`] : [])]
}

function lastError(input: HandoffInput, lines: string[]): string {
  if (input.check && !input.check.ok) {
    const summary = input.check.summary ? `: ${input.check.summary}` : ''
    return `${input.check.kind} failed${summary}`
  }
  return lastErrorLine(lines) ?? 'none seen'
}

export function buildHandoff(input: HandoffInput): string {
  const lines = tailLines(input.output)
  const plan = planText(input.plan)
  const done = [plan.done, checkText(input.check)].filter(Boolean).join(' ')
  const head = [
    `Continue this task. Handoff from ${agentLabel(input.from)} in ${input.projectName}.`,
    '',
    `Goal: ${input.title ? clip(input.title) : '(not captured, describe it here)'}`,
    ...filesBlock(input.files),
    `What's done: ${done || '(not captured, describe it here)'}`,
    `What's left: ${plan.left || '(not captured, describe it here)'}`,
    `Last error: ${lastError(input, lines)}`
  ].join('\n')
  if (lines.length === 0) return head
  const heading = `\n\nRecent terminal output (last ${HANDOFF_OUTPUT_LINES} lines at most):\n`
  const room = HANDOFF_TOTAL_MAX - head.length - heading.length
  const kept: string[] = []
  let used = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    used += lines[index].length + 1
    if (used > room) break
    kept.unshift(lines[index])
  }
  return kept.length === 0 ? head : `${head}${heading}${kept.join('\n')}`
}

export const HANDOFF_KEEP_FILES = 50
const HANDOFF_AGENTS: readonly string[] = ['claude', 'codex', 'gemini']
const SESSION_ID = /^[\w-]{1,128}$/

export interface HandoffTranscriptRequest {
  projectId: string
  agent: AgentKind
  sessionId: string
}

export type HandoffTranscriptResult =
  | { status: 'saved'; path: string }
  | { status: 'no-session' }
  | { status: 'error'; message: string }

/** Checks what crossed the IPC boundary; the renderer never names a folder or a file. */
export function parseHandoffRequest(value: unknown): HandoffTranscriptRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { projectId, agent, sessionId } = value as Record<string, unknown>
  if (typeof projectId !== 'string' || projectId === '' || projectId.length > 128) return null
  if (typeof agent !== 'string' || !HANDOFF_AGENTS.includes(agent)) return null
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null
  return { projectId, agent: agent as AgentKind, sessionId }
}

const two = (value: number): string => String(value).padStart(2, '0')

export function handoffFileName(project: string, agent: AgentKind, now: Date): string {
  const slug = project.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  const day = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  return `${slug || 'project'}-${agent}-${day}-${time}.md`
}

/** Names to delete so that only the newest `keep` handoff files stay. */
export function staleHandoffs(files: readonly { name: string; modifiedAt: number }[], keep: number = HANDOFF_KEEP_FILES): string[] {
  return files
    .filter((file) => file.name.endsWith('.md'))
    .sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name))
    .slice(keep)
    .map((file) => file.name)
}

export interface TranscriptHandoffInput {
  from: AgentKind
  projectName: string
  title: string | null
  files: string[]
  plan: HandoffInput['plan']
  check: HandoffCheck | null
  output: string
  transcriptPath: string
}

/** Short prompt that points the next agent at the saved transcript instead of pasting a summary. */
export function buildTranscriptHandoff(input: TranscriptHandoffInput): string {
  const lines = tailLines(input.output)
  return [
    `Continue this task. First read the transcript file at "${input.transcriptPath}". It is the full conversation of the previous ${agentLabel(input.from)} session in ${input.projectName}.`,
    '',
    `Goal: ${input.title ? clip(input.title) : '(not captured, see the transcript)'}`,
    ...filesBlock(input.files),
    `What's left: ${planText(input.plan).left || '(not captured, see the transcript)'}`,
    `Last error: ${lastError(input, lines)}`,
    '',
    'Once you have read it, summarise in a few lines where things stand, then continue from there.'
  ].join('\n')
}
