import type { ChatItem } from './chatLog'

/** A message the user sent from chat that the session log does not show yet. */
export interface PendingMessage {
  id: string
  text: string
  at: number
  /** Not typed yet: the agent is still starting. */
  waiting: boolean
  /** Waiting to be sent after the agent becomes idle. */
  queued: boolean
  /** Held by Dawsha until the agent is idle. */
  held?: boolean
  /** A held message that waits for this time (a usage limit reset) before it is sent. */
  sendAt?: number
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

export const holdPending = (pending: readonly PendingMessage[], message: PendingMessage): PendingMessage[] => [...pending, { ...message, held: true, queued: true }]

export function removeHeld(pending: readonly PendingMessage[], id: string): PendingMessage[] {
  return pending.filter((message) => message.id !== id || !message.held)
}

export const holdUntil = (pending: readonly PendingMessage[], message: PendingMessage, sendAt: number): PendingMessage[] => [...pending, { ...message, held: true, queued: true, sendAt }]

export function releaseHeld(pending: readonly PendingMessage[], working: boolean, approval: boolean, menu: boolean, now: number = Date.now()): { pending: PendingMessage[]; message: PendingMessage | null } {
  if (working || approval || menu || pending.some((message) => !message.held && !message.waiting)) return { pending: [...pending], message: null }
  const message = pending.find((entry) => entry.held && (entry.sendAt === undefined || entry.sendAt <= now))
  if (!message) return { pending: [...pending], message: null }
  const released = { ...message, held: false, queued: false, waiting: false }
  return { pending: pending.map((entry) => entry.id === message.id ? released : entry), message: released }
}

/**
 * Drops the messages the log now shows as user turns (each log turn settles one message, oldest first),
 * and the ones that have waited a long time with the agent idle, which are not coming.
 */
export function settlePending(pending: readonly PendingMessage[], items: readonly ChatItem[], now: number, working: boolean): PendingMessage[] {
  const taken = new Set<string>()
  return pending.filter((message) => {
    if (message.waiting || message.held) return true
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
