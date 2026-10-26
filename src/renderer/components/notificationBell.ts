import { h, icon } from '../dom'
import {
  clearNotificationHistory,
  consumeNotificationAction,
  markNotificationsRead,
  notificationEntries,
  subscribeNotifications
} from '../notificationHistory'
import {
  actionAvailable,
  badgeText,
  bellLabel,
  unreadCount,
  type NotificationEntry,
  type NotificationKind
} from '../../shared/notifications'
import { formatAgo } from '../../shared/updates'
import { ICONS } from '../icons'
import { confirmDialog } from './dialogs'
import { popupDismissButton } from './popupDismiss'
import { stateIcon } from './stateIcon'
import './notifications.css'

const POPOVER_WIDTH = 380
const TIME_REFRESH_MS = 30_000
const BELL_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>'
const ALERT_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4 M12 17h.01"/></svg>'
const KIND_LABELS: Record<NotificationKind, string> = { info: 'Info', error: 'Error', needs: 'Needs you' }

let active: NotificationBell | null = null

/** Opens or closes the notification popover from outside the top bar, such as the command palette. */
export function toggleNotifications(): void {
  active?.toggle()
}

function kindIcon(kind: NotificationKind): HTMLElement {
  if (kind === 'needs') return stateIcon('needs')
  return icon(kind === 'error' ? ALERT_SVG : ICONS.info)
}

export class NotificationBell {
  readonly el: HTMLButtonElement
  private readonly badge = h('span', { class: 'bell-badge', 'aria-hidden': 'true', hidden: true })
  private popover: HTMLElement | null = null
  private confirming = false
  private fresh = new Set<number>()
  private timer: ReturnType<typeof setInterval> | undefined

  constructor() {
    this.el = h(
      'button',
      { class: 'btn ghost topbar-tool bell-button', type: 'button', id: 'notifications-button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Notifications', onClick: () => this.toggle() },
      h('span', { class: 'tool-icon', 'aria-hidden': 'true' }, icon(BELL_SVG)),
      this.badge
    )
    active = this
    subscribeNotifications(() => this.sync())
    this.sync()
  }

  toggle(): void {
    if (this.popover) this.close(true)
    else this.open()
  }

  private sync(): void {
    if (this.popover) markNotificationsRead()
    const count = unreadCount(notificationEntries())
    this.badge.hidden = count === 0
    this.badge.textContent = badgeText(count)
    this.el.setAttribute('aria-label', bellLabel(count))
    if (this.popover) this.render()
  }

  private open(): void {
    this.fresh = new Set(notificationEntries().filter((entry) => !entry.read).map((entry) => entry.id))
    const rect = this.el.getBoundingClientRect()
    const right = Math.max(8, Math.round(window.innerWidth - rect.right))
    this.popover = h('div', {
      class: 'popover notifications-popover',
      role: 'dialog',
      'aria-labelledby': 'notifications-title',
      tabindex: '-1',
      style: `right:${right}px;top:${Math.round(rect.bottom + 6)}px;width:${POPOVER_WIDTH}px`
    })
    document.body.appendChild(this.popover)
    this.el.setAttribute('aria-expanded', 'true')
    document.addEventListener('pointerdown', this.outside, true)
    document.addEventListener('keydown', this.onKey, true)
    this.timer = setInterval(() => this.render(), TIME_REFRESH_MS)
    markNotificationsRead()
    this.render()
    this.popover.focus()
  }

  private close(returnFocus: boolean): void {
    if (!this.popover) return
    document.removeEventListener('pointerdown', this.outside, true)
    document.removeEventListener('keydown', this.onKey, true)
    clearInterval(this.timer)
    this.popover.remove()
    this.popover = null
    this.el.setAttribute('aria-expanded', 'false')
    if (returnFocus) this.el.focus()
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.popover && !this.confirming && !this.popover.contains(target) && !this.el.contains(target)) this.close(false)
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.confirming) return
    event.preventDefault()
    event.stopPropagation()
    this.close(true)
  }

  private render(): void {
    const root = this.popover
    if (!root) return
    const hadFocus = root.contains(document.activeElement)
    const entries = notificationEntries()
    root.replaceChildren(
      h(
        'div',
        { class: 'popup-head notifications-head' },
        h('h2', { class: 'popover-title', id: 'notifications-title' }, 'Notifications'),
        entries.length > 0 ? h('button', { class: 'btn ghost small', type: 'button', id: 'notifications-clear', onClick: () => void this.confirmClear() }, 'Clear') : null,
        popupDismissButton(() => this.close(true))
      ),
      entries.length > 0 ? this.list(entries) : this.empty()
    )
    if (hadFocus && !root.contains(document.activeElement)) root.focus()
  }

  private async confirmClear(): Promise<void> {
    const count = notificationEntries().length
    if (count === 0 || this.confirming) return
    const noun = `${count} notification${count === 1 ? '' : 's'}`
    this.confirming = true
    const confirmed = await confirmDialog({ title: 'Clear notifications?', body: `This removes ${noun} from the list.`, confirmLabel: `Clear ${noun}` })
    this.confirming = false
    if (!confirmed) {
      this.popover?.querySelector<HTMLElement>('#notifications-clear')?.focus()
      return
    }
    clearNotificationHistory()
  }

  private empty(): HTMLElement {
    return h(
      'div',
      { class: 'notifications-empty' },
      h('p', { class: 'notifications-empty-title' }, 'No notifications yet.'),
      h('p', { class: 'notifications-empty-note' }, 'Messages that pop up, and sessions that need you, are kept here.')
    )
  }

  private list(entries: readonly NotificationEntry[]): HTMLElement {
    const now = Date.now()
    return h('ul', { class: 'notifications-list', 'aria-label': 'Recent notifications' }, ...entries.map((entry) => this.row(entry, now)))
  }

  private row(entry: NotificationEntry, now: number): HTMLElement {
    const action = actionAvailable(entry) ? entry.action : undefined
    const run = (): void => {
      if (!action) return
      this.close(false)
      action.run()
      consumeNotificationAction(entry.id)
    }
    return h(
      'li',
      { class: `notification-item kind-${entry.kind}${this.fresh.has(entry.id) ? ' fresh' : ''}`, 'data-kind': entry.kind },
      h('span', { class: 'notification-icon' }, kindIcon(entry.kind)),
      h(
        'div',
        { class: 'notification-body' },
        h('span', { class: 'sr-only' }, `${KIND_LABELS[entry.kind]}: `),
        h('span', { class: 'notification-text', dir: 'auto' }, entry.message),
        h('time', { class: 'notification-time', datetime: new Date(entry.at).toISOString() }, formatAgo(entry.at, now))
      ),
      action ? h('button', { class: 'btn small notification-action', type: 'button', onClick: run }, action.label) : null
    )
  }
}
