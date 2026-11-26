import type { IDisposable, IMarker, Terminal } from '@xterm/xterm'
import type { TabAgent } from '../shared/types'
import {
  blockAtRow,
  formatDuration,
  parseBlocks,
  type Block,
  type BlockLine,
  type ExternalCommand
} from '../shared/terminalBlocks'

const FLASH_MS = 700
const FLASH_COLOR = '#5b8def'
const EMIT_MS = 250
const STAMP_MS = 400
const MAX_STAMPS = 3000
const LIVE_ROWS = 14
const MIN_TIMED_MS = 1000

export interface BlocksHost {
  agent(): TabAgent | undefined
  busy(): boolean
  /** Text as the program meant it, for rows written in visual order. */
  readable(text: string): string
  visible(): boolean
}

interface Stamp {
  marker: IMarker
  at: number
}

const SEPARATOR_RE = /^\s*[╭┌]?[─━]{8,}/
const CODEX_INPUT_RE = /^\s*›\s/

/** The first row of the input box and spinner at the bottom, which Claude and Codex redraw all the time. */
export function liveStartRow(rows: readonly string[], firstRow: number): number | undefined {
  const tail = rows.slice(-LIVE_ROWS)
  const base = firstRow + rows.length - tail.length
  const box = tail.findIndex((text) => SEPARATOR_RE.test(text))
  if (box >= 0) return base + box
  const input = tail.findIndex((text) => CODEX_INPUT_RE.test(text))
  return input >= 0 ? base + input : undefined
}

export class TerminalBlocks {
  private cache: Block[] = []
  private dirty = true
  private stamps: Stamp[] = []
  private lastStampAt = 0
  private timer: number | null = null
  private source: (() => ExternalCommand[]) | null = null
  private readonly listeners = new Set<() => void>()
  private readonly subscription: IDisposable

  constructor(
    private readonly term: Terminal,
    private readonly promptRows: () => number[],
    private readonly host: BlocksHost
  ) {
    this.subscription = term.onWriteParsed(() => this.noteWrite())
  }

  dispose(): void {
    this.subscription.dispose()
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.clearStamps()
    this.listeners.clear()
  }

  /** Shell integration hands over the commands it marked, as rows, so they become blocks. */
  setCommandSource(source: (() => ExternalCommand[]) | null): void {
    this.source = source
    this.dirty = true
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  invalidate(): void {
    this.dirty = true
  }

  reset(): void {
    this.dirty = true
    this.clearStamps()
  }

  get isNormalBuffer(): boolean {
    return this.term.buffer.active.type === 'normal'
  }

  list(): Block[] {
    if (!this.dirty) return this.cache
    this.dirty = false
    this.cache = this.isNormalBuffer ? this.scan() : []
    return this.cache
  }

  blockAt(row: number): Block | null {
    const block = blockAtRow(this.list(), row)
    return block && row <= block.endRow ? block : null
  }

  /** The lines the program printed in a row range, with wrapped rows joined. */
  lines(from: number, to: number): BlockLine[] {
    const buffer = this.term.buffer.active
    const out: BlockLine[] = []
    for (let row = Math.max(0, from); row <= Math.min(to, buffer.length - 1); row += 1) {
      const line = buffer.getLine(row)
      if (!line) continue
      const next = buffer.getLine(row + 1)
      const text = line.translateToString(next?.isWrapped !== true)
      const last = out[out.length - 1]
      if (line.isWrapped && last) {
        last.text += text
        last.rows += 1
      } else out.push({ row, rows: 1, text })
    }
    return out
  }

  textOf(block: Block): string {
    return this.lines(block.startRow, block.endRow)
      .map((line) => this.host.readable(line.text).replace(/\s+$/, ''))
      .join('\n')
  }

  /** What the block printed after its first line, which is the command or the prompt itself. */
  outputOf(block: Block): string {
    return this.lines(block.startRow, block.endRow)
      .slice(1)
      .map((line) => this.host.readable(line.text).replace(/\s+$/, ''))
      .join('\n')
  }

  durationOf(block: Block): number | null {
    if (block.durationMs !== null) return block.durationMs
    const start = this.lineTime(block.startRow)
    const end = this.lineTime(block.endRow)
    if (start === null || end === null || end - start < MIN_TIMED_MS) return null
    return end - start
  }

  durationLabel(block: Block): string | null {
    const ms = this.durationOf(block)
    return ms === null ? null : formatDuration(ms)
  }

  /** When the program wrote this row, to about half a second. */
  lineTime(row: number): number | null {
    let best: Stamp | null = null
    for (const stamp of this.stamps) {
      if (stamp.marker.isDisposed || stamp.marker.line < row) continue
      if (!best || stamp.marker.line < best.marker.line || (stamp.marker.line === best.marker.line && stamp.at < best.at)) best = stamp
    }
    return best ? best.at : null
  }

  get top(): number {
    return this.term.buffer.active.viewportY
  }

  get rows(): number {
    return this.term.rows
  }

  get length(): number {
    return this.term.buffer.active.length
  }

  get atBottom(): boolean {
    const buffer = this.term.buffer.active
    return buffer.viewportY >= buffer.baseY
  }

  scrollToRow(row: number): void {
    const buffer = this.term.buffer.active
    this.term.scrollToLine(Math.max(0, Math.min(row, buffer.baseY)))
  }

  jumpTo(block: Block): void {
    this.scrollToRow(block.startRow)
    this.flash(block.startRow, block.endRow)
  }

  flash(from: number, to: number): void {
    const buffer = this.term.buffer.active
    const offset = from - (buffer.baseY + buffer.cursorY)
    const marker = this.term.registerMarker(offset)
    if (!marker) return
    const decoration = this.term.registerDecoration({
      marker,
      width: this.term.cols,
      height: Math.max(1, Math.min(to - from + 1, 40)),
      backgroundColor: FLASH_COLOR,
      layer: 'bottom'
    })
    window.setTimeout(() => {
      decoration?.dispose()
      marker.dispose()
    }, FLASH_MS)
  }

  private scan(): Block[] {
    const buffer = this.term.buffer.active
    const rows: string[] = []
    for (let row = Math.max(0, buffer.length - LIVE_ROWS); row < buffer.length; row += 1) rows.push(buffer.getLine(row)?.translateToString(true) ?? '')
    const agent = this.host.agent()
    const liveFromRow = agent && agent !== 'shell' ? liveStartRow(rows, Math.max(0, buffer.length - LIVE_ROWS)) : undefined
    return parseBlocks(this.lines(0, buffer.length - 1), {
      agent,
      running: this.host.busy(),
      liveFromRow,
      promptRows: new Set(this.promptRows()),
      commands: this.source?.() ?? []
    })
  }

  private noteWrite(): void {
    this.dirty = true
    this.stamp()
    if (this.listeners.size === 0 || this.timer !== null) return
    this.timer = window.setTimeout(() => {
      this.timer = null
      if (this.host.visible()) for (const listener of [...this.listeners]) listener()
    }, EMIT_MS)
  }

  private stamp(): void {
    const now = Date.now()
    if (now - this.lastStampAt < STAMP_MS || !this.isNormalBuffer) return
    const marker = this.term.registerMarker(0)
    if (!marker) return
    this.lastStampAt = now
    this.stamps.push({ marker, at: now })
    marker.onDispose(() => (this.stamps = this.stamps.filter((stamp) => stamp.marker !== marker)))
    while (this.stamps.length > MAX_STAMPS) this.stamps.shift()?.marker.dispose()
  }

  private clearStamps(): void {
    for (const stamp of this.stamps) stamp.marker.dispose()
    this.stamps = []
  }
}
