import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import type { TextOrder } from '../shared/arabicRows'
import { insertionData } from '../shared/insertText'
import { primaryModifierPressed } from '../shared/shortcuts'
import { h } from './dom'
import { TerminalPrompts } from './terminalPrompts'
import { TerminalArabic } from './terminalArabic'
import { TerminalHighlights, type HighlightHost } from './terminalHighlights'
import { registerFileLinks, type FileLinkHost } from './terminalLinks'
import { TerminalSearch } from './terminalSearch'
import type { ThemeBundle } from './themeManager'
import { TERMINAL_FONT } from './terminalFont'

const SHIFT_ENTER = '\x1b\r'

export interface TerminalCallbacks {
  onInput(data: string): void
  onResize(cols: number, rows: number): void
  onZoom(direction: 1 | -1): void
  onFocus(): void
  readClipboard(): Promise<string>
  writeClipboard(text: string): Promise<void>
  openLink(url: string): void
  fileLinks: FileLinkHost
  highlights: HighlightHost
  /** How the program in this terminal writes right-to-left text. */
  textOrder(): TextOrder
}

export class TerminalView {
  readonly el: HTMLElement
  private readonly term: Terminal
  private readonly fitAddon = new FitAddon()
  private readonly observer: ResizeObserver
  private readonly search: TerminalSearch
  readonly prompts: TerminalPrompts
  private readonly highlights: TerminalHighlights
  private readonly arabic: TerminalArabic
  private opened = false
  private frame = 0
  private lent: HTMLElement | null = null
  private bundleTerm: ThemeBundle['theme']['term']

  constructor(
    readonly id: string,
    fontSize: number,
    bundle: ThemeBundle,
    private readonly callbacks: TerminalCallbacks
  ) {
    this.el = h('div', { class: 'term-host', 'data-term-id': id })
    this.term = new Terminal({
      fontFamily: TERMINAL_FONT,
      fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
      allowTransparency: true,
      allowProposedApi: true,
      theme: bundle.xterm,
      minimumContrastRatio: bundle.minimumContrastRatio
    })
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(new WebLinksAddon((event, uri) => this.handleLink(event, uri)))
    registerFileLinks(this.term, callbacks.fileLinks)
    this.highlights = new TerminalHighlights(this.term, callbacks.highlights)
    this.prompts = new TerminalPrompts(this.term)
    this.arabic = new TerminalArabic(this.term, () => callbacks.textOrder())
    this.term.onData((data) => {
      this.prompts.noteInput(data)
      callbacks.onInput(data)
    })
    this.term.onResize(({ cols, rows }) => callbacks.onResize(cols, rows))
    this.term.attachCustomKeyEventHandler((event) => this.handleKey(event))
    this.observer = new ResizeObserver(() => this.scheduleFit())
    this.el.addEventListener('wheel', (event) => this.handleWheel(event), { capture: true, passive: false })
    this.el.addEventListener('focusin', () => callbacks.onFocus())
    this.search = new TerminalSearch(this.term, this.el)
    this.bundleTerm = bundle.theme.term
    this.applyBundle(bundle)
  }

  refreshHighlights(): void {
    this.highlights.refresh()
  }

  openSearch(): void {
    this.search.open()
  }

  closeSearch(): void {
    this.search.close()
  }

  get cols(): number {
    return this.term.cols
  }

  get rows(): number {
    return this.term.rows
  }

  mount(parent: HTMLElement): void {
    const target = this.lent ?? parent
    if (this.el.parentElement !== target) target.appendChild(this.el)
    if (this.opened) return
    this.opened = true
    this.term.open(this.el)
    this.loadWebgl()
    this.arabic.attach()
    this.arabic.setTheme(this.bundleTerm)
    this.observer.observe(this.el)
    this.scheduleFit()
  }

  write(data: string): void {
    this.term.write(data)
  }

  writeLine(message: string): void {
    this.term.write(`\r\n${message}\r\n`)
  }

