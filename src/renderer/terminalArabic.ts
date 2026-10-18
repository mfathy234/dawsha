import type { IBufferCell, IDisposable, ITheme, Terminal } from '@xterm/xterm'
import {
  buildRuns,
  hasArabic,
  inSelection,
  paletteColor,
  paragraphDirection,
  PLAIN_STYLE,
  rgbColor,
  rowSignature,
  visualSegments,
  type CellStyle,
  type RowCell,
  type Run,
  type Segment,
  type TextOrder
} from '../shared/arabicRows'
import { TERMINAL_FONT } from './terminalFont'

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
] as const

interface OverlayRow {
  el: HTMLElement
  signature: string
}

interface CoreAccess {
  _core?: { coreService?: { isCursorHidden?: boolean } }
}

/**
 * Draws rows that contain Arabic as DOM text on top of the terminal's canvas, so the browser does the contextual
 * shaping and BiDi. The xterm buffer is only read, never changed: copy, find, transcripts and replays stay logical.
 */
export class TerminalArabic {
  private readonly rows = new Map<number, OverlayRow>()
  private readonly subscriptions: IDisposable[] = []
  private readonly cell: IBufferCell
  private layer: HTMLElement | null = null
  private screen: HTMLElement | null = null
  private theme: ITheme = {}
  private frame = 0
  private metrics = ''

  /** `order` says how the program in this terminal writes right-to-left text; it is asked again on every update. */
  constructor(
    private readonly term: Terminal,
    private readonly order: () => TextOrder = () => 'logical'
  ) {
    this.cell = term.buffer.active.getNullCell()
  }

  /** Call once the terminal is open. */
  attach(): void {
    const screen = this.term.element?.querySelector<HTMLElement>('.xterm-screen') ?? null
    if (!screen || this.layer) return
    this.screen = screen
    this.layer = document.createElement('div')
    this.layer.className = 'term-arabic-layer'
    screen.appendChild(this.layer)
    const schedule = (): void => this.schedule()
    this.subscriptions.push(
      this.term.onRender(schedule),
      this.term.onScroll(schedule),
      this.term.onResize(schedule),
      this.term.onSelectionChange(schedule),
      this.term.onCursorMove(schedule)
    )
    this.schedule()
  }

  setTheme(theme: ITheme): void {
    this.theme = theme
    this.schedule()
  }

  /** Re-reads font size and cell size, e.g. after a zoom or a fit. */
  refresh(): void {
    this.schedule()
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    for (const subscription of this.subscriptions) subscription.dispose()
    this.subscriptions.length = 0
    this.clear()
    this.layer?.remove()
    this.layer = null
  }

