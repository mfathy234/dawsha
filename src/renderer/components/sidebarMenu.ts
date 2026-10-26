import { h, placeNearAnchor, leave } from '../dom'

const ITEMS = '[role^="menuitem"]:not([disabled])'

/** The sidebar's one popup menu (project and session ⋯ buttons): arrow keys move between items, Esc and Tab close it. */
export class SidebarMenu {
  private el: HTMLElement | null = null
  private key: string | null = null

  constructor(private readonly anchorFor: (key: string) => HTMLElement | null) {}

  // The menu's own button is left out, so a second click on it closes the menu instead of reopening it.
  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.el && !this.el.contains(target) && !this.anchorFor(this.key ?? '')?.contains(target)) this.close()
  }

  isOpenFor(key: string): boolean {
    return this.el !== null && this.key === key
  }

  close(returnFocus = false): void {
    document.removeEventListener('pointerdown', this.outside, true)
    const key = this.key
    leave(this.el)
    this.el = null
    this.key = null
    if (returnFocus && key) this.anchorFor(key)?.focus()
  }

  open(key: string, children: (HTMLElement | null)[], label: string): void {
    const anchor = this.anchorFor(key)
    this.close()
    if (!anchor) return
    this.key = key
    const el = h('div', { class: 'popover menu floating', role: 'menu', 'aria-label': label }, ...children)
    el.addEventListener('keydown', (event) => this.onKey(event, el))
    this.el = el
    document.body.appendChild(el)
    // Kept inside the window, so the last project's menu opens upwards.
    placeNearAnchor(el, anchor, 2)
    el.querySelector<HTMLElement>(ITEMS)?.focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0)
  }

  private onKey(event: KeyboardEvent, el: HTMLElement): void {
    if (event.isComposing) return
    const items = Array.from(el.querySelectorAll<HTMLElement>(ITEMS))
    const at = items.indexOf(document.activeElement as HTMLElement)
    const go = (next: HTMLElement | undefined): void => {
      event.preventDefault()
      next?.focus()
    }
    switch (event.key) {
      case 'ArrowDown': return go(items[(at + 1) % items.length])
      case 'ArrowUp': return go(items[(at <= 0 ? items.length : at) - 1])
      case 'Home': return go(items[0])
      case 'End': return go(items[items.length - 1])
      case 'Escape':
        event.stopPropagation()
        return this.close(true)
      case 'Tab':
        event.preventDefault()
        return this.close(true)
    }
  }
}
