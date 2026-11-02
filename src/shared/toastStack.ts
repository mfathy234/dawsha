export type ToastKind = 'error' | 'info'

export interface ToastEntry {
  id: number
  /** Toasts with the same key are one toast with a count. */
  key: string
  kind: ToastKind
  count: number
}

export interface ToastPush {
  list: readonly ToastEntry[]
  /** The id that was bumped instead of adding a new toast, or null when a new one was added. */
  repeated: number | null
  /** Ids pushed out because the stack is full, oldest first. */
  dropped: readonly number[]
}

export const MAX_STACKED_TOASTS = 3

export const toastKey = (kind: ToastKind, message: string, actionLabel?: string): string => `${kind}|${message}|${actionLabel ?? ''}`

/** The first line is the title; whatever follows is the quiet detail. */
export function splitToast(message: string): { title: string; detail: string } {
  const cut = message.indexOf('\n')
  if (cut < 0) return { title: message, detail: '' }
  return { title: message.slice(0, cut).trim(), detail: message.slice(cut + 1).trim() }
}

export const countLabel = (count: number): string => (count > 1 ? `×${count}` : '')

/** Adds a toast, folds an identical one into the existing entry (moved to the newest place), and keeps at most `max`. */
export function pushToast(list: readonly ToastEntry[], entry: Omit<ToastEntry, 'count'>, max = MAX_STACKED_TOASTS): ToastPush {
  const same = list.find((candidate) => candidate.key === entry.key)
  if (same) {
    const bumped = { ...same, count: same.count + 1 }
    return { list: [...list.filter((candidate) => candidate !== same), bumped], repeated: same.id, dropped: [] }
  }
  const next = [...list, { ...entry, count: 1 }]
  const overflow = Math.max(0, next.length - max)
  return { list: next.slice(overflow), repeated: null, dropped: next.slice(0, overflow).map((dropped) => dropped.id) }
}

export const removeToast = (list: readonly ToastEntry[], id: number): ToastEntry[] => list.filter((entry) => entry.id !== id)