  private schedule(): void {
    if (!this.layer || this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.update()
    })
  }

  private clear(): void {
    for (const row of this.rows.values()) row.el.remove()
    this.rows.clear()
  }

  private update(): void {
    const { layer, screen } = this
    if (!layer || !screen) return
    const width = screen.clientWidth
    const height = screen.clientHeight
    const { cols, rows } = this.term
    if (width < 1 || height < 1 || cols < 1 || rows < 1) return this.clear()
    const cellW = width / cols
    const cellH = height / rows
    const background = this.theme.background ?? '#000000'
    const metrics = `${cellW.toFixed(3)}|${cellH.toFixed(3)}|${this.term.options.fontSize}|${background}|${this.theme.foreground}|${this.theme.cursor}`
    if (metrics !== this.metrics) {
      this.metrics = metrics
      this.clear()
      layer.style.cssText =
        `--arabic-bg:${background};--arabic-fg:${this.theme.foreground ?? '#ffffff'};` +
        `--arabic-cursor:${this.theme.cursor ?? this.theme.foreground ?? '#ffffff'};` +
        `font-family:${TERMINAL_FONT};font-size:${this.term.options.fontSize}px;line-height:${cellH}px`
    }
    const buffer = this.term.buffer.active
    const cursorRow = buffer.cursorY
    const cursorVisible = !(this.term as unknown as CoreAccess)._core?.coreService?.isCursorHidden
    const selection = this.term.getSelectionPosition()
    let order: TextOrder | null = null
    for (let r = 0; r < rows; r += 1) {
      const line = buffer.getLine(buffer.viewportY + r)
      if (!line || !hasArabic(line.translateToString(true))) {
        this.drop(r)
        continue
      }
      const absolute = buffer.viewportY + r
      const cells: RowCell[] = []
      for (let x = 0; x < cols; x += 1) {
        const cell = line.getCell(x, this.cell)
        if (!cell) break
        cells.push({ chars: cell.getChars(), width: cell.getWidth(), style: this.styleOf(cell, absolute, x, selection) })
      }
      const cursorX = cursorVisible && buffer.viewportY + r === buffer.baseY + cursorRow ? buffer.cursorX : null
      order ??= this.order()
      if (order === 'visual') this.drawVisual(r, cells, cursorX, cellH)
      else this.drawLogical(r, cells, cursorX, cellH)
    }
  }

  private drawLogical(r: number, cells: readonly RowCell[], cursorX: number | null, cellH: number): void {
    const runs = buildRuns(cells, cursorX)
    const dir = paragraphDirection(runs.map((run) => run.text).join(''))
    const signature = rowSignature(runs, `${dir}|${r}`)
    const existing = this.rows.get(r)
    if (existing?.signature === signature) return
    this.draw(r, existing, runs.map((run) => this.span(run)), dir, signature, cellH)
  }

  /** The program already laid the row out left-to-right: keep that layout and only redraw Arabic stretches shaped. */
  private drawVisual(r: number, cells: readonly RowCell[], cursorX: number | null, cellH: number): void {
    const segments = visualSegments(cells, cursorX)
    const shape = segments.map((segment) => (segment.rtl ? 'r' : 'l')).join('')
    const signature = rowSignature(segments.flatMap((segment) => segment.runs), `visual|${shape}|${r}`)
    const existing = this.rows.get(r)
    if (existing?.signature === signature) return
    this.draw(r, existing, segments.flatMap((segment) => this.segmentNodes(segment)), 'ltr', signature, cellH)
  }

  private segmentNodes(segment: Segment): HTMLElement[] {
    const spans = segment.runs.map((run) => this.span(run))
    if (!segment.rtl) return spans
    const isolate = document.createElement('span')
    isolate.className = 'term-arabic-rtl'
    isolate.dir = 'rtl'
    isolate.append(...spans)
    return [isolate]
  }

  private drop(row: number): void {
    const existing = this.rows.get(row)
    if (!existing) return
    existing.el.remove()
    this.rows.delete(row)
  }

  private draw(r: number, existing: OverlayRow | undefined, nodes: readonly HTMLElement[], dir: 'rtl' | 'ltr', signature: string, cellH: number): void {
    const el = existing?.el ?? document.createElement('div')
    el.className = 'term-arabic-row'
    el.dir = dir
    el.dataset.row = String(r)
    el.style.top = `${r * cellH}px`
    el.style.height = `${cellH}px`
    el.replaceChildren(...nodes)
    if (!existing) this.layer?.appendChild(el)
    this.rows.set(r, { el, signature })
  }

  private span(run: Run): HTMLElement {
    const span = document.createElement('span')
    const style = run.style
    span.textContent = run.text
    if (style.cursor) {
      span.className = 'term-arabic-cursor'
      return span
    }
    let fg = style.fg
    let bg = style.bg
    if (style.selected) {
      bg = this.theme.selectionBackground ?? '#444444'
      fg = style.fg
    }
    if (fg) span.style.color = fg
    if (bg) span.style.background = bg
    if (style.bold) span.style.fontWeight = '700'
    if (style.italic) span.style.fontStyle = 'italic'
    if (style.underline || style.strike) {
      span.style.textDecoration = [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ')
    }
    if (style.dim) span.style.opacity = '0.6'
    return span
  }

  private styleOf(
    cell: IBufferCell,
    absolute: number,
    x: number,
    selection: { start: { x: number; y: number }; end: { x: number; y: number } } | undefined
  ): CellStyle {
    const ansi = ANSI_KEYS.map((key) => this.theme[key] ?? '#ffffff')
    const bold = cell.isBold() !== 0
    let fg = this.colorOf(cell.isFgDefault(), cell.isFgPalette(), cell.isFgRGB(), cell.getFgColor(), ansi, bold)
    let bg = this.colorOf(cell.isBgDefault(), cell.isBgPalette(), cell.isBgRGB(), cell.getBgColor(), ansi, false)
    if (cell.isInverse() !== 0) {
      const swapFg = bg ?? this.theme.background ?? '#000000'
      const swapBg = fg ?? this.theme.foreground ?? '#ffffff'
      fg = swapFg
      bg = swapBg
    }
    if (cell.isInvisible() !== 0) fg = bg ?? this.theme.background ?? '#000000'
    const selected = selection ? inSelection(absolute, x, selection.start, selection.end) : false
    if (!fg && !bg && !bold && !selected && cell.isItalic() === 0 && cell.isUnderline() === 0 && cell.isStrikethrough() === 0 && cell.isDim() === 0) {
      return PLAIN_STYLE
    }
    return {
      fg,
      bg,
      bold,
      italic: cell.isItalic() !== 0,
      underline: cell.isUnderline() !== 0,
      strike: cell.isStrikethrough() !== 0,
      dim: cell.isDim() !== 0,
      selected,
      cursor: false
    }
  }

  private colorOf(isDefault: boolean, isPalette: boolean, isRgb: boolean, value: number, ansi: readonly string[], bold: boolean): string | null {
    if (isDefault) return null
    if (isPalette) return paletteColor(bold && value < 8 ? value + 8 : value, ansi)
    return isRgb ? rgbColor(value) : null
  }
}
