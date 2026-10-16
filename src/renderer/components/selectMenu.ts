import { stepIndex } from '../../shared/board'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import './selectMenu.css'

interface MenuOption { label: string; disabled?: boolean }

/** Keyboard movement shared by the trigger and the open list; disabled items never get focus. */
export function selectMenuIndex(options: readonly MenuOption[], current: number, key: string): number {
  const enabled = options.map((o, i) => o.disabled ? -1 : i).filter((i) => i >= 0)
  if (!enabled.length) return -1
  if (key === 'Home') return enabled[0]
  if (key === 'End') return enabled[enabled.length - 1]
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    return enabled[stepIndex(enabled.indexOf(current), key === 'ArrowDown' ? 1 : -1, enabled.length)]
  }
  if (key.length === 1 && key.trim()) {
    for (let offset = 1; offset <= options.length; offset++) {
      const index = (current + offset + options.length) % options.length
      if (!options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(key.toLocaleLowerCase())) return index
    }
  }
  return current
}

const menus = new WeakMap<HTMLSelectElement, SelectMenu>()
let nextId = 0

/** Keep the native control as the value/event boundary for callers and automation. */
export function selectMenu(select: HTMLSelectElement): HTMLElement {
  const existing = menus.get(select)
  if (existing) return existing.el
  const menu = new SelectMenu(select)
  menus.set(select, menu)
  return menu.el
}

/** Native property assignments do not emit DOM mutations or change events. */
export function syncSelectMenu(select: HTMLSelectElement): void {
  menus.get(select)?.sync()
}

class SelectMenu {
  readonly el: HTMLElement
  private readonly text = h('span', { class: 'select-menu-text' })
  private readonly label = h('span', { class: 'sr-only' })
  private readonly trigger: HTMLButtonElement
  private menu: HTMLElement | null = null
  private items: HTMLButtonElement[] = []
  private active = -1
  private signature = ''
  private readonly removal = new MutationObserver(() => {
    if (!this.trigger.isConnected || !this.trigger.getClientRects().length) this.close(false)
  })

  constructor(private readonly select: HTMLSelectElement) {
    const triggerId = select.id ? `${select.id}-trigger` : `select-menu-trigger-${++nextId}`
    this.trigger = h('button', {
      class: 'select-menu-trigger', type: 'button', id: triggerId,
      'aria-haspopup': 'listbox', 'aria-expanded': 'false',
      onClick: () => this.menu ? this.close(true) : this.open()
    }, this.label, this.text, icon(ICONS.chevronDown))
    this.text.id = `${triggerId}-value`
    this.text.setAttribute('aria-hidden', 'true')
    this.trigger.setAttribute('aria-describedby', this.text.id)
    select.classList.add('select-menu-native')
    select.tabIndex = -1
    select.setAttribute('aria-hidden', 'true')
    this.el = h('span', { class: 'select-menu' }, select, this.trigger)
    this.trigger.addEventListener('keydown', (event) => this.onKey(event))
    select.addEventListener('change', () => this.sync())
    select.addEventListener('focus', () => this.trigger.focus())
    new MutationObserver(() => this.sync()).observe(select, { attributes: true, childList: true, subtree: true, characterData: true })
    this.sync()
    queueMicrotask(() => this.sync())
  }

  sync(): void {
    const signature = JSON.stringify([
      this.select.disabled, this.select.selectedIndex,
      [...this.select.options].map((option) => [option.value, option.label, option.disabled])
    ])
    this.text.textContent = this.select.selectedOptions[0]?.label ?? ''
    this.trigger.disabled = this.select.disabled
    const label = this.select.getAttribute('aria-label') ?? [...this.select.labels ?? []].map((el) => el.textContent?.trim()).join(' ')
    this.label.textContent = label || 'Options'
    if (this.menu && signature !== this.signature) this.close(false)
    this.signature = signature
  }

  private readonly outside = (event: Event): void => {
    if (!this.el.contains(event.target as Node) && !this.menu?.contains(event.target as Node)) this.close(false)
  }
  private readonly dismiss = (): void => this.close(false)

