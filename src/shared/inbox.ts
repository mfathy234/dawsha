import type { SessionState } from './sessionState'

/** One session as the inbox sees it. */
export interface InboxEntry {
  paneId: string
  state: SessionState
  unread: boolean
  /** When the session entered its state, in epoch ms. */
  since: number
}

export const INBOX_EMPTY = 'Nothing needs you.'
export const INBOX_CHOICES_MAX = 9

export const inboxWants = (entry: Pick<InboxEntry, 'state' | 'unread'>): boolean => entry.state === 'needs' || (entry.unread && entry.state !== 'exited')

/** Sessions that need you first, the longest wait first; then unread ones, the newest first. */
export function inboxOrder<T extends InboxEntry>(entries: readonly T[]): T[] {
  const wanted = entries.filter(inboxWants)
  const needs = wanted.filter((entry) => entry.state === 'needs').sort((a, b) => a.since - b.since)
  const unread = wanted.filter((entry) => entry.state !== 'needs').sort((a, b) => b.since - a.since)
  return [...needs, ...unread]
}

export function inboxSummary(entries: readonly InboxEntry[]): string {
  const needs = entries.filter((entry) => entry.state === 'needs').length
  const unread = entries.filter((entry) => entry.state !== 'needs' && inboxWants(entry)).length
  const parts = [needs > 0 ? `${needs} need${needs === 1 ? 's' : ''} you` : '', unread > 0 ? `${unread} unread` : ''].filter(Boolean)
  return parts.join(' · ')
}

/** The next selection after moving by delta; stays inside the list, and falls back to the first entry. */
export function moveSelection(ids: readonly string[], current: string | null, delta: number): string | null {
  if (ids.length === 0) return null
  const at = current === null ? -1 : ids.indexOf(current)
  if (at < 0) return ids[0]
  return ids[Math.max(0, Math.min(ids.length - 1, at + delta))]
}

/** After the selected entry leaves the list, the one now in its place, else the one before it. */
export function selectionAfterRemoval(before: readonly string[], after: readonly string[], removed: string): string | null {
  const at = before.indexOf(removed)
  const survivors = after.filter((id) => id !== removed)
  if (survivors.length === 0) return null
  const next = before.slice(at + 1).find((id) => survivors.includes(id))
  if (next) return next
  return before.slice(0, Math.max(0, at)).reverse().find((id) => survivors.includes(id)) ?? survivors[0]
}

/** 1 to 9 name a choice; a number past the list does nothing. */
export function choiceFromKey(key: string, count: number): number | null {
  if (!/^[1-9]$/.test(key)) return null
  const number = Number(key)
  return number <= Math.min(count, INBOX_CHOICES_MAX) ? number : null
}

export interface WaitFacts {
  state: SessionState
  since: number
  now: number
}

const waitText = (ms: number): string => {
  const total = Math.floor(Math.max(0, ms) / 60_000)
  if (total < 1) return ''
  if (total < 60) return `${total}m`
  const hours = Math.floor(total / 60)
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

/** "Needs you · 4m", "Done · 12m". */
export function stateWait(facts: WaitFacts): string {
  const word = facts.state === 'needs' ? 'Needs you' : facts.state === 'done' ? 'Done' : facts.state === 'working' ? 'Working' : 'Idle'
  const wait = waitText(facts.now - facts.since)
  return wait === '' ? word : `${word} · ${wait}`
}
