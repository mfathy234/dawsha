import { toggleSidebar } from '../actions'
import { toggleDockedPanel } from '../sessionsLayout'
import { formatShortcut, bind } from '../../shared/shortcuts'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import type { FrameParts } from './topbar'
import './sidebarFrame.css'

/**
 * The Sidebar frame: the top bar's New session, Search, tabs, Settings and limits live at the top and bottom of the sidebar.
 * The elements are the top bar's own, moved here, so their ids, menus and keyboard handling stay as they were.
 */
export class SidebarFrame {
  readonly top = h('div', { class: 'frame-top' })
  readonly bottom = h('div', { class: 'frame-bottom' })
  /** The slim row above the panes: the usage limits sit at its right end. */
  readonly bar = h('div', { class: 'frame-bar' })
  private readonly collapse = h('button', { class: 'frame-collapse', type: 'button', id: 'sidebar-collapse', onClick: () => toggleSidebar() })
  /** The collapsed rail's own expand button, shown above Add project at the foot of the rail. */
  readonly expand = h('button', { class: 'frame-expand', type: 'button', id: 'sidebar-expand', 'aria-label': 'Expand sidebar', title: 'Expand sidebar', onClick: () => toggleSidebar() }, icon(ICONS.chevronRight))
  private readonly panelToggle = h('button', { class: 'frame-panel-toggle', type: 'button', id: 'session-panel-toggle', hidden: true, 'aria-pressed': 'false', onClick: () => toggleDockedPanel() }, icon(ICONS.panelRight))
  private collapsed: boolean | null = null

  mount(parts: FrameParts): void {
    parts.newSession.classList.add('frame-new')
    this.top.replaceChildren(
      h('div', { class: 'frame-head' }, parts.brand, h('span', { class: 'frame-spacer' }), parts.bell, this.collapse),
      parts.newSession,
      parts.search,
      h('nav', { class: 'frame-nav', 'aria-label': 'Main views' }, ...parts.nav)
    )
    this.bottom.replaceChildren(parts.updatePill, parts.crew, h('div', { class: 'frame-foot' }, parts.settings))
    // One toolbar row above the panes: the layout switch and View on the left, the usage rings on the right.
    this.bar.replaceChildren(parts.view, h('span', { class: 'frame-bar-spacer' }), this.panelToggle, parts.limits)
    this.collapsed = null
  }

  unmount(parts: FrameParts): void {
    parts.newSession.classList.remove('frame-new')
    this.top.replaceChildren()
    this.bottom.replaceChildren()
    this.bar.replaceChildren()
    this.collapsed = null
  }

  update(collapsed: boolean): void {
    if (collapsed === this.collapsed) return
    this.collapsed = collapsed
    this.collapse.setAttribute('aria-label', 'Collapse sidebar')
    this.collapse.title = 'Collapse sidebar'
    this.collapse.replaceChildren(icon(ICONS.panelLeft))
  }

  /** The toolbar toggle for the Session panel: shown where a docked panel can sit, pressed while it is. */
  updatePanel(available: boolean, docked: boolean): void {
    this.panelToggle.hidden = !available
    const label = docked ? 'Hide the session panel' : 'Show the session panel'
    this.panelToggle.setAttribute('aria-pressed', String(docked))
    this.panelToggle.setAttribute('aria-label', 'Session panel')
    this.panelToggle.title = `${label} (${formatShortcut(bind('Ctrl+Alt+B'))})`
  }
}
