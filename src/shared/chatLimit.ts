import type { ChatItem } from './chatLog'
import { formatDuration } from './usageLimits'

export interface LimitSituation {
  resetsAt: number | null
  /** The user's message the limit stopped, when the log shows no reply to it. */
  pendingText: string | null
}

/** The limit the thread ends with and the message it stopped, if there was one. */
export function limitSituation(items: readonly ChatItem[]): LimitSituation | null {
  const last = items[items.length - 1]
  if (last?.kind !== 'notice' || last.notice !== 'limit') return null
  const resetsAt = last.resetsAt ?? null
  for (let index = items.length - 2; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind !== 'message') continue
    const stopped = item.role === 'user' && item.text.trim() !== ''
    return { resetsAt, pendingText: stopped ? item.text : null }
  }
  return { resetsAt, pendingText: null }
}

/** 24-hour local clock time, e.g. "15:40". */
export function clockTime(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export const resetsLater = (resetsAt: number | null, now: number): resetsAt is number => resetsAt !== null && resetsAt > now

export const limitTitle = (agentName: string): string => `${agentName}'s usage limit is reached.`

export function resetLine(resetsAt: number | null, now: number, hadMessage: boolean): string {
  const tail = hadMessage ? ' Your message above was not sent.' : ''
  if (resetsAt === null) return `The reset time was not reported.${tail}`
  if (resetsAt <= now) return `The limit should have reset by now.${tail}`
  const minutes = Math.max(1, Math.round((resetsAt - now) / 60_000))
  return `It resets at ${clockTime(resetsAt)}, in ${formatDuration(minutes)}.${tail}`
}

export const sendAtLabel = (resetsAt: number): string => `Send at ${clockTime(resetsAt)}`
export const notifyAtLabel = (resetsAt: number): string => `Notify me at ${clockTime(resetsAt)}`
export const sendsAtNote = (at: number): string => `Sends at ${clockTime(at)}`
export const LIMIT_PANE_STATE = 'Limit reached'

export const resetNotice = (agentName: string): { title: string; body: string } => ({
  title: `${agentName} is ready again`,
  body: 'The usage limit has reset. You can carry on.'
})

/** The handoff text with the stopped message added, so the other agent picks it up. */
export const withStoppedMessage = (summary: string, message: string | null): string =>
  message === null ? summary : `${summary}\n\nMy last message was not sent because of a usage limit:\n${message}`
