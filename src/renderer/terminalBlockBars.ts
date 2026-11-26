import type { IDisposable, Terminal } from '@xterm/xterm'
import { blockAtRow, blockRowCount, longBlockPosition, promptAboveRow, type Block } from '../shared/terminalBlocks'
import { h } from './dom'
import type { TerminalBlocks } from './terminalBlocks'

const MIN_GUTTER_ROWS = 4
const TICK_BUCKETS = 250

type TickKind = 'prompt' | 'command' | 'error' | 'question'

interface Tick {
  row: number
  kind: TickKind
}

export function marksOf(blocks: readonly Block[]): Tick[] {
  const ticks: Tick[] = []
  for (const block of blocks) {
    if (block.kind === 'prompt') ticks.push({ row: block.startRow, kind: 'prompt' })
    else if (block.kind === 'question') ticks.push({ row: block.startRow, kind: 'question' })
    else if (block.kind === 'tool' || block.kind === 'command') ticks.push({ row: block.startRow, kind: 'command' })
    if (block.status === 'failed' && block.errors[0]) ticks.push({ row: block.errors[0].row, kind: 'error' })
  }
  return ticks
}

/** Keeps one tick per slot of the bar, preferring errors and questions over commands. */
export function thinTicks(ticks: readonly Tick[], length: number, buckets = TICK_BUCKETS): Tick[] {
  const rank: Record<TickKind, number> = { prompt: 1, command: 0, question: 3, error: 2 }
  const slots = new Map<string, Tick>()
  for (const tick of ticks) {
    const key = `${tick.kind === 'prompt' ? 'p' : 'o'}${Math.floor((tick.row / Math.max(length, 1)) * buckets)}`
    const held = slots.get(key)
    if (!held || rank[tick.kind] > rank[held.kind]) slots.set(key, tick)
  }
  return [...slots.values()]
}

/** What sits on top of the terminal while you read back: the prompt you answered, the long block you are inside, a gutter line and scrollbar ticks. */
export class TerminalBlockBars {
  private readonly promptLine = h('button', { class: 'term-sticky-line term-sticky-prompt', type: 'button', hidden: true })
  private readonly blockLine = h('div', { class: 'term-sticky-line term-sticky-block', hidden: true })
  private readonly sticky = h('div', { class: 'term-sticky' }, this.promptLine, this.blockLine)
  private readonly gutter = h('div', { class: 'term-gutter-line', 'aria-hidden': 'true', hidden: true })
  private readonly marks = h('div', { class: 'term-marks' })
  private readonly subscriptions: IDisposable[] = []
  private readonly unsubscribe: () => void
  private frame = 0
  private enabled = true
  private drawn: { list: readonly Block[]; length: number } | null = null

  constructor(
    private readonly term: Terminal,
    private readonly parent: HTMLElement,
    private readonly blocks: TerminalBlocks,
    private readonly hidden: () => boolean
  ) {
    parent.append(this.sticky, this.gutter, this.marks)
    this.subscriptions.push(term.onScroll(() => this.schedule()), term.onResize(() => this.schedule()))
    this.unsubscribe = blocks.subscribe(() => this.schedule())
  }

  schedule(): void {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.update())
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.schedule()
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.unsubscribe()
    for (const subscription of this.subscriptions) subscription.dispose()
    this.sticky.remove()
    this.gutter.remove()
    this.marks.remove()
  }

  private update(): void {
    if (!this.enabled || this.hidden() || !this.blocks.isNormalBuffer) return this.hideAll()
    const list = this.blocks.list()
    this.updateSticky(list)
    this.updateGutter(list)
    this.updateMarks(list)
  }

  private hideAll(): void {
    this.promptLine.hidden = true
    this.blockLine.hidden = true
    this.gutter.hidden = true
    this.marks.replaceChildren()
    this.drawn = null
  }

  private updateSticky(list: readonly Block[]): void {
    const top = this.blocks.top
    const back = !this.blocks.atBottom
    const prompt = back ? promptAboveRow(list, top) : null
    const showPrompt = prompt !== null && prompt.startRow < top
    this.promptLine.hidden = !showPrompt
    if (showPrompt) {
      this.promptLine.textContent = `› ${prompt.title}`
      this.promptLine.title = 'Show this message'
      this.promptLine.onclick = () => this.blocks.jumpTo(prompt)
    }
    const position = back ? longBlockPosition(list, top, this.term.rows) : null
    this.blockLine.hidden = position === null
    if (!position) return
    const { block, line } = position
    const start = h('button', { class: 'term-sticky-btn', type: 'button', onClick: () => this.blocks.scrollToRow(block.startRow) }, '↑ Start')
    const end = h('button', { class: 'term-sticky-btn', type: 'button', onClick: () => this.blocks.scrollToRow(block.endRow - this.term.rows + 2) }, 'Skip to end ↓')
    this.blockLine.replaceChildren(
      h('span', { class: 'term-sticky-title' }, block.title),
      h('span', { class: 'term-sticky-meta' }, `line ${line} of ${blockRowCount(block)}`),
      start,
      end
    )
  }

  private geometry(): { top: number; cell: number } | null {
    const screen = this.parent.querySelector<HTMLElement>('.xterm-screen')
    if (!screen || screen.clientHeight === 0) return null
    return { top: screen.getBoundingClientRect().top - this.parent.getBoundingClientRect().top, cell: screen.clientHeight / this.term.rows }
  }

  private updateGutter(list: readonly Block[]): void {
    const geometry = this.geometry()
    const top = this.blocks.top
    const block = blockAtRow(list, top + Math.floor(this.term.rows / 2))
    const visible = block !== null && block.kind !== 'prompt' && top <= block.endRow && blockRowCount(block) >= MIN_GUTTER_ROWS
    this.gutter.hidden = !visible || !geometry
    if (!visible || !geometry) return
    const from = Math.max(block.startRow - top, 0)
    const to = Math.min(block.endRow + 1 - top, this.term.rows)
    this.gutter.style.top = `${geometry.top + from * geometry.cell}px`
    this.gutter.style.height = `${Math.max(to - from, 0) * geometry.cell}px`
  }

  private updateMarks(list: readonly Block[]): void {
    const length = this.blocks.length
    if (this.drawn?.list === list && this.drawn.length === length) return
    this.drawn = { list, length }
    const ticks = thinTicks(marksOf(list), length)
    this.marks.replaceChildren(
      ...ticks.map((tick) => {
        const el = h('button', { class: `term-mark ${tick.kind}`, type: 'button', tabindex: '-1', 'aria-hidden': 'true', onClick: () => this.jumpToTick(tick.row) })
        el.style.top = `${(tick.row / Math.max(length, 1)) * 100}%`
        return el
      })
    )
  }

  private jumpToTick(row: number): void {
    this.blocks.scrollToRow(Math.max(0, row - 2))
    this.blocks.flash(row, row)
  }
}