  private open(): void {
    if (this.select.disabled || this.menu) return
    const options = [...this.select.options]
    this.active = options.findIndex((o) => o.selected && !o.disabled)
    if (this.active < 0) this.active = selectMenuIndex(options, -1, 'Home')
    const listId = `${this.trigger.id}-list`
    this.menu = h('div', {
      class: 'popover menu floating select-menu-popover', id: listId, role: 'listbox',
      'aria-label': this.label.textContent ?? 'Options'
    })
    this.items = options.map((option, index) => h('button', {
      class: 'menu-item select-menu-option', type: 'button', role: 'option', tabindex: -1,
      'aria-selected': String(option.selected), disabled: option.disabled,
      onClick: () => this.choose(index), onPointermove: () => this.highlight(index)
    }, h('span', { class: 'select-menu-text' }, option.label),
    h('span', { class: 'select-menu-check', 'aria-hidden': 'true' }, option.selected ? icon(ICONS.check) : null)))
    this.menu.append(...this.items)
    this.menu.addEventListener('keydown', (event) => this.onKey(event))
    document.body.append(this.menu)
    const anchor = this.trigger.getBoundingClientRect()
    this.menu.style.minWidth = `${anchor.width}px`
    const belowRoom = window.innerHeight - anchor.bottom - 14
    const aboveRoom = anchor.top - 14
    const below = this.menu.scrollHeight <= belowRoom || belowRoom >= aboveRoom
    this.menu.style.maxHeight = `${Math.max(32, Math.min(300, below ? belowRoom : aboveRoom))}px`
    const box = this.menu.getBoundingClientRect()
    this.menu.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`
    this.menu.style.top = `${below ? anchor.bottom + 6 : Math.max(8, anchor.top - box.height - 6)}px`
    this.menu.style.transformOrigin = below ? 'top left' : 'bottom left'
    this.trigger.setAttribute('aria-controls', listId)
    this.trigger.setAttribute('aria-expanded', 'true')
    this.highlight(this.active)
    document.addEventListener('pointerdown', this.outside, true)
    window.addEventListener('resize', this.dismiss)
    document.addEventListener('scroll', this.onScroll, true)
    this.removal.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] })
  }

  private readonly onScroll = (event: Event): void => {
    if (!this.menu?.contains(event.target as Node)) this.close(false)
  }

  private highlight(index: number): void {
    if (index < 0 || this.items[index]?.disabled) return
    this.active = index
    this.items[index]?.focus({ preventScroll: true })
    this.items[index]?.scrollIntoView({ block: 'nearest' })
  }

  private choose(index: number): void {
    if (!this.select.options[index] || this.select.options[index].disabled) return
    const changed = this.select.selectedIndex !== index
    this.select.selectedIndex = index
    this.close(true)
    this.sync()
    if (changed) this.select.dispatchEvent(new Event('change', { bubbles: true }))
    // A change handler may rebuild the field synchronously.
    document.getElementById(this.trigger.id)?.focus()
  }

  private onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const key = event.key
    if (key === 'Escape' && this.menu) {
      event.preventDefault()
      event.stopPropagation()
      this.close(true)
    } else if (key === 'Tab' && this.menu) {
      this.close(true)
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      if (this.menu) this.choose(this.active)
      else this.open()
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key) || key.length === 1) {
      event.preventDefault()
      if (!this.menu) {
        this.open()
        if (key === 'ArrowDown' || key === 'ArrowUp') return
      }
      this.highlight(selectMenuIndex([...this.select.options], this.active, key))
    }
  }

  private close(refocus: boolean): void {
    this.removal.disconnect()
    document.removeEventListener('pointerdown', this.outside, true)
    window.removeEventListener('resize', this.dismiss)
    document.removeEventListener('scroll', this.onScroll, true)
    this.menu?.remove()
    this.menu = null
    this.items = []
    this.trigger.setAttribute('aria-expanded', 'false')
    this.trigger.removeAttribute('aria-controls')
    if (refocus) this.trigger.focus()
  }
}
