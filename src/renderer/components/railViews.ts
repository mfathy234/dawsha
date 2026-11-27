import { bind, formatShortcut } from '../../shared/shortcuts'
import { showView } from '../actions'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { notificationEntries } from '../notificationHistory'
import { unreadCount } from '../../shared/notifications'
import type { AppState } from '../state'
import { BELL_SVG, toggleNotifications } from './notificationBell'
import { countBadge } from './railCount'

export const RAIL_VIEWS_KEY = 'views'

interface RailView {
  view: AppState['view']
  label: string
  svg: string
  keys: string | null
}

export const RAIL_VIEWS: readonly RailView[] = [
  { view: 'grid', label: 'Sessions', svg: ICONS.terminal, keys: 'Ctrl+Shift+S' },
  { view: 'crew', label: 'Agents', svg: ICONS.navAgents, keys: 'Ctrl+Shift+L' },
  { view: 'files', label: 'Files', svg: ICONS.folder, keys: 'Ctrl+Shift+E' },
  { view: 'work', label: 'Work', svg: ICONS.navWork, keys: 'Ctrl+Shift+W' },
  { view: 'skills', label: 'Skills', svg: ICONS.navSkills, keys: null }
]

const current = (view: AppState['view']): RailView | undefined => RAIL_VIEWS.find((item) => item.view === view)

/** The rail's Views button: the grid icon, or the icon of the view you are in when it is not Sessions. */
export function railViewsButton(view: AppState['view'], onClick: () => void): HTMLButtonElement {
  const active = current(view)
  const away = active !== undefined && active.view !== 'grid'
  const label = away ? `Views, ${active.label}` : 'Views'
  return h(
    'button',
    { class: `rail-btn rail-views${away ? ' away' : ''}`, type: 'button', id: 'rail-views', 'aria-label': label, title: label, 'aria-haspopup': 'menu', 'data-menu-key': RAIL_VIEWS_KEY, onClick },
    icon(away ? active.svg : ICONS.navViews),
    countBadge(unreadCount(notificationEntries()))
  )
}

function viewItem(item: RailView, active: boolean, close: () => void): HTMLElement {
  const keys = item.keys ? formatShortcut(bind(item.keys)) : ''
  return h(
    'button',
    { class: 'menu-item menu-item-icon', type: 'button', role: 'menuitem', 'aria-current': active ? 'page' : undefined, onClick: () => { close(); showView(item.view) } },
    h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, icon(item.svg)),
    h('span', { class: 'menu-label' }, item.label),
    keys ? h('span', { class: 'menu-kbd' }, keys) : null
  )
}

/** The menu rows: the five views, then Notifications, which the hidden bell used to open. */
export function railViewsItems(view: AppState['view'], close: () => void): HTMLElement[] {
  const unread = unreadCount(notificationEntries())
  const bell = h(
    'button',
    { class: 'menu-item menu-item-icon', type: 'button', role: 'menuitem', onClick: () => { close(); toggleNotifications() } },
    h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, icon(BELL_SVG)),
    h('span', { class: 'menu-label' }, 'Notifications'),
    unread > 0 ? h('span', { class: 'menu-kbd' }, `${unread} new`) : null
  )
  return [...RAIL_VIEWS.map((item) => viewItem(item, item.view === view, close)), h('div', { class: 'pv-menu-sep', role: 'separator' }), bell]
}
