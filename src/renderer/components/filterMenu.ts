import { filterMenuOptions, stepIndex, type FilterMenuOption } from '../../shared/board'
import type { AgentKind } from '../../shared/types'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { agentMark } from './agentMark'

export interface FilterOption extends FilterMenuOption {
  /** Shown on the chip instead of the label, e.g. "This project". */
  chip?: string
  agent?: AgentKind
}

export interface FilterMenuConfig {
  /** The chip's name: "Project" gives "Project: All". */
  name: string
  /** What the chip says while nothing is chosen. */
  allChip?: string
  onChange(value: string): void
}

const SEARCH_AT = 7

/** A chip-style filter button that opens a listbox of options; the value '' means "all". */
export class FilterMenu {
  readonly el: HTMLButtonElement
  private options: FilterOption[] = []
  private current = ''
  private menu: HTMLElement | null = null
  private items: HTMLElement[] = []
  private visible: FilterOption[] = []
  private search: HTMLInputElement | null = null
  private readonly text = h('span', { class: 'filter-chip-text' })

  constructor(private readonly config: FilterMenuConfig) {
    this.el = h(
      'button',
      { class: 'filter-chip', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', onClick: () => this.toggle() },
      this.text,
      h('span', { class: 'filter-chip-chevron', 'aria-hidden': 'true' }, icon(ICONS.chevronDown))
    )
    this.renderChip()
  }

  get value(): string {
    return this.current
  }

  setOptions(options: FilterOption[]): void {
    this.options = options
    if (!options.some((option) => option.value === this.current)) this.current = ''
    this.renderChip()
  }

  setValue(value: string): void {
    this.current = this.options.some((option) => option.value === value) ? value : ''
    this.renderChip()
  }

  dispose(): void {
    this.close(false)
  }

  private selected(): FilterOption | undefined {
    return this.options.find((option) => option.value === this.current)
  }

  private renderChip(): void {
    const chosen = this.current === '' ? undefined : this.selected()
    const word = chosen ? (chosen.chip ?? chosen.label) : (this.config.allChip ?? 'All')
    const next = `${this.config.name}: ${word}`
    if (this.text.textContent !== next) this.text.textContent = next
    this.el.classList.toggle('active', chosen !== undefined)
    this.el.setAttribute('aria-label', `${this.config.name}: ${chosen?.label ?? word}`)
  }

  private readonly outside = (event: Event): void => {
    const target = event.target as Node
    if (this.menu && !this.menu.contains(target) && !this.el.contains(target)) this.close(false)
  }

  private toggle(): void {
    if (this.menu) this.close(true)
    else this.open()
  }

  private open(): void {
    const noun = this.config.name.toLowerCase()
    this.search =
      this.options.length >= SEARCH_AT
        ? h('input', { class: 'text-input filter-menu-search', type: 'text', placeholder: `Find a ${noun}`, 'aria-label': `Find a ${noun}`, autocomplete: 'off', spellcheck: 'false' })
        : null
    this.search?.addEventListener('input', () => this.renderItems(this.search?.value ?? ''))
    const list = h('div', { class: 'filter-menu-list', role: 'listbox', 'aria-label': this.config.name })
    this.menu = h('div', { class: 'popover menu floating filter-menu' }, this.search, list)
    this.menu.addEventListener('keydown', (event) => this.onKey(event))
    document.body.appendChild(this.menu)
    this.renderItems('')
    this.place()
    this.el.setAttribute('aria-expanded', 'true')
    if (this.search) this.search.focus()
    else this.items[Math.max(0, this.items.findIndex((item) => item.getAttribute('aria-selected') === 'true'))]?.focus()
    setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0)
  }

  private place(): void {
    if (!this.menu) return
    const anchor = this.el.getBoundingClientRect()
    const box = this.menu.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))
    const below = anchor.bottom + 6 + box.height <= window.innerHeight - 8
    this.menu.style.left = `${Math.round(left)}px`
    this.menu.style.top = `${Math.round(below ? anchor.bottom + 6 : Math.max(8, anchor.top - 6 - box.height))}px`
  }

  private renderItems(query: string): void {
    const list = this.menu?.querySelector('.filter-menu-list')
    if (!list) return
    this.visible = filterMenuOptions(this.options, query)
    this.items = this.visible.map((option) => this.item(option))
    if (this.items.length === 0) list.replaceChildren(h('div', { class: 'popover-empty', role: 'status' }, 'No match'))
    else list.replaceChildren(...this.items)
  }

  private item(option: FilterOption): HTMLElement {
    const selected = option.value === this.current
    return h(
      'button',
      {
        class: `menu-item filter-menu-item${selected ? ' selected' : ''}`,
        type: 'button',
        role: 'option',
        'aria-selected': String(selected),
        'data-value': option.value,
        onClick: () => this.choose(option)
      },
      option.agent ? agentMark(option.agent) : null,
      h('span', { class: 'filter-menu-label' }, option.label),
      h('span', { class: 'filter-menu-check', 'aria-hidden': 'true' }, selected ? icon(ICONS.check) : null)
    )
  }

  private choose(option: FilterOption): void {
    this.current = option.value
    this.renderChip()
    this.close(true)
    this.config.onChange(option.value)
  }

  private onKey(event: KeyboardEvent): void {
    const inSearch = document.activeElement === this.search
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close(true)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (inSearch && event.key === 'ArrowUp') return
      const from = inSearch ? -1 : this.items.indexOf(document.activeElement as HTMLElement)
      this.items[stepIndex(from, event.key === 'ArrowDown' ? 1 : -1, this.items.length)]?.focus()
    } else if ((event.key === 'Home' || event.key === 'End') && !inSearch) {
      event.preventDefault()
      this.items[event.key === 'Home' ? 0 : this.items.length - 1]?.focus()
    } else if (event.key === 'Enter' && inSearch) {
      event.preventDefault()
      const first = this.visible[0]
      if (first) this.choose(first)
    } else if (event.key === 'Tab') {
      this.close(true)
    } else if (!inSearch && this.search && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.search.focus()
    }
  }

  private close(refocus: boolean): void {
    document.removeEventListener('pointerdown', this.outside, true)
    this.menu?.remove()
    this.menu = null
    this.search = null
    this.items = []
    this.el.setAttribute('aria-expanded', 'false')
    if (refocus) this.el.focus()
  }
}
