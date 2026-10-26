import {
  addNotification,
  consumeAction,
  markAllRead,
  type NotificationAction,
  type NotificationEntry,
  type NotificationKind
} from '../shared/notifications'

let entries: readonly NotificationEntry[] = []
let nextId = 1
const listeners = new Set<() => void>()

function commit(next: readonly NotificationEntry[]): void {
  if (next === entries) return
  entries = next
  for (const listener of [...listeners]) listener()
}

export const notificationEntries = (): readonly NotificationEntry[] => entries

export function subscribeNotifications(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function recordNotification(message: string, kind: NotificationKind, action?: NotificationAction): number {
  const id = nextId
  nextId += 1
  commit(addNotification(entries, { id, message, kind, at: Date.now(), read: false, action }))
  return id
}

export const markNotificationsRead = (): void => commit(markAllRead(entries))

export const consumeNotificationAction = (id: number): void => commit(consumeAction(entries, id))

export const clearNotificationHistory = (): void => commit([])
