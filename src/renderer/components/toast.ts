import { h, icon, iconButton } from '../dom'
import { ICONS } from '../icons'
import { consumeNotificationAction, recordNotification } from '../notificationHistory'
import { countLabel, pushToast, removeToast, splitToast, toastKey, type ToastEntry, type ToastKind } from '../../shared/toastStack'

const ERROR_DURATION_MS = 7000
const INFO_DURATION_MS = 4000
const ACTION_DURATION_MS = 8000
const RESUME_DURATION_MS = 3000
const ALERT_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5 M12 16.5h.01"/></svg>'

export interface ToastAction {
  label: string
  run: () => void
}

interface LiveToast {
  el: HTMLElement
  badge: HTMLElement
  restart: () => void
  stop: () => void
}

let region: HTMLElement | null = null
let stack: readonly ToastEntry[] = []
let nextId = 1
const live = new Map<number, LiveToast>()

function ensureRegion(): HTMLElement {
  if (region) return region
  region = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })
  document.body.appendChild(region)
  return region
}

function discard(id: number): void {
  const toast = live.get(id)
  if (!toast) return
  toast.stop()
  toast.el.remove()
  live.delete(id)
  stack = removeToast(stack, id)
}

function durationFor(kind: ToastKind, action: ToastAction | undefined): number {
  return action ? ACTION_DURATION_MS : kind === 'info' ? INFO_DURATION_MS : ERROR_DURATION_MS
}

/** Closes itself after `duration`, but not while the pointer or keyboard focus is on it. */
function autoDismiss(el: HTMLElement, duration: number, close: () => void): Pick<LiveToast, 'restart' | 'stop'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const start = (ms: number): void => {
    clearTimeout(timer)
    timer = setTimeout(close, ms)
  }
  const hold = (): void => clearTimeout(timer)
  const release = (): void => start(RESUME_DURATION_MS)
  el.addEventListener('pointerenter', hold)
  el.addEventListener('pointerleave', release)
  el.addEventListener('focusin', hold)
  el.addEventListener('focusout', release)
  start(duration)
  return { restart: () => (el.matches(':hover') || el.contains(document.activeElement) ? hold() : start(duration)), stop: hold }
}

function buildToast(id: number, message: string, kind: ToastKind, action: ToastAction | undefined, recorded: number): LiveToast {
  const { title, detail } = splitToast(message)
  const badge = h('span', { class: 'toast-count', 'aria-hidden': 'true', hidden: true })
  const el = h('div', { class: `toast ${kind}` },
    h('span', { class: 'toast-icon', 'aria-hidden': 'true' }, icon(kind === 'error' ? ALERT_SVG : ICONS.info)),
    h('span', { class: 'toast-text' }, h('span', { class: 'toast-title' }, title), detail ? h('span', { class: 'toast-detail' }, detail) : null),
    badge)
  const dismiss = (): void => discard(id)
  el.addEventListener('click', dismiss)
  if (action) {
    // The button runs first, then the click bubbles up and closes the toast.
    const run = (): void => {
      action.run()
      consumeNotificationAction(recorded)
    }
    el.append(h('button', { class: 'btn small toast-action', type: 'button', onClick: run }, action.label))
  }
  el.append(iconButton('Dismiss notification', ICONS.closeSmall, dismiss, 'small toast-x'))
  return { el, badge, ...autoDismiss(el, durationFor(kind, action), dismiss) }
}

export function toast(message: string, kind: ToastKind = 'error', action?: ToastAction): void {
  // Every toast is also kept in the notification history, so one that vanished can still be found.
  const recorded = recordNotification(message, kind, action)
  const id = nextId
  nextId += 1
  const pushed = pushToast(stack, { id, key: toastKey(kind, message, action?.label), kind })
  stack = pushed.list
  for (const gone of pushed.dropped) discard(gone)
  const host = ensureRegion()
  if (pushed.repeated !== null) {
    // The same message again: one toast with a count, kept on screen a little longer.
    const existing = live.get(pushed.repeated)
    const entry = stack.find((candidate) => candidate.id === pushed.repeated)
    if (!existing || !entry) return
    existing.badge.textContent = countLabel(entry.count)
    existing.badge.hidden = false
    host.appendChild(existing.el)
    existing.restart()
    return
  }
  const created = buildToast(id, message, kind, action, recorded)
  live.set(id, created)
  host.appendChild(created.el)
}
