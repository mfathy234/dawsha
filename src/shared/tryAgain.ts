import { agentLabel } from './agents'
import type { ChatItem } from './chatLog'
import type { TranscriptEntry } from './transcript'
import type { AgentKind } from './types'

const TRY_SUFFIX = /^(.*) · try (\d+)$/

/** The try number the next attempt gets: a title that is already "... · try 2" gives 3. */
export function nextTryNumber(title: string): number {
  const match = TRY_SUFFIX.exec(title)
  return match ? Number(match[2]) + 1 : 2
}

/** "Upload retries" gives "Upload retries · try 2"; a try of a try counts on. */
export function triedTitle(title: string): string {
  const match = TRY_SUFFIX.exec(title)
  return `${match ? match[1] : title} · try ${nextTryNumber(title)}`
}

const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** How many user messages after this one say exactly the same; it picks the right one in a saved transcript. */
export function laterSameCount(items: readonly ChatItem[], messageId: string): number {
  const at = items.findIndex((item) => item.kind === 'message' && item.role === 'user' && item.id === messageId)
  const item = items[at]
  if (at < 0 || item.kind !== 'message') return 0
  const text = norm(item.text)
  return items.slice(at + 1).filter((next) => next.kind === 'message' && next.role === 'user' && norm(next.text) === text).length
}

/** Everything said before the chosen user message, or null when that message is not in the transcript. */
export function cutTranscript(entries: readonly TranscriptEntry[], text: string, laterSame: number): TranscriptEntry[] | null {
  const wanted = norm(text)
  const hits = entries.flatMap((entry, index) => (entry.kind === 'user' && norm(entry.text) === wanted ? [index] : []))
  const at = hits[hits.length - 1 - Math.max(0, laterSame)]
  return at === undefined ? null : entries.slice(0, at)
}

export interface TryPromptInput {
  from: AgentKind
  projectName: string
  transcriptPath: string | null
  message: string
}

/** The first message of the new attempt: the saved conversation to read first, then the message itself. */
export function tryPrompt(input: TryPromptInput): string {
  if (!input.transcriptPath) return input.message
  return [
    `This is a new attempt. The earlier conversation of a ${agentLabel(input.from)} session in ${input.projectName} is saved at "${input.transcriptPath}". Read it first for context. The files are as they were just before the message below, so later work from that session is not here.`,
    '',
    input.message
  ].join('\n')
}
