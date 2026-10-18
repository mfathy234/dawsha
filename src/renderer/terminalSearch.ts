import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import { searchCountLabel } from '../shared/terminalSearch'
import { h, icon } from './dom'
import { ICONS } from './icons'

export const SEARCH_DECORATIONS = {
  matchBackground: '#4a3f1c',
  matchBorder: '#8a7432',
  matchOverviewRuler: '#d4a72c',
  activeMatchBackground: '#9a7b1f',
  activeMatchBorder: '#f2c94c',
  activeMatchColorOverviewRuler: '#f2c94c'
}

type Toggle = 'caseSensitive' | 'wholeWord' | 'regex'

export class TerminalSearch {
  private readonly addon = new SearchAddon()
  private readonly input = h('input', {
    class: 'term-find-input',
    type: 'text',
    placeholder: 'Find',
    'aria-label': 'Find in terminal',
    spellcheck: 'false'
  }) as HTMLInputElement
  private readonly count = h('span', { class: 'term-find-count', 'aria-live': 'polite' })
  private readonly bar: HTMLElement
  private readonly flags: Record<Toggle, boolean> = { caseSensitive: false, wholeWord: false, regex: false }
  private readonly buttons = new Map<Toggle, HTMLButtonElement>()

  /**
   * `order` converts between what the user types (reading order) and what the buffer holds, for programs that print
   * right-to-left text already in visual order.
   */
  constructor(
    private readonly term: Terminal,
    host: HTMLElement,
    private readonly order: { toBuffer(query: string): string; toReading(text: string): string } = { toBuffer: (q) => q, toReading: (t) => t }
  ) {
    term.loadAddon(this.addon)
    this.addon.onDidChangeResults(({ resultIndex, resultCount }) => {
      this.count.textContent = searchCountLabel(this.input.value, resultIndex, resultCount)
    })
    this.bar = h(
      'div',
      { class: 'term-find', role: 'search', hidden: true },
      this.input,
      this.count,
      this.toggle('caseSensitive', 'Aa', 'Match case'),
      this.toggle('wholeWord', 'W', 'Whole word'),
      this.toggle('regex', '.*', 'Regular expression'),
      this.button('Previous match (Shift+Enter)', '↑', () => this.step(-1)),
      this.button('Next match (Enter)', '↓', () => this.step(1)),
      h('button', { class: 'term-find-btn', type: 'button', 'aria-label': 'Close find (Esc)', title: 'Close (Esc)', onClick: () => this.close() }, icon(ICONS.close))
    )
    this.input.addEventListener('input', () => this.step(1, true))
    this.input.addEventListener('keydown', (event) => this.handleKey(event))
    host.append(this.bar)
  }

  get isOpen(): boolean {
    return !this.bar.hidden
  }

  open(): void {
    const selected = this.order.toReading(this.term.getSelection())
    if (selected && !selected.includes('\n')) this.input.value = selected
    this.bar.hidden = false
    this.input.focus()
    this.input.select()
    if (this.input.value) this.step(1, true)
  }

  close(): void {
    if (this.bar.hidden) return
    this.bar.hidden = true
    this.addon.clearDecorations()
    this.term.clearSelection()
    this.count.textContent = ''
    this.term.focus()
  }

  dispose(): void {
    this.bar.remove()
  }

  private options(incremental: boolean): ISearchOptions {
    return { ...this.flags, incremental, decorations: SEARCH_DECORATIONS }
  }

  private step(direction: 1 | -1, incremental = false): void {
    const query = this.flags.regex ? this.input.value : this.order.toBuffer(this.input.value)
    if (!query) {
      this.addon.clearDecorations()
      this.count.textContent = ''
      return
    }
    try {
      if (direction === 1) this.addon.findNext(query, this.options(incremental))
      else this.addon.findPrevious(query, this.options(false))
    } catch {
      this.count.textContent = 'Invalid pattern'
    }
  }

  private restart(): void {
    this.addon.clearDecorations()
    this.term.clearSelection()
    this.step(1)
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
    } else if (event.key === 'Enter' || event.key === 'F3') {
      event.preventDefault()
      this.step(event.shiftKey ? -1 : 1)
    }
    event.stopPropagation()
  }

  private toggle(flag: Toggle, label: string, title: string): HTMLButtonElement {
    const button = h(
      'button',
      {
        class: 'term-find-btn term-find-toggle',
        type: 'button',
        title,
        'aria-label': title,
        'aria-pressed': 'false',
        onClick: () => {
          this.flags[flag] = !this.flags[flag]
          button.setAttribute('aria-pressed', String(this.flags[flag]))
          this.restart()
          this.input.focus()
        }
      },
      label
    ) as HTMLButtonElement
    this.buttons.set(flag, button)
    return button
  }

  private button(title: string, label: string, run: () => void): HTMLButtonElement {
    return h(
      'button',
      { class: 'term-find-btn', type: 'button', title, 'aria-label': title, onClick: () => { run(); this.input.focus() } },
      label
    ) as HTMLButtonElement
  }
}
