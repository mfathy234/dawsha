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
  private readonly collapse = h('button', { class: 'frame-collapse', type: 'button', id: 'sidebar-collapse', onClick: () => toggleSidebar() })
  private collapsed: boolean | null = null

  mount(parts: FrameParts): void {
    parts.newSession.classList.add('frame-new')
    this.top.replaceChildren(
      h('div', { class: 'frame-head' }, parts.brand, h('span', { class: 'frame-spacer' }), parts.bell, this.collapse),
      parts.newSession,
      parts.search,
      h('nav', { class: 'frame-nav', 'aria-label': 'Main views' }, ...parts.nav),
      parts.view
    )
    this.bottom.replaceChildren(parts.updatePill, parts.crew, h('div', { class: 'frame-foot' }, parts.settings, parts.limits))
    this.collapsed = null
  }

  unmount(parts: FrameParts): void {
    parts.newSession.classList.remove('frame-new')
    this.top.replaceChildren()
    this.bottom.replaceChildren()
    this.collapsed = null
  }

  update(collapsed: boolean): void {
    if (collapsed === this.collapsed) return
    this.collapsed = collapsed
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
    this.collapse.setAttribute('aria-label', label)
    this.collapse.title = label
    this.collapse.replaceChildren(icon(ICONS.panelLeft))
  }
}
