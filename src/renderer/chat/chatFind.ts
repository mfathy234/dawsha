import type { ChatItem } from '../../shared/chatLog'
import { keysToOpen, matchOffsets, wrapIndex } from '../../shared/chatFind'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { searchCountLabel } from '../../shared/terminalSearch'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import type { ChatThread } from './chatThread'
import './chatExtras.css'

export interface FindHost {
  thread: ChatThread
  items(): readonly ChatItem[]
  /** Called when the bar closes, so focus goes back to the box. */
  closed(): void
}

/** Every occurrence of the query in the text the thread shows right now, as ranges the page can highlight. */
export function textRanges(root: HTMLElement, query: string): Range[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const ranges: Range[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    for (const at of matchOffsets(text.data, query)) {
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + query.length)
      ranges.push(range)
    }
  }
  return ranges
}

const paint = (name: string, ranges: readonly Range[]): void => {
  if (typeof Highlight === 'undefined' || !CSS.highlights) return
  if (ranges.length === 0) CSS.highlights.delete(name)
  else CSS.highlights.set(name, new Highlight(...ranges))
}

/** Ctrl+F in a chat: the terminal's find bar, searching what the thread shows and opening folded rows that hold a match. */
export class ChatFind {
  private readonly input = h('input', { class: 'term-find-input', type: 'text', placeholder: CHAT_TEXT.findPlaceholder, 'aria-label': CHAT_TEXT.findLabel, spellcheck: 'false' })
  private readonly count = h('span', { class: 'term-find-count', 'aria-live': 'polite' })
  readonly el: HTMLElement
  private ranges: Range[] = []
  private current = -1
  private reveal = false
  private readonly opened = new Set<string>()

  constructor(private readonly host: FindHost) {
    this.el = h(
      'div',
      { class: 'term-find chat-find', role: 'search', hidden: true },
      this.input,
      this.count,
      this.button(CHAT_TEXT.findPrevious, ICONS.chevronUp, () => this.step(-1)),
      this.button(CHAT_TEXT.findNext, ICONS.chevronDown, () => this.step(1)),
      h('button', { class: 'term-find-btn', type: 'button', title: CHAT_TEXT.findClose, 'aria-label': CHAT_TEXT.findClose, onClick: () => this.close() }, icon(ICONS.close))
    )
    this.input.addEventListener('input', () => this.search())
    this.input.addEventListener('keydown', (event) => this.onKey(event))
  }

  /** True while there is something typed to look for: the thread should not scroll away from the match. */
  get searching(): boolean {
    return !this.el.hidden && this.input.value.trim() !== ''
  }

  open(): void {
    this.el.hidden = false
    this.input.focus()
    this.input.select()
    if (this.input.value !== '') this.search()
  }

  close(): void {
    if (this.el.hidden) return
    this.el.hidden = true
    this.host.thread.closeKeys([...this.opened])
    this.opened.clear()
    this.ranges = []
    this.current = -1
    this.show()
    this.host.closed()
  }

  /** Called after every draw of the thread: its text nodes are new, so the matches are found again. */
  sync(): void {
    const query = this.searching ? this.input.value.trim() : ''
    this.ranges = query === '' ? [] : textRanges(this.host.thread.el, query)
    this.current = this.ranges.length === 0 ? -1 : Math.min(Math.max(this.current, 0), this.ranges.length - 1)
    this.show()
    if (this.reveal && this.current >= 0) this.scrollToCurrent()
  }

  private search(): void {
    this.current = 0
    this.reveal = true
    this.openHidden()
    this.sync()
  }

  private step(direction: 1 | -1): void {
    this.openHidden()
    this.sync()
    this.current = wrapIndex(this.current, direction, this.ranges.length)
    this.reveal = true
    this.sync()
  }

  /** Opens the groups, rows and long messages that hold a match; they are closed again when the bar closes. */
  private openHidden(): void {
    const query = this.input.value.trim()
    if (query === '') return
    const added = this.host.thread.openKeys(keysToOpen(this.host.items(), query, this.host.thread.membership))
    added.forEach((key) => this.opened.add(key))
  }

  private show(): void {
    const query = this.input.value.trim()
    this.count.textContent = searchCountLabel(query, this.current, this.ranges.length)
    const others = this.ranges.filter((_range, index) => index !== this.current)
    paint('chat-find', others)
    paint('chat-find-current', this.current >= 0 ? [this.ranges[this.current]] : [])
  }

  private scrollToCurrent(): void {
    this.reveal = false
    this.ranges[this.current]?.startContainer.parentElement?.scrollIntoView({ block: 'center' })
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
    } else if (event.key === 'Enter' || event.key === 'F3') {
      event.preventDefault()
      this.step(event.shiftKey ? -1 : 1)
    }
    event.stopPropagation()
  }

  private button(title: string, glyph: string, run: () => void): HTMLElement {
    return h('button', { class: 'term-find-btn', type: 'button', title, 'aria-label': title, onClick: () => { run(); this.input.focus() } }, icon(glyph))
  }
}
