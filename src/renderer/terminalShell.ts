import type { IDisposable, IMarker, Terminal } from '@xterm/xterm'
import { commandDuration, ShellCommands, type ShellCommand } from '../shared/shellCommands'
import { h } from './dom'
import { openContextMenu } from './components/contextMenu'
import './terminalShell.css'

export interface TerminalShellHost {
  enabled(): boolean
  complete(command: ShellCommand, output: string): void
  rerun(command: string): void
  copy(output: string): void
  send(command: string, output: string): void
  history(): void
}

export class TerminalShell implements IDisposable {
  private readonly tracker = new ShellCommands()
  private readonly hook: IDisposable
  private input: IMarker | null = null
  private inputCol = 0
  private output: IMarker | null = null
  private outputCol = 0
  private executing = false
  private readonly decorations: IDisposable[] = []

  constructor(private readonly term: Terminal, private readonly host: TerminalShellHost) {
    this.hook = term.parser.registerOscHandler(133, (data) => {
      if (!host.enabled() || term.buffer.active.type !== 'normal') return false
      const buffer = term.buffer.active
      const row = buffer.baseY + buffer.cursorY
      if (data === 'A') { this.input?.dispose(); this.input = null; this.output?.dispose(); this.output = null; this.executing = false }
      if (data === 'B') { this.input?.dispose(); this.input = term.registerMarker(0) ?? null; this.inputCol = buffer.cursorX }
      const command = data === 'C' && this.input && !this.input.isDisposed
        ? this.read(this.input.line, row, this.inputCol, buffer.cursorX).trim() : ''
      if (data === 'C') { this.output?.dispose(); this.output = term.registerMarker(0) ?? null; this.outputCol = buffer.cursorX; this.executing = true }
      const completed = this.tracker.mark(data, row, Date.now(), command)
      if (completed) this.executing = false
      if (completed?.command) {
        const outputRow = this.output && !this.output.isDisposed ? this.output.line : 0
        const output = this.read(outputRow, row, this.outputCol, buffer.cursorX).trimEnd()
        if (this.input && !this.input.isDisposed) this.decorate({ ...completed, inputRow: this.input.line, outputRow }, row, output)
        host.complete(completed, output)
      }
      return true
    })
  }

  handleKey(event: KeyboardEvent): boolean {
    if (this.host.enabled() && (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'r') {
      event.preventDefault()
      this.host.history()
      return false
    }
    return true
  }

  private read(start: number, end: number, startCol: number, endCol: number): string {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let row = Math.max(0, start); row <= end && row - start < 3000; row++) {
      const line = buffer.getLine(row)
      const continued = row < end && buffer.getLine(row + 1)?.isWrapped
      const text = line?.translateToString(!continued, row === start ? startCol : 0, row === end ? endCol : undefined) ?? ''
      if (line?.isWrapped && lines.length) lines[lines.length - 1] += text
      else lines.push(text)
    }
    return lines.join('\n').slice(0, 64_000)
  }

  private decorate(command: ShellCommand, row: number, output: string): void {
    const marker = this.term.registerMarker(command.inputRow - row)
    if (!marker) return
    const decoration = this.term.registerDecoration({ marker, x: 0, width: 1, layer: 'top' })
    if (!decoration) { marker.dispose(); return }
    decoration.onRender((element) => {
      if (element.childElementCount) return
      const status = command.exitCode === null ? '–' : command.exitCode === 0 ? '✓' : '✗'
      const button = h('button', {
        class: 'term-shell-command', type: 'button',
        'aria-label': `${status} ${command.command}, ${commandDuration(command.durationMs)}. Command actions`,
        title: `${status} ${command.command} · ${commandDuration(command.durationMs)}`
      }, status, h('span', { class: 'term-shell-duration' }, commandDuration(command.durationMs)))
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        const bounds = button.getBoundingClientRect()
        openContextMenu({ x: bounds.left, y: bounds.bottom, label: 'Shell command actions', returnFocus: () => this.term.focus(), entries: [
          { label: 'Rerun', disabled: !this.canRerun(), run: () => { if (this.canRerun()) this.host.rerun(command.command) } },
          { label: 'Copy output', run: () => this.host.copy(output) },
          { label: 'Send to a session…', run: () => this.host.send(command.command, output) }
        ] })
      })
      element.append(button)
    })
    this.decorations.push({ dispose: () => { decoration.dispose(); marker.dispose() } })
    while (this.decorations.length > 200) this.decorations.shift()?.dispose()
  }

  private canRerun(): boolean {
    if (this.executing || !this.input || this.input.isDisposed) return false
    const buffer = this.term.buffer.active
    let end = buffer.baseY + buffer.cursorY
    while (buffer.getLine(end + 1)?.isWrapped) end++
    return this.read(this.input.line, end, this.inputCol, this.term.cols).trim() === ''
  }

  dispose(): void {
    this.hook.dispose()
    this.input?.dispose()
    this.output?.dispose()
    this.decorations.forEach((decoration) => decoration.dispose())
  }
}
