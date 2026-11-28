import { muteHiddenSelectionRedraw } from './terminalHiddenGuard'
import { timed } from './slowPhases'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { loadTerminalUnicode } from '../shared/terminalUnicode'
import type { TextOrder } from '../shared/arabicRows'
import { logicalText, visualFromLogical } from '../shared/visualOrder'
import { insertionData } from '../shared/insertText'
import { primaryModifierPressed } from '../shared/shortcuts'
import { h } from './dom'
import { PromptSelection } from './promptSelection'
import { TerminalPrompts } from './terminalPrompts'
import { TerminalBlockTools, type BlockCallbacks } from './terminalBlockTools'
import { openContextMenu } from './components/contextMenu'
import { TerminalArabic } from './terminalArabic'
import { TerminalHighlights, type HighlightHost } from './terminalHighlights'
import { registerFileLinks, type FileLinkHost, type FileLinks } from './terminalLinks'
import { TerminalSearch } from './terminalSearch'
import { TerminalRendering } from './terminalRendering'
import type { ThemeBundle } from './themeManager'
import { TERMINAL_FONT } from './terminalFont'
import { terminalShouldSleep } from '../shared/terminalSleep'
import { PermissionPromptTracker } from '../shared/notificationAction'
import { releaseRenderer, reserveRenderer } from './terminalGpu'
import { registerTerminalOsc, type TerminalOscHost } from './terminalOsc'
import { TerminalShell, type TerminalShellHost } from './terminalShell'
import type { IDisposable } from '@xterm/xterm'

const SHIFT_ENTER = '\x1b\r'


/**
 * A terminal hidden this long drops its GPU renderer until it is shown again. 1.10.0 cut this from 10 minutes to 60 s,
 * so nearly every tab switch in full screen rebuilt a WebGL context and redrew the whole buffer; it is back to 10 minutes.
 */
const TERMINAL_SLEEP_MS = 10 * 60_000
const VISIBILITY_RECHECK_MS = 2500
export interface TerminalCallbacks {
  osc: TerminalOscHost
  shell: TerminalShellHost
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
  sleepingEnabled(): boolean
  imagesEnabled(): boolean
  ligaturesEnabled(): boolean
  blocks: BlockCallbacks
}

export class TerminalView {
  readonly el: HTMLElement
  private readonly term: Terminal
  private readonly fitAddon = new FitAddon()
  private readonly observer: ResizeObserver
  private readonly search: TerminalSearch
  private readonly rendering: TerminalRendering
  private readonly osc: IDisposable
  private readonly shell: TerminalShell
  private readonly linkTooltip = h('div', { class: 'xterm-hover term-link-tooltip', role: 'tooltip', hidden: true })
  readonly prompts: TerminalPrompts
  private readonly blockTools: TerminalBlockTools
  private readonly promptSelection: PromptSelection
  private readonly highlights: TerminalHighlights
  private readonly fileLinks: FileLinks
  private readonly arabic: TerminalArabic
  private webgl: WebglAddon | null = null
  private opened = false
  private fitTimer: ReturnType<typeof setTimeout> | undefined
  private lastSize = ''
  private columnCap: number | null = null
  private lent: HTMLElement | null = null
  private bundleTerm: ThemeBundle['theme']['term']
  private hiddenSince: number | null = null
  private visible = false
  private requestedVisible = false
  private visibilityCheckedAt = 0
  private paneHidden = false
  private visibilityTimer: ReturnType<typeof setTimeout> | undefined
  private readonly permissionTracker = new PermissionPromptTracker(crypto.randomUUID())
  private permissionWrites = 0
  private setupBar: HTMLElement | null = null

