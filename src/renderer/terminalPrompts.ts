import type { IMarker, Terminal } from '@xterm/xterm'
import { extractPrompt } from '../shared/promptBox'
import { applyTyped, extractReply, type ScreenLine } from '../shared/terminalText'

const MAX_MARKERS = 200
const FLASH_MS = 700
const FLASH_COLOR = '#5b8def'

export interface ReplyCopy {
  text: string
  lineCount: number
  fromScreen: boolean
}

export class TerminalPrompts {
  private markers: IMarker[] = []
  private typed = ''

  constructor(private readonly term: Terminal) {}

  noteInput(data: string): void {
    if (data === '\r') this.addMarker()
    this.typed = applyTyped(this.typed, data)
  }

  clear(): void {
    for (const marker of this.markers) marker.dispose()
    this.markers = []
    this.typed = ''
  }

  dispose(): void {
    this.clear()
  }

  get count(): number {
    return this.live().length
  }

  /** The buffer rows where you sent a prompt, oldest first. */
  lines(): number[] {
    return this.live().map((marker) => marker.line)
  }

  get viewportY(): number {
    return this.term.buffer.active.viewportY
  }

  canJump(direction: 1 | -1): boolean {
    return this.term.buffer.active.type === 'normal' && this.target(direction) !== null
  }

  jump(direction: 1 | -1): boolean {
    const target = this.target(direction)
    if (!target) return false
    this.term.scrollToLine(target.line)
    this.flash(target.marker)
    return true
  }

  replyText(): ReplyCopy {
    const buffer = this.term.buffer.active
    const marker = this.live().at(-1)
    if (marker) {
      const lines = this.collect(marker.line, buffer.length)
      return { ...extractReply(lines, 0), fromScreen: false }
    }
    const lines = this.collect(buffer.viewportY, buffer.viewportY + this.term.rows)
    return { ...extractReply(lines, -1), fromScreen: true }
  }

  promptText(): string {
    const buffer = this.term.buffer.active
    const rows: string[] = []
    for (let row = buffer.baseY; row < buffer.baseY + this.term.rows; row += 1) {
      rows.push(buffer.getLine(row)?.translateToString(true) ?? '')
    }
    return extractPrompt(rows, this.term.cols) ?? this.typed.trim()
  }

  private addMarker(): void {
    const marker = this.term.registerMarker(0)
    if (!marker) return
    this.markers.push(marker)
    marker.onDispose(() => (this.markers = this.markers.filter((m) => m !== marker)))
    while (this.markers.length > MAX_MARKERS) this.markers.shift()?.dispose()
  }

  private live(): IMarker[] {
    return this.markers.filter((marker) => !marker.isDisposed && marker.line >= 0)
  }

  private target(direction: 1 | -1): { line: number; marker: IMarker } | null {
    const buffer = this.term.buffer.active
    const top = buffer.viewportY
    const markers = this.live()
    if (direction === -1) {
      const marker = markers.filter((m) => m.line < top).at(-1)
      return marker ? { line: marker.line, marker } : null
    }
    if (top >= buffer.baseY) return null
    const marker = markers.find((m) => m.line > top)
    return marker ? { line: Math.min(marker.line, buffer.baseY), marker } : null
  }

  private collect(from: number, to: number): ScreenLine[] {
    const buffer = this.term.buffer.active
    const lines: ScreenLine[] = []
    for (let row = from; row < to; row += 1) {
      const line = buffer.getLine(row)
      lines.push({ text: line?.translateToString(true) ?? '', isWrapped: line?.isWrapped ?? false })
    }
    return lines
  }

  private flash(marker: IMarker): void {
    const decoration = this.term.registerDecoration({
      marker,
      width: this.term.cols,
      backgroundColor: FLASH_COLOR,
      layer: 'bottom'
    })
    if (decoration) setTimeout(() => decoration.dispose(), FLASH_MS)
  }
}
