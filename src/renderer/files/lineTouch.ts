import { formatClock } from '../../shared/timeline'
import type { AgentFileTouch, LineSessionsResult } from '../../shared/codeNavExtras'

export interface TouchText {
  /** The tooltip and screen-reader text. Says how sure the match is. */
  title: string
  /** The gutter shows this mark softer when the match is a guess. */
  guess: boolean
}

const AGENT_NAME = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' } as const

/** What one line's marker says, in the words of the API's precision: a recorded edit to the file, or a match by time. */
export function touchText(touch: AgentFileTouch): TouchText {
  const who = AGENT_NAME[touch.agent]
  const at = touch.at > 0 ? formatClock(touch.at) : ''
  if (touch.precision === 'file') return { title: `${who} edited this file${at ? ` at ${at}` : ''}. The log does not say which lines.`, guess: false }
  return { title: `Around ${at || 'this time'}, ${who} was working in this file. Matched by time, so it may be another session.`, guess: true }
}

/** A line under the editor when the sessions cannot be shown line by line; empty when there is nothing to explain. */
export function touchNote(result: LineSessionsResult | null): string {
  if (!result) return ''
  if (!result.ok) return result.error
  if (result.precision === 'unknown') return result.note || 'No agent session is known for these changes.'
  return result.note
}

/** Lines that have a session, by line number. */
export function touchedLines(result: LineSessionsResult | null): ReadonlyMap<number, AgentFileTouch> {
  const lines = new Map<number, AgentFileTouch>()
  if (!result?.ok) return lines
  for (const entry of result.lines) if (entry.session) lines.set(entry.line, entry.session)
  return lines
}