  constructor(
    readonly id: string,
    fontSize: number,
    bundle: ThemeBundle,
    private readonly callbacks: TerminalCallbacks
  ) {
    this.el = h('div', { class: 'term-host', 'data-term-id': id })
    this.el.classList.toggle('shell-terminal', callbacks.shell.enabled())
    this.term = new Terminal({
      fontFamily: TERMINAL_FONT,
      fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorInactiveStyle: 'outline',
      scrollback: 10000,
      allowTransparency: true,
      allowProposedApi: true,
      theme: bundle.xterm,
      minimumContrastRatio: bundle.minimumContrastRatio,
      linkHandler: {
        activate: (event, uri) => this.handleLink(event, uri),
        hover: (event, uri) => {
          this.linkTooltip.textContent = uri
          this.linkTooltip.hidden = false
          const bounds = this.el.getBoundingClientRect()
          this.linkTooltip.style.left = `${Math.max(0, Math.min(event.clientX - bounds.left, bounds.width / 2))}px`
          this.linkTooltip.style.top = `${Math.max(0, Math.min(event.clientY - bounds.top + 20, bounds.height - 36))}px`
        },
        leave: () => { this.linkTooltip.hidden = true }
      }
    })
    loadTerminalUnicode(this.term)
    this.osc = registerTerminalOsc(this.term, callbacks.osc)
    this.shell = new TerminalShell(this.term, callbacks.shell)
    this.rendering = new TerminalRendering(this.term)
    this.refreshRendering()
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(new WebLinksAddon((event, uri) => this.handleLink(event, uri)))
    this.fileLinks = registerFileLinks(this.term, callbacks.fileLinks)
    this.highlights = new TerminalHighlights(this.term, callbacks.highlights)
    this.prompts = new TerminalPrompts(this.term)
    this.blockTools = new TerminalBlockTools(this.term, this.el, this.prompts, {
      callbacks: callbacks.blocks,
      readable: (text) => this.readable(text),
      plain: () => callbacks.textOrder() === 'visual',
      openFile: (ref) => callbacks.fileLinks.open(ref, { ctrlKey: true, metaKey: false, shiftKey: true }),
      typed: (data) => callbacks.onInput(data),
      visible: () => this.visible
    })
    this.arabic = new TerminalArabic(this.term, () => callbacks.textOrder())
    this.promptSelection = new PromptSelection(this.term, (data) => callbacks.onInput(data))
    this.term.onData((data) => {
      if (data !== '\x1b[I' && data !== '\x1b[O') this.permissionTracker.invalidate()
      this.prompts.noteInput(data)
      this.shell.noteInput(data)
      this.promptSelection.noteInput(data)
      callbacks.onInput(data)
    })
    this.term.onResize(({ cols, rows }) => {
      const size = `${cols}:${rows}`
      if (size === this.lastSize) return
      this.lastSize = size
      console.debug('[term] resize', id, cols, rows)
      callbacks.onResize(cols, rows)
    })
    this.term.attachCustomKeyEventHandler((event) => this.handleKey(event))
    this.observer = new ResizeObserver(() => this.scheduleFit())
    this.el.addEventListener('wheel', (event) => this.handleWheel(event), { capture: true, passive: false })
    this.el.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      const ref = this.fileLinks.hovered()
      if (ref) return callbacks.fileLinks.menu(ref, event.clientX, event.clientY, () => this.term.focus())
      const entries = this.blockTools.contextEntries(event)
      if (entries.length > 0) openContextMenu({ x: event.clientX, y: event.clientY, label: 'Terminal', entries, returnFocus: () => this.term.focus() })
    })
    this.el.addEventListener('focusin', () => callbacks.onFocus())
    this.search = new TerminalSearch(this.term, this.el, {
      toBuffer: (query) => (callbacks.textOrder() === 'visual' ? visualFromLogical(query) : query),
      toReading: (text) => this.readable(text)
    })
    this.bundleTerm = bundle.theme.term
    this.applyBundle(bundle)
  }

  get blocks(): TerminalBlockTools {
    return this.blockTools
  }

  toggleReading(): void {
    this.blockTools.toggleReading()
  }

  toggleOutline(): void {
    this.blockTools.toggleOutline()
  }

  canJumpBlock(direction: 1 | -1): boolean {
    return this.blockTools.canJumpBlock(direction)
  }

  jumpBlock(direction: 1 | -1): void {
    this.blockTools.jumpBlock(direction)
  }

  refreshHighlights(): void {
    this.highlights.refresh()
  }

  refreshRendering(): void {
    this.rendering.setImages(this.callbacks.imagesEnabled())
    this.rendering.setLigatures(this.callbacks.ligaturesEnabled())
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
    this.term.element?.append(this.linkTooltip)
    this.refreshRendering()
    this.loadWebgl()
    this.arabic.attach()
    this.arabic.setTheme(this.bundleTerm)
    this.observer.observe(this.el)
    this.scheduleFit()
  }

  write(data: string): void {
    this.permissionWrites += 1
    // Explicit clears may be coalesced with the next redraw by xterm before write callbacks run.
    if (/\x1b\[(?:2|3)J|\x1bc/.test(data)) this.permissionTracker.invalidate()
    this.term.write(data, () => {
      this.permissionTracker.observe(this.tailText(24))
      this.permissionWrites -= 1
    })
  }

  permissionId(): string | null {
    return this.permissionWrites ? null : this.permissionTracker.observe(this.tailText(24))
  }

  invalidatePermission(): void {
    this.permissionTracker.invalidate()
  }

  writeLine(message: string): void {
    this.write(`\r\n${message}\r\n`)
  }

  /** Text as the program meant it: rows a program wrote in visual order (Claude Code's Arabic) are put back in reading order. */
  private readable(text: string): string {
    return this.callbacks.textOrder() === 'visual' ? logicalText(text) : text
  }

  bufferText(): string {
    return this.readable(this.rawBufferText())
  }

  /** The buffer exactly as the program wrote it, without putting visual-order rows back in reading order. */
  rawBufferText(): string {
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
    return this.readable(this.joinedRows(start, end))
  }

  /** The rows on screen right now, and `above` rows of scrollback before them, for tests that watch for output arriving. */
  viewportText(above = 0): string {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let row = -above; row < this.term.rows; row += 1) lines.push(buffer.getLine(Math.max(0, buffer.viewportY + row))?.translateToString(true) ?? '')
    return lines.join('\n')
  }

  /** The whole buffer with wrapped rows joined back into the lines the program printed, for exports. */
  lineText(): string {
    return this.readable(this.joinedRows(0, this.term.buffer.active.length - 1))
  }

  private joinedRows(start: number, end: number): string {
    const buffer = this.term.buffer.active
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
    return this.readable(this.term.getSelection())
  }

  hasSelection(): boolean {
    return this.term.hasSelection()
  }

  clearScrollback(): void {
    this.term.clear()
    this.prompts.clear()
    this.blockTools.clear()
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

  /** The pane re-asserts this on every update; measuring the layout each time forced a layout pass per terminal, so an unchanged request is re-measured at most every VISIBILITY_RECHECK_MS. */
  setVisible(visible: boolean, paneHidden = false): void {
    const requested = visible || this.lent !== null
    const changed = requested !== this.requestedVisible || paneHidden !== this.paneHidden
    this.requestedVisible = requested
    this.paneHidden = paneHidden
    const sinceCheck = Date.now() - this.visibilityCheckedAt
    if (changed || sinceCheck >= VISIBILITY_RECHECK_MS) return this.refreshVisibility()
    clearTimeout(this.visibilityTimer)
    this.visibilityTimer = setTimeout(() => this.refreshVisibility(), VISIBILITY_RECHECK_MS - sinceCheck)
  }

  refreshVisibility(): void {
    timed('terminal show', () => this.applyVisibility())
  }

  private applyVisibility(): void {
    clearTimeout(this.visibilityTimer)
    this.visibilityCheckedAt = Date.now()
    this.visible = this.requestedVisible && document.visibilityState === 'visible' && (this.el.parentElement?.getClientRects().length ?? 0) > 0
    this.el.classList.toggle('active', this.requestedVisible)
    muteHiddenSelectionRedraw(this.term, !this.visible)
    this.highlights.setActive(this.visible)
    if (this.visible) {
      this.blockTools.refreshBars()
      this.hiddenSince = null
      this.loadWebgl()
      this.scheduleFit()
    } else if (this.hiddenSince === null) this.hiddenSince = Date.now()
    this.updateRenderer()
  }

  updateRenderer(): void {
    const timeoutMs = TERMINAL_SLEEP_MS
    if (terminalShouldSleep({ visible: this.visible, hiddenSince: this.hiddenSince }, Date.now(), timeoutMs, this.callbacks.sleepingEnabled())) {
      this.dropWebgl()
    }
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
    if (bundle.theme.kind === 'light') {
      this.dropWebgl()
    } else if (this.opened) {
      this.loadWebgl()
    }
    this.arabic.setTheme(bundle.theme.term)
  }

  /** Maximized panes keep lines to this many columns: the host gets narrower, so the fit addon never computes more. */
  setColumnCap(cap: number | null): void {
    if (cap === this.columnCap) return
    this.columnCap = cap
    if (cap === null) this.el.style.maxWidth = ''
    this.scheduleFit()
  }

  private applyColumnCap(): void {
    const cap = this.columnCap
    const screen = this.el.querySelector<HTMLElement>('.xterm-screen')
    const xterm = this.el.querySelector<HTMLElement>('.xterm')
    if (cap === null || !screen || !xterm || this.term.cols < 1 || screen.clientWidth < 1) return
    const style = getComputedStyle(xterm)
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
    const viewport = this.el.querySelector<HTMLElement>('.xterm-viewport')
    const scrollbar = viewport ? viewport.offsetWidth - viewport.clientWidth : 0
    const width = Math.ceil((screen.clientWidth / this.term.cols) * cap + padding + scrollbar)
    const next = `${width}px`
    if (this.el.style.maxWidth !== next) this.el.style.maxWidth = next
  }

  fitNow(): void {
    timed('terminal fit', () => this.fitTerminal())
  }

  private fitTerminal(): void {
    if (!this.opened || this.el.clientWidth < 40 || this.el.clientHeight < 20) return
    try {
      this.applyColumnCap()
      const size = this.fitAddon.proposeDimensions()
      if (!size || (size.cols === this.term.cols && size.rows === this.term.rows)) return
      this.fitAddon.fit()
      this.arabic.refresh()
    } catch (error) {
      console.warn('Terminal fit failed', error)
    }
  }

  /** A failed worktree setup waits for the owner here: Retry, or start the agent without it. */
  showSetupChoice(exitCode: number | null, choose: (action: 'retry' | 'start') => void): void {
    this.setupBar?.remove()
    this.setupBar = null
    this.el.classList.toggle('has-setup-choice', exitCode !== null)
    if (exitCode === null) return
    const retry = h('button', { class: 'btn small', type: 'button', onClick: () => choose('retry') }, 'Retry')
    const start = h('button', { class: 'btn primary small', type: 'button', onClick: () => choose('start') }, 'Start the agent anyway')
    this.setupBar = h('div', { class: 'term-setup-choice', role: 'group', 'aria-label': 'Worktree setup failed' },
      h('span', { class: 'term-setup-text' }, exitCode > 0 ? `Setup failed (exit ${exitCode}).` : 'Setup failed.'), retry, start)
    this.el.append(this.setupBar)
  }

  dispose(): void {
    this.dropWebgl()
    clearTimeout(this.fitTimer)
    clearTimeout(this.visibilityTimer)
    this.observer.disconnect()
    this.search.dispose()
    this.blockTools.dispose()
    this.prompts.dispose()
    this.highlights.dispose()
    this.arabic.dispose()
    this.rendering.dispose()
    this.osc.dispose()
    this.shell.dispose()
    this.term.dispose()
    this.el.remove()
  }

  private scheduleFit(): void {
    clearTimeout(this.fitTimer)
    this.fitTimer = setTimeout(() => this.fitNow(), 120)
  }

  private loadWebgl(): void {
    if (!this.opened || this.webgl || !this.visible) return
    // xterm's WebGL renderer applies 50% opacity to SGR dim text after its
    // contrast correction, which makes dim text fail contrast on light panes.
    if (document.documentElement.dataset.kind === 'light') return
    if (!reserveRenderer(this.id, { visible: () => this.visible, release: () => this.dropWebgl() })) return
    try {
      const webgl = new WebglAddon()
      this.webgl = webgl
      webgl.onContextLoss(() => {
        console.warn('[term] webgl context lost', this.id)
        webgl.dispose()
        if (this.webgl === webgl) { this.webgl = null; releaseRenderer(this.id) }
      })
      this.term.loadAddon(webgl)
    } catch (error) {
      this.webgl = null
      releaseRenderer(this.id)
      console.warn('WebGL renderer unavailable, using the DOM renderer', error)
    }
  }

  private dropWebgl(): void {
    this.webgl?.dispose()
    this.webgl = null
    releaseRenderer(this.id)
  }

  private handleLink(event: MouseEvent, uri: string): void {
    if ((event.ctrlKey || event.metaKey) && /^https?:\/\//i.test(uri)) this.callbacks.openLink(uri)
  }

  private handleWheel(event: WheelEvent): void {
    this.blockTools.noteWheel(event)
    if (!primaryModifierPressed(event)) return
    event.preventDefault()
    event.stopPropagation()
    this.callbacks.onZoom(event.deltaY < 0 ? 1 : -1)
  }

  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true
    if (!this.shell.handleKey(event)) return false
    if (!this.promptSelection.handleKey(event)) {
      event.preventDefault()
      return false
    }
    const key = event.key.toLowerCase()
    if (primaryModifierPressed(event) && !event.altKey && key === 'c' && this.term.hasSelection()) {
      void this.callbacks.writeClipboard(this.selection())
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
