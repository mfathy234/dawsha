import type { PermissionDetail } from './permissionPrompt'
import { SESSION_STATE_LABELS, type SessionState } from './sessionState'

const MAX_ASK = 80
const SECONDS_STEP = 10

const ASK_VERBS: Readonly<Record<string, string>> = {
  Bash: 'Run',
  Edit: 'Edit',
  Write: 'Write',
  Read: 'Read',
  WebFetch: 'Fetch'
}

const clip = (text: string): string => (text.length > MAX_ASK ? `${text.slice(0, MAX_ASK - 1)}…` : text)

/**
 * What a waiting session asks, in a few words: "Run npm run migrate?". It is built from the same
 * parsed prompt the approval card shows, and falls back to the card's own question text.
 */
export function needsAsk(detail: Pick<PermissionDetail, 'tool' | 'target'>, prompt: string): string {
  const verb = ASK_VERBS[detail.tool]
  const target = detail.target.replace(/\s+/g, ' ').trim()
  if (verb && target !== '') return clip(`${verb} ${target}?`)
  const text = prompt.replace(/\s+/g, ' ').trim()
  return text === '' ? '' : clip(text)
}

export interface SessionLineInput {
  state: SessionState
  /** What the session asks, for a waiting one. */
  ask: string
  /** The agent's own recap of where it is. */
  recap: string
  /** Its last tool line, as a phrase like "Running npm test". */
  tool: string
  /** "3 of 7" while a plan is active, else empty. */
  plan: string
  /** Files changed in the working tree, when known. */
  changed: number | null
  /** Background agents running. */
  agents: number
}

/** The second line of a session row: what it is doing, else the state word. */
export function sessionLine(input: SessionLineInput): string {
  const { state } = input
  if (state === 'needs') return input.ask || SESSION_STATE_LABELS.needs
  if (state === 'done') {
    const files = input.changed ?? 0
    return files > 0 ? `${SESSION_STATE_LABELS.done} · ${files} file${files === 1 ? '' : 's'} changed` : SESSION_STATE_LABELS.done
  }
  const word = state === 'working' && input.agents > 0 ? `${SESSION_STATE_LABELS.working} · ${input.agents} agent${input.agents === 1 ? '' : 's'}` : SESSION_STATE_LABELS[state]
  const doing = state === 'exited' ? word : input.recap || input.tool || word
  return input.plan !== '' && state !== 'exited' ? `${input.plan} · ${doing}` : doing
}

/**
 * How long a session has been in its state: seconds in steps of ten, then minutes, hours, days.
 * Empty for the first few seconds, so a row never says "now" and the label does not change every second.
 */
export function spanShort(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  if (seconds < 60) return seconds < SECONDS_STEP ? '' : `${Math.floor(seconds / SECONDS_STEP) * SECONDS_STEP}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** The time on a row's right: how long it has worked or waited, or how long since it finished. Nothing for idle or exited. */
export function sessionTime(state: SessionState, since: number, now: number): string {
  return state === 'working' || state === 'needs' || state === 'done' ? spanShort(now - since) : ''
}

const TOOL_VERBS: Readonly<Record<string, string>> = {
  Bash: 'Running',
  Read: 'Reading',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Update: 'Editing',
  Write: 'Writing',
  Grep: 'Searching',
  Glob: 'Searching',
  WebFetch: 'Fetching',
  WebSearch: 'Searching the web',
  Task: 'Running a sub-agent'
}

const TOOL_LINE = /^[\s*]*[●⏺]\s+([A-Za-z][\w.-]*)\((.*?)\)?\s*$/
const MAX_TOOL = 72

/** The last tool call printed on the screen as a phrase: "● Bash(npm test)" becomes "Running npm test". */
export function toolLineFromScreen(screen: string): string {
  const lines = screen.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = TOOL_LINE.exec(lines[index])
    if (!match) continue
    const verb = TOOL_VERBS[match[1]] ?? `Running ${match[1]}`
    const target = match[2].replace(/\s+/g, ' ').trim()
    const text = TOOL_VERBS[match[1]] && target !== '' ? `${verb} ${target}` : verb
    return text.length > MAX_TOOL ? `${text.slice(0, MAX_TOOL - 1)}…` : text
  }
  return ''
}

/** "2 closed today" when every closed session closed today, else "2 closed". */
export function closedSummary(closedAts: readonly number[], now: number): string {
  if (closedAts.length === 0) return ''
  const day = new Date(now).toDateString()
  const today = closedAts.every((at) => new Date(at).toDateString() === day)
  return `${closedAts.length} closed${today ? ' today' : ''}`
}
