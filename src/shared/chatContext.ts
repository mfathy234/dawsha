import { formatTokens } from './usage'
import type { TabAgent } from './types'

/** From this share of the window the meter turns warm and the note offers to compact. */
export const CONTEXT_NOTE_AT = 85
export const COMPACT_SLASH = '/compact'
export const CLEAR_SLASH = '/clear'

export interface ContextReading {
  percent: number
  tokens: number | null
  window: number | null
}

export interface ContextInput {
  agent: TabAgent
  percent: number | null
  tokens: number | null
  window: number | null
}

/** What the meter shows, or null when the agent reports no context (Gemini, or a session not yet counted). */
export function contextReading(input: ContextInput): ContextReading | null {
  if (input.agent !== 'claude' && input.agent !== 'codex') return null
  const derived = input.percent ?? (input.tokens !== null && input.window ? (input.tokens / input.window) * 100 : null)
  if (derived === null || !Number.isFinite(derived)) return null
  return { percent: Math.min(100, Math.max(0, Math.round(derived))), tokens: input.tokens, window: input.window }
}

export const contextWarn = (reading: ContextReading): boolean => reading.percent >= CONTEXT_NOTE_AT

/** The popover heading: counts when the log gave them, else the share. */
export function contextHeading(reading: ContextReading): string {
  if (reading.tokens !== null && reading.window !== null) return `Context · ${formatTokens(reading.tokens)} of ${formatTokens(reading.window)} tokens`
  return `Context · ${reading.percent}% full`
}

export const contextNoteText = (percent: number, agentName: string): { lead: string; rest: string } => ({
  lead: `Context is ${Math.round(percent)}% full.`,
  rest: `Compact now so ${agentName} doesn't do it in the middle of the next task.`
})

export interface NoteMemory {
  dismissed: boolean
}

/** One note per stretch above the line. Not now hides it until the context falls below the line again (a compact). */
export function stepContextNote(memory: NoteMemory, percent: number | null): { memory: NoteMemory; show: boolean } {
  if (percent === null) return { memory, show: false }
  if (percent < CONTEXT_NOTE_AT) return { memory: memory.dismissed ? { dismissed: false } : memory, show: false }
  return { memory, show: !memory.dismissed }
}

export const clearConfirm = (sessionName: string): { title: string; body: string; confirmLabel: string } => ({
  title: `Clear ${sessionName}?`,
  body: `This sends ${CLEAR_SLASH}, which empties the conversation in "${sessionName}". The agent forgets what was said so far.`,
  confirmLabel: `Clear ${sessionName}`
})
