import type { ITheme, Terminal } from '@xterm/xterm'
import { blockCountLabel, failureLabel, type Block } from '../shared/terminalBlocks'
import { h, icon } from './dom'
import { ICONS } from './icons'
import { logicalRuns, type CellRun } from './terminalCells'
import type { TerminalBlocks } from './terminalBlocks'
import { TERMINAL_FONT } from './terminalFont'
import './components/terminalBlocks.css'

const MAX_BODY_LINES = 3000
const SCROLL_KEYS: Record<string, number> = { PageUp: -0.9, PageDown: 0.9, ArrowUp: -0.1, ArrowDown: 0.1 }

export interface ReadingHost {
  blocks: TerminalBlocks
  term: Terminal
  theme(): ITheme
  /** Rows written in visual order are shown as plain text, since their colours no longer line up. */
  plain(): boolean
  agentName(): string
  sendFailure(block: Block, text: string, at: { x: number; y: number }): void
  /** The reading view closed: put the cursor back in the terminal, and pass on a typed key. */
  backToLive(typed: string | null): void
}

const runStyle = (run: CellRun): string => {
  const parts: string[] = []
  if (run.fg) parts.push(`color:${run.fg}`)
  if (run.bg) parts.push(`background:${run.bg}`)
  if (run.bold) parts.push('font-weight:700')
  if (run.dim) parts.push('opacity:.7')
  if (run.italic) parts.push('font-style:italic')
  if (run.underline) parts.push('text-decoration:underline')
  return parts.join(';')
}

const typedKey = (event: KeyboardEvent): string | null => {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key === 'Enter') return '\r'
  if (event.key === 'Backspace') return '\x7f'
  return event.key.length === 1 ? event.key : null
}

/** A reading copy of the scrollback: one row per block, each opening on its own. The live terminal underneath never changes. */
export class TerminalReading {
  readonly el = h('div', { class: 'term-reading', role: 'region', 'aria-label': 'Reading view', tabindex: '-1', hidden: true })
  private readonly list = h('div', { class: 'rd-list' })
  private readonly bodies = new Map<HTMLElement, { block: Block; row: HTMLElement; filled: boolean }>()

  constructor(private readonly host: ReadingHost, private readonly parent: HTMLElement) {
    const back = h('button', { class: 'btn ghost small', type: 'button', id: 'reading-back', onClick: () => this.close(null) }, 'Back to live ↓')
    const foot = h('div', { class: 'rd-foot' },
      h('button', { class: 'btn ghost small', type: 'button', id: 'reading-fold', onClick: () => this.setAll(false) }, 'Fold all'),
      h('button', { class: 'btn ghost small', type: 'button', id: 'reading-unfold', onClick: () => this.setAll(true) }, 'Unfold all'),
      h('span', { class: 'rd-spacer' }),
      back)
    const head = h('div', { class: 'rd-head' }, h('span', { class: 'rd-title' }, 'Reading'), h('span', { class: 'rd-hint' }, 'Esc for live'))
    this.el.append(head, this.list, foot)
    parent.addEventListener('keydown', (event) => this.onKey(event), true)
  }

  get isOpen(): boolean {
    return !this.el.hidden
  }

  toggle(): void {
    if (this.isOpen) this.close(null)
    else this.open()
  }

  open(): void {
    if (this.isOpen || !this.host.blocks.isNormalBuffer) return
    const style = this.host.term.options
    this.el.style.fontFamily = TERMINAL_FONT
    this.el.style.fontSize = `${style.fontSize ?? 13}px`
    this.el.style.background = this.parent.style.background
    this.render()
    if (this.el.parentElement !== this.parent) this.parent.append(this.el)
    this.el.hidden = false
    this.parent.classList.add('reading')
    this.list.scrollTop = this.list.scrollHeight
    this.el.focus({ preventScroll: true })
  }

  close(typed: string | null): void {
    if (!this.isOpen) return
    this.el.hidden = true
    this.parent.classList.remove('reading')
    this.list.replaceChildren()
    this.bodies.clear()
    this.host.backToLive(typed)
  }

  dispose(): void {
    this.el.remove()
    this.bodies.clear()
  }

  setAll(open: boolean): void {
    for (const [body, entry] of this.bodies) this.setOpen(body, entry.row, open)
  }

  private render(): void {
    this.bodies.clear()
    const blocks = this.host.blocks.list()
    const rows = blocks.map((block) => this.renderBlock(block))
    this.list.replaceChildren(...(rows.length > 0 ? rows : [h('p', { class: 'rd-empty' }, 'Nothing to read yet.')]))
  }

