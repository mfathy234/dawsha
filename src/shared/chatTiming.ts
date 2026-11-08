import type { ChatItem } from './chatLog'

export interface TurnTiming {
  /** The agent reply the line sits under: the last one of the turn. */
  replyId: string
  ms: number
  tools: number
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

/** "22s", "2m 14s", "1h 5m": the two largest units, no zero parts. */
export function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / SECOND))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const parts = hours > 0 ? [`${hours}h`, minutes > 0 ? `${minutes}m` : ''] : minutes > 0 ? [`${minutes}m`, seconds > 0 ? `${seconds}s` : ''] : [`${seconds}s`]
  return parts.filter((part) => part !== '').join(' ')
}

function timingOf(turn: readonly ChatItem[]): TurnTiming | null {
  const user = turn[0]
  if (user?.at === undefined) return null
  const reply = [...turn].reverse().find((item) => item.kind === 'message' && item.role === 'agent')
  if (!reply) return null
  const last = [...turn].reverse().find((item) => item.at !== undefined)?.at ?? user.at
  const ms = last - user.at
  if (ms < SECOND) return null
  return { replyId: reply.id, ms, tools: turn.filter((item) => item.kind === 'tool').length }
}

/** How long each answered turn took, from the user message to the last thing the agent did in it. Turns with an unknown or tiny time are left out. */
export function turnTimings(items: readonly ChatItem[]): TurnTiming[] {
  const turns: ChatItem[][] = []
  for (const item of items) {
    if (item.kind === 'message' && item.role === 'user') turns.push([item])
    else if (turns.length > 0) turns[turns.length - 1].push(item)
  }
  return turns.flatMap((turn) => timingOf(turn) ?? [])
}

export function workedLabel(timing: TurnTiming): string {
  const base = `Worked ${formatDuration(timing.ms)}`
  return timing.tools > 0 ? `${base} · ${timing.tools} tool${timing.tools === 1 ? '' : 's'}` : base
}
