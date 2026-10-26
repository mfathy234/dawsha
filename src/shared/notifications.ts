export type NotificationKind = 'info' | 'error' | 'needs'

export interface NotificationAction {
  label: string
  run: () => void
  /** False once the action no longer makes sense, for example its session is gone. */
  valid?: () => boolean
}

export interface NotificationEntry {
  id: number
  message: string
  kind: NotificationKind
  at: number
  read: boolean
  action?: NotificationAction
}

export const MAX_NOTIFICATIONS = 50

/** Newest first, capped. */
export function addNotification(list: readonly NotificationEntry[], entry: NotificationEntry): NotificationEntry[] {
  return [entry, ...list].slice(0, MAX_NOTIFICATIONS)
}

export const unreadCount = (list: readonly NotificationEntry[]): number => list.filter((entry) => !entry.read).length

/** Same array when everything is already read, so callers can skip a re-render. */
export function markAllRead(list: readonly NotificationEntry[]): readonly NotificationEntry[] {
  return unreadCount(list) === 0 ? list : list.map((entry) => (entry.read ? entry : { ...entry, read: true }))
}

/** An action runs once: Undo or Reopen twice would do the wrong thing. */
export function consumeAction(list: readonly NotificationEntry[], id: number): NotificationEntry[] {
  return list.map((entry) => {
    if (entry.id !== id || !entry.action) return entry
    const { action: _used, ...rest } = entry
    return rest
  })
}

export const actionAvailable = (entry: NotificationEntry): boolean => !!entry.action && (entry.action.valid?.() ?? true)

/** Ids that are needing the user now but were not at the last look. */
export function newlyNeeding(previous: ReadonlySet<string>, current: readonly string[]): string[] {
  return current.filter((id) => !previous.has(id))
}

export const needsMessage = (title: string, project: string | null): string =>
  project ? `${title} in ${project} needs you` : `${title} needs you`

export const badgeText = (count: number): string => (count > 9 ? '9+' : String(count))

export const bellLabel = (count: number): string => (count > 0 ? `Notifications, ${count} unread` : 'Notifications')
