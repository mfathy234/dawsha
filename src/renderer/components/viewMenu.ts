import { setDimOtherPanes, toggleLayouts, zoomAll } from '../actions'
import { GRID_STYLE_LABELS } from '../../shared/gridStyle'
import { bind, formatShortcut } from '../../shared/shortcuts'
import { h, icon, placeNearAnchor } from '../dom'
import { ICONS } from '../icons'
import { setSessionsLayout } from '../sessionsLayout'
import { store, type AppState } from '../state'

const ZOOM_MOD = navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl'
const BOARD_KEY_HINT = formatShortcut(bind('Ctrl+Shift+B'))

/** The Sessions tools in the top bar: the Grid | Board switch and a View menu holding counts, Layouts, dimming and text size. */
export class ViewMenu {
  /** The whole group (separator, switch, View button); shown on the Sessions page only. */
  readonly el: HTMLElement
  readonly viewButton: HTMLButtonElement
  private readonly gridMode = h('button', { class: 'btn ghost', type: 'button', id: 'layout-grid', title: 'Show sessions as a grid', onClick: () => setSessionsLayout('grid') }, 'Grid')
  private readonly boardMode = h('button', { class: 'btn ghost', type: 'button', id: 'layout-board', title: `Show sessions as a board (${BOARD_KEY_HINT})`, onClick: () => setSessionsLayout('board') }, 'Board')
  private readonly counts = h('div', { class: 'view-menu-counts', id: 'view-menu-counts', role: 'presentation' })
  private readonly layoutsStyle = h('span', { class: 'view-menu-value' })
  private readonly layoutsItem = h('button', { class: 'menu-item view-menu-item', type: 'button', role: 'menuitem', id: 'layouts-button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onClick: () => this.openLayouts() }, 'Layouts…', this.layoutsStyle)
  private readonly dimState = h('span', { class: 'view-menu-value' })
  private readonly dimItem = h('button', { class: 'menu-item view-menu-item', type: 'button', role: 'menuitemcheckbox', id: 'dim-others', 'aria-checked': 'false', onClick: () => setDimOtherPanes(!store.state.settings.dimOtherPanes) }, 'Dim other sessions', this.dimState)
  private readonly zoomValue = h('span', { class: 'zoom-value', title: 'Terminal text size of the focused pane' }, '15px')
  private readonly zoomRow = h('div', { class: 'view-menu-row', role: 'group', 'aria-label': 'Font size' },
    h('span', { class: 'view-menu-label' }, 'Text size'),
    h('span', { class: 'zoom-control' },
      h('button', { class: 'btn ghost zoom-button', type: 'button', 'aria-label': 'Decrease font size', title: `Smaller text in every pane, from the focused pane's size (${ZOOM_MOD}+- changes the focused pane only)`, onClick: () => zoomAll(-1) }, icon(ICONS.minus)),
      this.zoomValue,
      h('button', { class: 'btn ghost zoom-button', type: 'button', 'aria-label': 'Increase font size', title: `Larger text in every pane, from the focused pane's size (${ZOOM_MOD}+= changes the focused pane only)`, onClick: () => zoomAll(1) }, icon(ICONS.plus))
    )
  )
  private readonly menu = h('div', { class: 'popover menu floating view-menu', role: 'menu', 'aria-label': 'View' }, this.counts, this.layoutsItem, this.dimItem, this.zoomRow)
  private open = false

  constructor() {
    this.viewButton = h('button', { class: 'btn ghost view-button', type: 'button', id: 'view-button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: () => this.toggle() },
      'View',
      h('span', { class: 'view-chevron', 'aria-hidden': 'true' }, icon(ICONS.chevronDown))
    )
    this.menu.addEventListener('keydown', (event) => this.onKey(event))
    this.el = h('div', { class: 'topbar-view', 'aria-label': 'Sessions view', hidden: true },
      h('span', { class: 'topbar-sep', role: 'separator', 'aria-orientation': 'vertical' }),
      h('div', { class: 'layout-switch', role: 'group', 'aria-label': 'Sessions layout' }, this.gridMode, this.boardMode),
      this.viewButton
    )
  }

  /** Where the Layouts popover hangs: the open menu item, else the View button the menu came from. */
  get layoutsAnchor(): HTMLElement {
    return this.menu.isConnected ? this.layoutsItem : this.viewButton
  }

  update(state: AppState, countsText: string): void {
    this.el.hidden = state.view !== 'grid'
    if (state.view !== 'grid' && this.open) this.close(false)
    this.gridMode.setAttribute('aria-pressed', String(state.settings.sessionsLayout === 'grid'))
    this.boardMode.setAttribute('aria-pressed', String(state.settings.sessionsLayout === 'board'))
    this.counts.textContent = countsText
    this.layoutsStyle.textContent = GRID_STYLE_LABELS[state.settings.gridStyle]
    this.layoutsItem.setAttribute('aria-expanded', String(state.layoutsOpen))
    this.viewButton.setAttribute('aria-pressed', String(state.layoutsOpen))
    const dim = state.settings.dimOtherPanes
    this.dimItem.setAttribute('aria-checked', String(dim))
    this.dimState.textContent = dim ? 'On' : 'Off'
    const focused = state.panes.find((pane) => pane.id === state.focusedId) ?? state.panes[0]
    this.zoomValue.textContent = focused ? `${focused.fontSize}px` : '15px'
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.open && !this.menu.contains(target) && !this.viewButton.contains(target)) this.close(false)
  }

  private toggle(): void {
    if (this.open) this.close(true)
    else this.show()
  }

  private show(): void {
    this.open = true
    this.viewButton.setAttribute('aria-expanded', 'true')
    document.body.appendChild(this.menu)
    placeNearAnchor(this.menu, this.viewButton, 6)
    this.layoutsItem.focus()
    setTimeout(() => {
      if (this.open) document.addEventListener('pointerdown', this.outside, true)
    }, 0)
  }

  private close(returnFocus: boolean): void {
    if (!this.open) return
    this.open = false
    document.removeEventListener('pointerdown', this.outside, true)
    // Removed outright, not faded out: the menu is reused, and leaving would strip its ids.
    this.menu.remove()
    this.viewButton.setAttribute('aria-expanded', 'false')
    if (returnFocus) this.viewButton.focus()
  }

  private openLayouts(): void {
    // With the menu closed the popover anchors to the View button.
    this.close(false)
    toggleLayouts()
  }

  private items(): HTMLElement[] {
    return [this.layoutsItem, this.dimItem, ...Array.from(this.zoomRow.querySelectorAll<HTMLElement>('button'))]
  }

  private onKey(event: KeyboardEvent): void {
    const items = this.items()
    const current = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(current + step + items.length) % items.length].focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1].focus()
    } else if (event.key === 'Tab') {
      this.viewButton.focus()
      this.close(false)
    }
  }
}