  bufferText(): string {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let row = 0; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? '')
    }
    return lines.join('\n')
  }

  /**
   * The last `rows` lines, ending at the last line with text on screen, so the empty rows of a tall terminal
   * don't push a prompt drawn near the top out of view. When the screen is at least `rows` tall the tail stays
   * on screen, so an older prompt in the scrollback can't be mistaken for a current one; an empty screen gives ''.
   */
  tailText(rows: number): string {
    const buffer = this.term.buffer.active
    const text = (row: number): string => buffer.getLine(row)?.translateToString(true) ?? ''
    const top = buffer.baseY
    let end = buffer.length - 1
    while (end >= top && text(end).trim() === '') end -= 1
    if (end < top) return ''
    let start = this.term.rows >= rows ? Math.max(top, end - rows + 1) : Math.max(0, end - rows + 1)
    // Start at the beginning of a wrapped line, and join wrapped rows back into the line the program printed.
    while (start > 0 && buffer.getLine(start)?.isWrapped) start -= 1
    const lines: string[] = []
    for (let row = start; row <= end; row += 1) {
      const line = buffer.getLine(row)
      // Keep trailing spaces of a row that continues on the next one, so words at the wrap stay apart.
      const continues = row < end && buffer.getLine(row + 1)?.isWrapped === true
      const value = line?.translateToString(!continues) ?? ''
      if (line?.isWrapped && lines.length > 0) lines[lines.length - 1] += value
      else lines.push(value)
    }
    return lines.join('\n')
  }

  selectAll(): void {
    this.term.selectAll()
  }

  selection(): string {
    return this.term.getSelection()
  }

  hasSelection(): boolean {
    return this.term.hasSelection()
  }

  clearScrollback(): void {
    this.term.clear()
    this.prompts.clear()
  }

  writeClipboard(text: string): Promise<void> {
    return this.callbacks.writeClipboard(text)
  }

  selectContaining(text: string): boolean {
    const buffer = this.term.buffer.active
    for (let row = 0; row < buffer.length; row += 1) {
      if (buffer.getLine(row)?.translateToString(true).includes(text)) {
        this.term.selectLines(row, row)
        return true
      }
    }
    return false
  }

  insertText(text: string): { flattened: boolean } {
    const { data, flattened } = insertionData(text, this.term.modes.bracketedPasteMode)
    if (data) this.callbacks.onInput(data)
    return { flattened }
  }

  get fontSize(): number {
    return this.term.options.fontSize ?? 0
  }

  focus(): void {
    this.term.focus()
  }

  blur(): void {
    this.term.blur()
  }

  /** Shows this terminal in another container (the board's peek) until it is returned; the pane stops reclaiming it. */
  lendTo(parent: HTMLElement): void {
    this.lent = parent
    this.mount(parent)
    this.setVisible(true)
  }

  returnLoan(): void {
    this.lent = null
  }

  setVisible(visible: boolean): void {
    const shown = visible || this.lent !== null
    this.el.classList.toggle('active', shown)
    if (shown) this.scheduleFit()
  }

  setFontSize(size: number): void {
    if (this.term.options.fontSize === size) return
    this.term.options.fontSize = size
    this.arabic.refresh()
    this.scheduleFit()
  }

  applyBundle(bundle: ThemeBundle): void {
    this.term.options.theme = bundle.xterm
    this.term.options.minimumContrastRatio = bundle.minimumContrastRatio
    this.el.style.background = bundle.hostBackground
    this.el.dataset.termBackground = String(bundle.xterm.background)
    this.bundleTerm = bundle.theme.term
    this.arabic.setTheme(bundle.theme.term)
  }

  fitNow(): void {
    if (!this.opened || this.el.clientWidth < 40 || this.el.clientHeight < 20) return
    try {
      this.fitAddon.fit()
      this.arabic.refresh()
    } catch (error) {
      console.warn('Terminal fit failed', error)
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.search.dispose()
    this.prompts.dispose()
    this.highlights.dispose()
    this.arabic.dispose()
    this.term.dispose()
    this.el.remove()
  }

  private scheduleFit(): void {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.fitNow())
  }

  private loadWebgl(): void {
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      this.term.loadAddon(webgl)
    } catch (error) {
      console.warn('WebGL renderer unavailable, using the DOM renderer', error)
    }
  }

  private handleLink(event: MouseEvent, uri: string): void {
    if (event.ctrlKey || event.metaKey) this.callbacks.openLink(uri)
  }

  private handleWheel(event: WheelEvent): void {
    if (!primaryModifierPressed(event)) return
    event.preventDefault()
    event.stopPropagation()
    this.callbacks.onZoom(event.deltaY < 0 ? 1 : -1)
  }

  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true
    const key = event.key.toLowerCase()
    if (primaryModifierPressed(event) && !event.altKey && key === 'c' && this.term.hasSelection()) {
      void this.callbacks.writeClipboard(this.term.getSelection())
      this.term.clearSelection()
      return false
    }
    if (primaryModifierPressed(event) && !event.altKey && key === 'v') {
      event.preventDefault()
      void this.callbacks
        .readClipboard()
        .then((text) => text && this.term.paste(text))
        .catch(() => undefined)
      return false
    }
    if (event.shiftKey && !event.ctrlKey && !event.altKey && event.key === 'Enter') {
      event.preventDefault()
      this.callbacks.onInput(SHIFT_ENTER)
      return false
    }
    return true
  }
}
