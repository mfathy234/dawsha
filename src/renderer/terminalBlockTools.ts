import type { ITheme, Terminal } from '@xterm/xterm'
import type { FileRef } from '../shared/filePaths'
import { stepBlock, type Block } from '../shared/terminalBlocks'
import type { ExternalCommand } from '../shared/terminalBlocks'
import type { TabAgent } from '../shared/types'
import type { ContextEntry } from './components/contextMenu'
import { TerminalBlockBars } from './terminalBlockBars'
import { TerminalBlocks } from './terminalBlocks'
import { TERMINAL_FONT } from './terminalFont'
import { renderLinesPng } from './terminalImage'
import { TerminalOutline } from './terminalOutline'
import type { TerminalPrompts } from './terminalPrompts'
import { TerminalReading } from './terminalReading'
import { TerminalSelection } from './terminalSelection'

const READ_BACK_SCREENS = 3

export interface BlockCallbacks {
  agent(): TabAgent | undefined
  busy(): boolean
  readingOnScroll(): boolean
  agentName(): string
  copy(text: string, done: string): void
  copyImage(blob: Blob): Promise<void>
  askSession(text: string, at: { x: number; y: number }): void
  sendFailure(block: Block, text: string, at: { x: number; y: number }): void
  searchFiles(text: string): void
}

export interface BlockToolsHost {
  callbacks: BlockCallbacks
  readable(text: string): string
  plain(): boolean
  openFile(ref: FileRef): void
  typed(data: string): void
  visible(): boolean
}

/** Everything that works on a terminal's blocks: the Reading view, jumps, the outline, scrollbar marks, selection actions and line times. */
export class TerminalBlockTools {
  readonly blocks: TerminalBlocks
  private readonly reading: TerminalReading
  private readonly outline: TerminalOutline
  private readonly bars: TerminalBlockBars
  private readonly selection: TerminalSelection
  private armed = true
  private readonly scrollWatch: { dispose(): void }

  constructor(private readonly term: Terminal, private readonly el: HTMLElement, prompts: TerminalPrompts, private readonly host: BlockToolsHost) {
    const { callbacks } = host
    this.blocks = new TerminalBlocks(term, () => prompts.lines(), {
      agent: () => callbacks.agent(),
      busy: () => callbacks.busy(),
      readable: (text) => host.readable(text),
      visible: () => host.visible()
    })
    const backToLive = (typed: string | null): void => {
      term.focus()
      if (typed) host.typed(typed)
    }
    const common = { blocks: this.blocks, agentName: () => callbacks.agentName(), sendFailure: callbacks.sendFailure }
    this.reading = new TerminalReading({ ...common, term, theme: () => this.theme(), plain: () => host.plain(), backToLive }, el)
    this.outline = new TerminalOutline({ ...common, copy: callbacks.copy, backToLive: () => backToLive(null) }, el)
    this.bars = new TerminalBlockBars(term, el, this.blocks, () => this.reading.isOpen || !host.visible())
    this.selection = new TerminalSelection(term, el, {
      ...common,
      readable: (text) => host.readable(text),
      copy: callbacks.copy,
      copyImage: (lines) => void this.copyImage(lines),
      askSession: callbacks.askSession,
      openFile: (ref) => host.openFile(ref),
      searchFiles: callbacks.searchFiles,
      focus: () => term.focus()
    })
    this.scrollWatch = term.onScroll(() => {
      if (this.blocks.atBottom) this.armed = true
    })
  }

  /** Draws the bars again, for a terminal that was hidden while output arrived. */
  refreshBars(): void {
    this.bars.redraw()
  }

  get readingOpen(): boolean {
    return this.reading.isOpen
  }

  setCommandSource(source: (() => ExternalCommand[]) | null): void {
    this.blocks.setCommandSource(source)
  }

  toggleReading(): void {
    this.outline.close()
    this.reading.toggle()
  }

  toggleOutline(): void {
    this.reading.close(null)
    this.outline.toggle()
  }

  canJumpBlock(direction: 1 | -1): boolean {
    if (!this.blocks.isNormalBuffer) return false
    return stepBlock(this.blocks.cached(), this.blocks.top, direction) !== null || (direction === 1 && !this.blocks.atBottom)
  }

  jumpBlock(direction: 1 | -1): void {
    const target = stepBlock(this.blocks.list(), this.blocks.top, direction)
    if (target) this.blocks.jumpTo(target)
    else if (direction === 1) this.term.scrollToBottom()
  }

  /** Called for wheel turns: a long way back opens the Reading view when the owner asked for that. */
  noteWheel(event: WheelEvent): void {
    if (event.deltaY >= 0 || !this.armed || !this.host.callbacks.readingOnScroll() || this.reading.isOpen) return
    requestAnimationFrame(() => {
      const buffer = this.term.buffer.active
      if (buffer.type !== 'normal' || buffer.viewportY >= buffer.baseY - this.term.rows * READ_BACK_SCREENS) return
      this.armed = false
      this.reading.open()
    })
  }

  contextEntries(event: MouseEvent): ContextEntry[] {
    return this.selection.menuEntries(event)
  }

  clear(): void {
    this.blocks.reset()
  }

  dispose(): void {
    this.scrollWatch.dispose()
    this.bars.dispose()
    this.selection.dispose()
    this.outline.dispose()
    this.reading.dispose()
    this.blocks.dispose()
  }

  private theme(): ITheme {
    return this.term.options.theme ?? {}
  }

  private async copyImage(lines: Parameters<typeof renderLinesPng>[1]): Promise<void> {
    const blob = await renderLinesPng(this.term, lines, { font: TERMINAL_FONT, size: this.term.options.fontSize ?? 13, theme: this.theme() })
    if (blob) await this.host.callbacks.copyImage(blob)
  }
}
