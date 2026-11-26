import type { IDisposable, Terminal } from '@xterm/xterm'
import { findFilePaths, type FileRef } from '../shared/filePaths'
import { blockMarkdown, lineTimeLabel, quoteText, type Block, type BlockLine } from '../shared/terminalBlocks'
import type { ContextEntry } from './components/contextMenu'
import { h } from './dom'
import type { TerminalBlocks } from './terminalBlocks'

const SETTLE_MS = 220
const EDGE_PX = 12
const MIN_CHARS = 2
const SELECTABLE = new Set(['tool', 'command', 'reply', 'question'])

export interface SelectionHost {
  blocks: TerminalBlocks
  readable(text: string): string
  agentName(): string
  copy(text: string, done: string): void
  copyImage(lines: BlockLine[]): void
  askSession(text: string, at: { x: number; y: number }): void
  openFile(ref: FileRef): void
  searchFiles(text: string): void
  sendFailure(block: Block, text: string, at: { x: number; y: number }): void
  focus(): void
}

/** What you can do with a selection or a block: the action bar, double-click, the menu and the time at a line's edge. */
export class TerminalSelection {
  private readonly bar = h('div', { class: 'term-selbar', role: 'toolbar', 'aria-label': 'Selection actions', hidden: true })
  private readonly time = h('div', { class: 'term-linetime', role: 'status', hidden: true })
  private readonly subscription: IDisposable
  private timer: number | null = null
  private pointerDown = false
  private readonly onUp = (): void => {
    if (!this.pointerDown) return
    this.pointerDown = false
    this.settle()
  }

  constructor(private readonly term: Terminal, private readonly parent: HTMLElement, private readonly host: SelectionHost) {
    parent.append(this.bar, this.time)
    this.bar.addEventListener('mousedown', (event) => event.preventDefault())
    parent.addEventListener('mousedown', (event) => {
      if (event.button === 0 && !this.bar.contains(event.target as Node)) this.pointerDown = true
    })
    window.addEventListener('mouseup', this.onUp)
    parent.addEventListener('dblclick', (event) => window.setTimeout(() => this.selectBlockAt(event), 0))
    parent.addEventListener('mousemove', (event) => this.showTime(event))
    parent.addEventListener('mouseleave', () => (this.time.hidden = true))
    parent.addEventListener('keydown', () => this.hideBar(), true)
    this.subscription = term.onSelectionChange(() => (term.hasSelection() ? this.settle() : this.hideBar()))
  }

  dispose(): void {
    this.subscription.dispose()
    window.removeEventListener('mouseup', this.onUp)
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.bar.remove()
    this.time.remove()
  }

  hideBar(): void {
    this.bar.hidden = true
  }

  /** The buffer row under a mouse event, or null outside the screen. */
  rowAt(event: MouseEvent): number | null {
    const screen = this.parent.querySelector<HTMLElement>('.xterm-screen')
    if (!screen || screen.clientHeight === 0) return null
    const rect = screen.getBoundingClientRect()
    if (event.clientY < rect.top || event.clientY > rect.bottom) return null
    return this.host.blocks.top + Math.min(this.term.rows - 1, Math.floor(((event.clientY - rect.top) / rect.height) * this.term.rows))
  }

  menuEntries(event: MouseEvent): ContextEntry[] {
    const row = this.rowAt(event)
    const block = row === null ? null : this.host.blocks.blockAt(row)
    const entries: ContextEntry[] = []
    const selected = this.term.hasSelection() ? this.host.readable(this.term.getSelection()) : ''
    const at = { x: event.clientX, y: event.clientY }
    if (selected !== '') {
      entries.push({ label: 'Copy', run: () => this.host.copy(selected, 'Copied') })
      entries.push({ label: 'Copy as Markdown', run: () => this.host.copy(this.markdown(selected), 'Copied as Markdown') })
      entries.push({ label: 'Copy as image', run: () => this.copyImage() })
      entries.push({ label: 'Ask another session…', run: () => this.host.askSession(quoteText(selected), at) })
    }
    if (block && SELECTABLE.has(block.kind)) {
      if (entries.length > 0) entries.push('separator')
      entries.push({ label: 'Select this block', run: () => this.selectBlock(block) })
      entries.push({ label: 'Copy block as Markdown', run: () => this.host.copy(blockMarkdown(block, this.host.blocks.outputOf(block) || this.host.blocks.textOf(block)), 'Copied as Markdown') })
      if (block.status === 'failed') entries.push({ label: `Send failure to ${this.host.agentName()}`, run: () => this.host.sendFailure(block, this.host.blocks.textOf(block), at) })
    }
    return entries
  }

