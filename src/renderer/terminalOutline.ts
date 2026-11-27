import { filterOutline, outlineEntries, type Block, type OutlineEntry } from '../shared/terminalBlocks'
import { h } from './dom'
import type { TerminalBlocks } from './terminalBlocks'

export interface OutlineHost {
  blocks: TerminalBlocks
  agentName(): string
  copy(text: string, done: string): void
  sendFailure(block: Block, text: string, at: { x: number; y: number }): void
  backToLive(): void
}

const MARKS: Record<OutlineEntry['kind'], string> = { prompt: '›', tool: '·', command: '·', reply: '·', question: '?', error: '✗' }

const markOf = (entry: OutlineEntry): string => {
  if (entry.kind === 'tool' || entry.kind === 'command') return entry.status === 'failed' ? '✗' : entry.status === 'running' ? '…' : '✓'
  return MARKS[entry.kind]
}

/** Ctrl+Shift+O: the session's blocks in one short list. The terminal stays live behind it. */
export class TerminalOutline {
  readonly el = h('div', { class: 'term-outline', role: 'dialog', 'aria-label': 'Block outline', hidden: true })
  private readonly input = h('input', { class: 'ol-input', type: 'text', placeholder: 'Find a block…', 'aria-label': 'Find a block', spellcheck: 'false', autocomplete: 'off' })
  private readonly list = h('div', { class: 'ol-list', role: 'listbox' })
  private all: OutlineEntry[] = []
  private shown: OutlineEntry[] = []
  private index = 0

  constructor(private readonly host: OutlineHost, private readonly parent: HTMLElement) {
    this.el.append(this.input, this.list, h('div', { class: 'ol-hint' }, '↑↓ move   Enter jump   Ctrl+C copy output'))
    this.input.addEventListener('input', () => this.refilter())
    this.input.addEventListener('keydown', (event) => this.onKey(event))
    this.el.addEventListener('keydown', (event) => event.stopPropagation())
    this.el.addEventListener('mousedown', (event) => event.stopPropagation())
  }

  get isOpen(): boolean {
    return !this.el.hidden
  }

  toggle(): void {
    if (this.isOpen) this.close()
    else this.open()
  }

  open(): void {
    if (this.isOpen || !this.host.blocks.isNormalBuffer) return
    this.all = outlineEntries(this.host.blocks.list())
    this.input.value = ''
    if (this.el.parentElement !== this.parent) this.parent.append(this.el)
    this.el.hidden = false
    this.refilter(true)
    this.input.focus()
  }

  close(): void {
    if (!this.isOpen) return
    this.el.hidden = true
    this.list.replaceChildren()
    this.host.backToLive()
  }

  dispose(): void {
    this.el.remove()
  }

  private refilter(toEnd = false): void {
    this.shown = filterOutline(this.all, this.input.value)
    this.index = toEnd ? Math.max(this.shown.length - 1, 0) : Math.min(this.index, Math.max(this.shown.length - 1, 0))
    this.renderList()
  }

  private renderList(): void {
    if (this.shown.length === 0) {
      this.list.replaceChildren(h('p', { class: 'ol-empty' }, this.all.length === 0 ? 'No blocks yet.' : 'No block matches.'))
      return
    }
    this.list.replaceChildren(...this.shown.map((entry, i) => this.row(entry, i)))
    this.list.children[this.index]?.scrollIntoView({ block: 'nearest' })
  }

  private row(entry: OutlineEntry, i: number): HTMLElement {
    const send = entry.kind === 'error'
      ? h('button', { class: 'ol-send', type: 'button', tabindex: '-1', onClick: (event: Event) => this.send(entry, event as MouseEvent) }, `Send to ${this.host.agentName()}`)
      : null
    const row = h('div', { class: `ol-row ${entry.kind}${entry.status === 'failed' ? ' failed' : ''}`, role: 'option', 'aria-selected': String(i === this.index), 'data-row': entry.row },
      h('span', { class: 'ol-mark', 'aria-hidden': 'true' }, markOf(entry)),
      h('span', { class: 'ol-title' }, entry.title),
      entry.detail ? h('span', { class: 'ol-detail' }, entry.detail) : null,
      send)
    row.addEventListener('click', () => this.jump(entry))
    return row
  }

  private send(entry: OutlineEntry, event: MouseEvent): void {
    event.stopPropagation()
    this.host.sendFailure(entry.block, this.host.blocks.textOf(entry.block), { x: event.clientX, y: event.clientY })
    this.close()
  }

  private jump(entry: OutlineEntry): void {
    this.close()
    this.host.blocks.scrollToRow(Math.max(0, entry.row - 1))
    this.host.blocks.flash(entry.row, entry.kind === 'error' ? entry.row : entry.block.endRow)
  }

  private copy(entry: OutlineEntry): void {
    const text = entry.kind === 'prompt' ? entry.title : this.host.blocks.outputOf(entry.block) || this.host.blocks.textOf(entry.block)
    this.host.copy(text, 'Copied the output')
  }

  private move(step: number): void {
    if (this.shown.length === 0) return
    this.index = (this.index + step + this.shown.length) % this.shown.length
    this.renderList()
  }

  private onKey(event: KeyboardEvent): void {
    const entry = this.shown[this.index]
    if (event.key === 'Escape') this.stop(event, () => this.close())
    else if (event.key === 'ArrowDown') this.stop(event, () => this.move(1))
    else if (event.key === 'ArrowUp') this.stop(event, () => this.move(-1))
    else if (event.key === 'Enter' && entry) this.stop(event, () => this.jump(entry))
    else if (event.key.toLowerCase() === 'c' && (event.ctrlKey || event.metaKey) && !event.shiftKey && entry && this.input.selectionStart === this.input.selectionEnd) {
      this.stop(event, () => this.copy(entry))
    }
  }

  private stop(event: KeyboardEvent, run: () => void): void {
    event.preventDefault()
    event.stopPropagation()
    run()
  }
}