  private renderBlock(block: Block): HTMLElement {
    if (block.kind === 'prompt') return h('div', { class: 'rd-prompt' }, h('span', { class: 'rd-prompt-mark', 'aria-hidden': 'true' }, '›'), h('span', {}, block.title))
    if (block.kind === 'reply' || block.kind === 'question') return this.renderText(block)
    return this.renderFold(block)
  }

  private renderText(block: Block): HTMLElement {
    const text = h('div', { class: 'rd-text' })
    this.fill(text, block, 0)
    return text
  }

  private renderFold(block: Block): HTMLElement {
    const body = h('div', { class: 'rd-body', hidden: true })
    const chevron = h('span', { class: 'rd-chevron' }, icon(ICONS.chevronRight))
    const meta = [blockCountLabel(block), this.host.blocks.durationLabel(block)].filter(Boolean).join(' · ')
    const outcome = block.status === 'failed' ? failureLabel(block) : block.status === 'running' ? 'running' : (block.detail ?? '')
    const row = h('button', { class: `rd-row ${block.status}`, type: 'button', 'aria-expanded': 'false', 'data-start': block.startRow },
      chevron, h('span', { class: 'rd-row-title' }, block.title), h('span', { class: 'rd-row-outcome' }, outcome), h('span', { class: 'rd-row-meta' }, meta))
    row.addEventListener('click', () => this.setOpen(body, row, body.hidden))
    this.bodies.set(body, { block, row, filled: false })
    const wrap = h('div', { class: 'rd-block', 'data-kind': block.kind }, row, this.failures(block), body)
    if (block.diff) this.setOpen(body, row, true)
    return wrap
  }

  private failures(block: Block): HTMLElement | null {
    if (block.status !== 'failed' || block.errors.length === 0) return null
    const lines = block.errors.slice(0, 3).map((error) => h('div', { class: 'rd-error-line' }, error.text))
    const send = h('button', { class: 'btn ghost small rd-send', type: 'button', onClick: (event: Event) => this.send(block, event as MouseEvent) }, `Send to ${this.host.agentName()}`)
    return h('div', { class: 'rd-errors' }, ...lines, send)
  }

  private send(block: Block, event: MouseEvent): void {
    this.host.sendFailure(block, this.host.blocks.textOf(block), { x: event.clientX, y: event.clientY })
  }

  private setOpen(body: HTMLElement, row: HTMLElement, open: boolean): void {
    const entry = this.bodies.get(body)
    if (!entry) return
    if (open && !entry.filled) {
      this.fill(body, entry.block, 1)
      entry.filled = true
    }
    body.hidden = !open
    row.setAttribute('aria-expanded', String(open))
    row.classList.toggle('open', open)
  }

  private fill(target: HTMLElement, block: Block, skip: number): void {
    const lines = this.host.blocks.lines(block.startRow, block.endRow).slice(skip)
    const theme = this.host.theme()
    const plain = this.host.plain()
    const fragment = document.createDocumentFragment()
    for (const line of lines.slice(0, MAX_BODY_LINES)) {
      const el = h('div', { class: 'rd-line' })
      if (plain) el.textContent = this.host.blocks.textOf({ ...block, startRow: line.row, endRow: line.row + line.rows - 1 }) || ' '
      else this.runs(el, logicalRuns(this.host.term, line.row, line.rows, theme))
      fragment.append(el)
    }
    if (lines.length > MAX_BODY_LINES) fragment.append(h('div', { class: 'rd-line rd-more' }, `${lines.length - MAX_BODY_LINES} more lines in the terminal`))
    target.append(fragment)
  }

  private runs(el: HTMLElement, runs: CellRun[]): void {
    if (runs.length === 0) el.textContent = ' '
    for (const run of runs) {
      const style = runStyle(run)
      if (style === '') el.append(document.createTextNode(run.text))
      else el.append(h('span', { style }, run.text))
    }
  }

  private onKey(event: KeyboardEvent): void {
    if (!this.isOpen || event.type !== 'keydown' || event.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close(null)
      return
    }
    const target = event.target as HTMLElement | null
    if (target?.closest('.rd-foot, .rd-send, .rd-row') && ['Enter', ' ', 'Tab'].includes(event.key)) return
    const step = SCROLL_KEYS[event.key]
    if (step !== undefined && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      this.list.scrollBy({ top: step * this.list.clientHeight })
      return
    }
    const typed = typedKey(event)
    if (typed === null) return
    event.preventDefault()
    event.stopPropagation()
    this.close(typed)
  }
}
