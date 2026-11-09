import type { ChatItem, ChatPhase } from './chatLog'

const RUNNING: readonly ChatPhase[] = ['working', 'approval', 'menu']
const QUOTE_CHARS = 60

/** The user message a bell can sit on: the latest one, and only while the turn it started is still running. */
export function watchableMessageId(items: readonly ChatItem[], phase: ChatPhase): string | null {
  if (!RUNNING.includes(phase)) return null
  const user = [...items].reverse().find((item) => item.kind === 'message' && item.role === 'user')
  return user?.id ?? null
}

/** Which watched messages have finished: all of them, once the session stops running. */
export function settleWatches(watched: readonly string[], phase: ChatPhase): { keep: string[]; finished: string[] } {
  return RUNNING.includes(phase) ? { keep: [...watched], finished: [] } : { keep: [], finished: [...watched] }
}

/** The desktop notification for a finished turn. */
export function doneMessage(agentName: string, project: string, text: string): { title: string; body: string } {
  const flat = text.replace(/\s+/g, ' ').trim()
  const quote = flat.length > QUOTE_CHARS ? `${flat.slice(0, QUOTE_CHARS).trimEnd()}…` : flat
  return { title: `${agentName} is done`, body: `${project ? `${project}: ` : ''}"${quote}"` }
}
