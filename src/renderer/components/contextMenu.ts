import { placeAtPoint } from '../../shared/menuPlacement'
import { h, icon, leave } from '../dom'
import { ICONS } from '../icons'
import './contextMenu.css'

export interface ContextItem {
  label: string
  run: () => void
  keys?: string
  disabled?: boolean
  /** Quiet second line: why an item is disabled, or what it is. */
  detail?: string
  /** The item that is already chosen: it shows a check and is announced as current. */
  current?: boolean
}

export interface ContextHeading {
  heading: string
}

export type ContextEntry = ContextItem | ContextHeading | 'separator'

export interface ContextMenuOptions {
  /** Where the pointer was (or where the keyboard-opened row is). */
  x: number
  y: number
  label: string
  entries: readonly ContextEntry[]
  /** Gets focus back when the menu closes without a choice. */
  returnFocus?: HTMLElement | (() => void) | null
}

const ITEMS = '[role="menuitem"]:not([disabled])'

let current: { el: HTMLElement; close: (focus: boolean) => void } | null = null

export const closeContextMenu = (focus = false): void => current?.close(focus)

export const contextMenuOpen = (): boolean => current !== null

/**
 * The one right-click menu: opens on the pointer, stays inside the window, moves with the arrow keys, picks with
 * Enter or Space, and closes on Esc (focus goes back), Tab, a click elsewhere, a resize or the window losing focus.
 */
export function openContextMenu(options: ContextMenuOptions): HTMLElement {
  current?.close(false)
  const items = options.entries.map((entry) => {
    if (entry === 'separator') return h('div', { class: 'ctx-sep', role: 'separator' })
    if ('heading' in entry) return h('div', { class: 'ctx-heading', role: 'presentation' }, entry.heading)
    return h('button', {
      class: 'menu-item ctx-item', type: 'button', role: 'menuitem', disabled: entry.disabled === true, 'aria-disabled': entry.disabled ? 'true' : undefined, 'aria-current': entry.current ? 'true' : undefined,
      onClick: () => {
        close(true)
        entry.run()
      }
    }, h('span', { class: 'ctx-main' }, h('span', { class: 'ctx-label' }, entry.label), entry.detail ? h('span', { class: 'ctx-detail' }, entry.detail) : null), entry.current ? h('span', { class: 'ctx-check', 'aria-label': 'Current' }, icon(ICONS.check)) : null, entry.keys ? h('span', { class: 'ctx-keys', 'aria-hidden': 'true' }, entry.keys) : null)
  })
  const el = h('div', { class: 'popover menu floating ctx-menu', role: 'menu', 'aria-label': options.label }, ...items)

  const outside = (event: Event): void => {
    if (!el.contains(event.target as Node)) close(false)
  }
  const dismiss = (): void => close(false)
  const dismissOnScroll = (event: Event): void => {
    if (!el.contains(event.target as Node)) close(false)
  }
  function close(focus: boolean): void {
    if (current?.el !== el) return
    current = null
    document.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('blur', dismiss)
    window.removeEventListener('resize', dismiss)
    document.removeEventListener('scroll', dismissOnScroll, true)
    leave(el)
    const back = options.returnFocus
    if (!focus || !back) return
    if (typeof back === 'function') back()
    else if (back.isConnected) back.focus()
  }

  el.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    const enabled = [...el.querySelectorAll<HTMLElement>(ITEMS)]
    const at = enabled.indexOf(document.activeElement as HTMLElement)
    const go = (next: HTMLElement | undefined): void => {
      event.preventDefault()
      event.stopPropagation()
      next?.focus()
    }
    switch (event.key) {
      case 'ArrowDown': return go(enabled[(at + 1) % enabled.length])
      case 'ArrowUp': return go(enabled[(at <= 0 ? enabled.length : at) - 1])
      case 'Home': return go(enabled[0])
      case 'End': return go(enabled[enabled.length - 1])
      case 'Escape':
      case 'Tab':
        event.preventDefault()
        event.stopPropagation()
        return close(true)
    }
  })
  el.addEventListener('contextmenu', (event) => event.preventDefault())

  document.body.appendChild(el)
  // Layout size, not the drawn box, which is still scaled down by the opening animation.
  const placed = placeAtPoint(options.x, options.y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight)
  el.style.left = `${placed.left}px`
  el.style.top = `${placed.top}px`
  el.style.right = 'auto'
  if (placed.maxHeight !== null) el.style.maxHeight = `${placed.maxHeight}px`
  current = { el, close }
  el.querySelector<HTMLElement>(ITEMS)?.focus()
  setTimeout(() => {
    if (current?.el !== el) return
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    document.addEventListener('scroll', dismissOnScroll, true)
  }, 0)
  return el
}
