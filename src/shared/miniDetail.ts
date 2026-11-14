import type { TodoEntry } from './chatCards'
import type { ChatItem } from './chatLog'
import { spanShort } from './sessionLine'
import type { SessionState } from './sessionState'

export interface MiniLogRead {
  todos: readonly TodoEntry[]
  asked: string
  reply: string[]
}

export interface MiniChanges { files: number; added: number; removed: number }

export const DONE_MOMENT_MS = 30_000
export const MINI_SEND_MAX = 8000
const ASKED_MAX = 400
const REPLY_LINES = 3
const REPLY_LINE_MAX = 200

const FENCE = /^\s*(```|~~~)/
const LIST_MARK = /^\s*(?:[-*+]|\d+[.)])\s+/

/** One line of a reply as plain text: no markdown marks, links reduced to their label. */
function plainLine(line: string): string {
  return line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(LIST_MARK, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/[*_`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function replyLines(text: string): string[] {
  const lines: string[] = []
  let fenced = false
  for (const raw of text.split('\n')) {
    if (FENCE.test(raw)) { fenced = !fenced; continue }
    if (fenced) continue
    const line = plainLine(raw)
    if (line === '') continue
    lines.push(line.length > REPLY_LINE_MAX ? `${line.slice(0, REPLY_LINE_MAX - 1)}…` : line)
    if (lines.length >= REPLY_LINES) break
  }
  return lines
}

export function askedText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > ASKED_MAX ? `${flat.slice(0, ASKED_MAX - 1)}…` : flat
}

/** The last message the person sent and the first lines of the agent's last reply, from a session log. */
export function lastExchange(items: readonly ChatItem[]): { asked: string; reply: string[] } {
  let asked = ''
  let reply: string[] = []
  let haveAsked = false
  let haveReply = false
  for (let index = items.length - 1; index >= 0 && !(haveAsked && haveReply); index -= 1) {
    const item = items[index]
    if (item.kind !== 'message') continue
    if (item.role === 'user' && !haveAsked) {
      const text = askedText(item.text)
      if (text !== '') { asked = text; haveAsked = true }
    } else if (item.role === 'agent' && !haveReply) {
      const lines = replyLines(item.text)
      if (lines.length > 0) { reply = lines; haveReply = true }
    }
  }
  return { asked, reply }
}

export interface NowInput {
  state: SessionState
  ask: string
  tool: string
  step: string
  /** How long the session has been in this state, from spanShort. */
  elapsed: string
}

/** What the session is doing right now, in words: "Running npm test, 40s". */
export function nowLine(input: NowInput): string {
  const { state, elapsed } = input
  if (state === 'needs') return input.ask ? `Waiting for you: ${input.ask}` : 'Waiting for you'
  if (state === 'working') return `${input.tool || input.step || 'Thinking'}${elapsed ? `, ${elapsed}` : ''}`
  if (state === 'done') return elapsed ? `Done ${elapsed} ago` : 'Done just now'
  if (state === 'idle') return elapsed ? `Idle ${elapsed}` : 'Idle'
  return 'Exited'
}

export const elapsedSince = (since: number, now: number): string => spanShort(now - since)

export function usageLine(context: number | null, costUsd: number | null): string {
  const parts: string[] = []
  if (context !== null && Number.isFinite(context)) parts.push(`Context ${Math.round(context)}%`)
  if (costUsd !== null && Number.isFinite(costUsd) && costUsd > 0) parts.push(costUsd < 0.01 ? 'under $0.01' : `$${costUsd.toFixed(2)}`)
  return parts.join(', ')
}

export const filesLabel = (files: number): string => `${files} file${files === 1 ? '' : 's'}`

export function changesLabel(changes: MiniChanges): string {
  return `${filesLabel(changes.files)} +${changes.added} -${changes.removed}`
}

export interface DoneMemory {
  state: SessionState
  workedSince: number | null
  moment: { at: number; took: number } | null
}

/** Remembers when a run of work began and when it finished, so a card can say "Done in 3m" for a while. */
export function stepDoneMemory(previous: DoneMemory | undefined, state: SessionState, now: number): DoneMemory {
  if (!previous) return { state, workedSince: state === 'working' ? now : null, moment: null }
  if (state === 'working') {
    return { state, workedSince: previous.state === 'working' || previous.state === 'needs' ? previous.workedSince ?? now : now, moment: null }
  }
  if (state === 'done') {
    if (previous.state === 'done') return { ...previous, state }
    if (previous.state === 'working' && previous.workedSince !== null) {
      return { state, workedSince: null, moment: { at: now, took: now - previous.workedSince } }
    }
    return { state, workedSince: null, moment: null }
  }
  return { state, workedSince: state === 'needs' ? previous.workedSince : null, moment: null }
}

/** The finished-work moment while it is fresh, with how long the work took. */
export function activeMoment(memory: DoneMemory | undefined, now: number): { took: string } | null {
  if (!memory?.moment || memory.state !== 'done' || now - memory.moment.at >= DONE_MOMENT_MS) return null
  return { took: spanShort(memory.moment.took) }
}

export function doneLine(took: string, files: number): string {
  return `Done${took ? ` in ${took}` : ''}${files > 0 ? `, ${filesLabel(files)}` : ''}`
}
