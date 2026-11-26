import { h } from '../dom'
import { badgeText } from '../../shared/notifications'

export function countBadge(count: number): HTMLElement {
  return h('span', { class: 'rail-badge rail-views-count', 'aria-hidden': 'true', hidden: count === 0 }, count === 0 ? '' : badgeText(count))
}

/** The unread notification count sits on the Views button as a bare numeral, now that the bell is hidden in the rail. */
export function syncRailViewsCount(count: number): void {
  const badge = document.querySelector<HTMLElement>('#rail-views .rail-views-count')
  if (!badge) return
  badge.hidden = count === 0
  badge.textContent = count === 0 ? '' : badgeText(count)
}
