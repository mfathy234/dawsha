import { toggleSidebar } from '../actions'
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
    this.bar.replaceChildren(parts.view, h('span', { class: 'frame-bar-spacer' }), parts.limits)
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
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
    this.collapse.setAttribute('aria-label', label)
    this.collapse.title = label
    // On the rail the button says what it does: a chevron that opens the sidebar.
    this.collapse.replaceChildren(icon(collapsed ? ICONS.chevronRight : ICONS.panelLeft))
  }
}
