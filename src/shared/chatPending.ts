import type { ChatItem } from './chatLog'

/** A message the user sent from chat that the session log does not show yet. */
export interface PendingMessage {
  id: string
  text: string
  at: number
  /** Not typed yet: the agent is still starting. */
  waiting: boolean
  /** Typed while the agent was busy, so it waits in the agent's own queue. */
  queued: boolean
  /** Ids of the user messages the log had when this was sent, so only a newer one can settle it. */
  seen: string[]
}

export type PendingLabel = 'waiting' | 'queued' | 'sending'

/** A message that never reaches the log as a plain user turn (a slash command, a shell line) is not tracked. */
export const isTracked = (text: string): boolean => !/^\s*[/!]/.test(text)

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()
const SENDING_GIVE_UP_MS = 15_000

export const userIds = (items: readonly ChatItem[]): string[] => items.flatMap((item) => (item.kind === 'message' && item.role === 'user' ? [item.id] : []))

export function newPending(id: string, text: string, now: number, items: readonly ChatItem[], waiting: boolean, queued: boolean): PendingMessage {
  return { id, text, at: now, waiting, queued, seen: userIds(items) }
}

export const pendingLabel = (message: PendingMessage): PendingLabel => (message.waiting ? 'waiting' : message.queued ? 'queued' : 'sending')

/**
 * Drops the messages the log now shows as user turns (each log turn settles one message, oldest first),
 * and the ones that have waited a long time with the agent idle, which are not coming.
 */
export function settlePending(pending: readonly PendingMessage[], items: readonly ChatItem[], now: number, working: boolean): PendingMessage[] {
  const taken = new Set<string>()
  return pending.filter((message) => {
    if (message.waiting) return true
    const known = new Set(message.seen)
    const wanted = normalize(message.text)
    const hit = items.find((item) => item.kind === 'message' && item.role === 'user' && !known.has(item.id) && !taken.has(item.id) && normalize(item.text) === wanted)
    if (hit) {
      taken.add(hit.id)
      return false
    }
    return working || now - message.at < SENDING_GIVE_UP_MS
  })
}