  private markdown(selected: string): string {
    const position = this.term.getSelectionPosition()
    const block = position ? this.host.blocks.blockAt(position.start.y) : null
    if (block && position && position.end.y <= block.endRow) return blockMarkdown(block, selected)
    return `\`\`\`\n${selected.replace(/\s+$/, '')}\n\`\`\``
  }

  private selectBlockAt(event: MouseEvent): void {
    const row = this.rowAt(event)
    const block = row === null ? null : this.host.blocks.blockAt(row)
    if (!block || !SELECTABLE.has(block.kind) || block.endRow === block.startRow) return
    this.selectBlock(block)
  }

  private selectBlock(block: Block): void {
    this.term.selectLines(block.startRow, block.endRow)
  }

  copyImage(): void {
    const position = this.term.getSelectionPosition()
    if (!position) return
    this.host.copyImage(this.host.blocks.lines(position.start.y, position.end.y))
  }

  private settle(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = null
      if (!this.pointerDown) this.showBar()
    }, SETTLE_MS)
  }

  private showBar(): void {
    const selected = this.term.hasSelection() ? this.host.readable(this.term.getSelection()) : ''
    const position = this.term.getSelectionPosition()
    const screen = this.parent.querySelector<HTMLElement>('.xterm-screen')
    if (selected.trim().length < MIN_CHARS || !position || !screen) return this.hideBar()
    const top = this.host.blocks.top
    const cell = screen.clientHeight / this.term.rows
    const line = position.end.y - top
    if (line < 0 || line >= this.term.rows) return this.hideBar()
    const buttons = this.buttons(selected)
    this.bar.replaceChildren(...buttons)
    this.bar.hidden = false
    const offset = screen.getBoundingClientRect().top - this.parent.getBoundingClientRect().top
    const below = offset + (line + 1) * cell + 4
    const fits = below + this.bar.offsetHeight <= this.parent.clientHeight
    this.bar.style.top = `${fits ? below : Math.max(offset + (position.start.y - top) * cell - this.bar.offsetHeight - 4, 0)}px`
    const cellWidth = screen.clientWidth / this.term.cols
    const left = Math.min(Math.max(position.end.x * cellWidth, 8), Math.max(this.parent.clientWidth - this.bar.offsetWidth - 8, 8))
    this.bar.style.left = `${left}px`
  }

  private buttons(selected: string): HTMLElement[] {
    const make = (label: string, run: (rect: DOMRect) => void): HTMLElement =>
      h('button', { class: 'btn ghost small', type: 'button', onClick: (event: Event) => run((event.currentTarget as HTMLElement).getBoundingClientRect()) }, label)
    const file = findFilePaths(selected.trim()).find((match) => match.start === 0)
    const buttons = [
      make('Ask another session', (rect) => this.host.askSession(quoteText(selected), { x: rect.left, y: rect.bottom })),
      file ? make('Open file', () => this.host.openFile({ path: file.path, line: file.line, col: file.col })) : null,
      make('Search in Files', () => this.host.searchFiles(selected.trim().split('\n')[0])),
      make('Copy', () => {
        this.host.copy(selected, 'Copied')
        this.term.clearSelection()
      })
    ]
    return buttons.filter((button): button is HTMLElement => button !== null)
  }

  private showTime(event: MouseEvent): void {
    const screen = this.parent.querySelector<HTMLElement>('.xterm-screen')
    const row = this.rowAt(event)
    if (!screen || row === null || event.clientX - screen.getBoundingClientRect().left > EDGE_PX) {
      this.time.hidden = true
      return
    }
    const at = this.host.blocks.lineTime(row)
    if (at === null) {
      this.time.hidden = true
      return
    }
    const cell = screen.clientHeight / this.term.rows
    const parentTop = this.parent.getBoundingClientRect().top
    this.time.textContent = lineTimeLabel(at, Date.now())
    this.time.hidden = false
    this.time.style.top = `${screen.getBoundingClientRect().top - parentTop + (row - this.host.blocks.top) * cell}px`
  }
}
