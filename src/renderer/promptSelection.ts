import type { Terminal } from '@xterm/xterm'
import { promptLayout, shrinkSelection, wordStartBefore, type PromptLayout } from '../shared/promptLayout'

const BACKSPACE = '\x7f'
/** Keys that move the agent's caret. After one, Dawsha no longer knows where the caret is, so it stays out of the way. */
const CARET_MOVES = /^\x1b(\[|O)[ABCDHF]|^\x1b\[1;\d[ABCDHF]|^\x1b\[[1-4]~|^\x01|^\x02|^\x06|^\x1bb|^\x1bf/
/** Keys that leave the caret at the end of the input: submitting, clearing or End. */
const CARET_TO_END = /^[\r\x03\x05]|^\x1b\[F|^\x1bOF|^\x1b\[4~/

/**
 * Ctrl+Shift+Left and Right in an agent's input box, like in a text box: each press selects one more (or one less)
 * word back from the caret, up to the whole prompt. Backspace or Delete removes the selection, typing replaces it,
 * and Ctrl+C copies it. The agent owns its input, so Dawsha only works when the caret is at the end of what was
 * typed, which it is unless arrow keys moved it.
 */
export class PromptSelection {
  private start: number | null = null
  private layout: PromptLayout | null = null
  private caretAtEnd = true

  constructor(private readonly term: Terminal, private readonly send: (data: string) => void) {}

  /** Every keystroke the terminal sends, to know whether the caret is still at the end of the input. */
  noteInput(data: string): void {
    if (CARET_TO_END.test(data)) this.caretAtEnd = true
    else if (CARET_MOVES.test(data)) this.caretAtEnd = false
  }

  /** Returns false when the key was handled here, true to let the terminal have it. */
  handleKey(event: KeyboardEvent): boolean {
    const word = event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey
    if (word && event.key === 'ArrowLeft') return this.grow()
    if (word && event.key === 'ArrowRight') return this.shrink()
    if (this.start === null) return true
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return true
    // A mouse selection or anything else that replaced ours means the words are no longer selected.
    if (!this.term.hasSelection()) {
      this.forget()
      return true
    }
    if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c') {
      // The terminal copies the highlighted text and clears it.
      this.forget()
      return true
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      this.removeSelected()
      return false
    }
    const typed = event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey
    if (typed) this.removeSelected()
    else this.clear()
    return true
  }

  clear(): void {
    if (this.start === null) return
    this.forget()
    this.term.clearSelection()
  }

  private forget(): void {
    this.start = null
    this.layout = null
  }

  private grow(): boolean {
    if (!this.caretAtEnd) return true
    const layout = this.readLayout()
    if (!layout) return true
    const from = this.start ?? layout.text.length
    this.show(layout, wordStartBefore(layout.text, from))
    return false
  }

  private shrink(): boolean {
    if (this.start === null || !this.layout) return true
    const next = shrinkSelection(this.layout.text, this.start)
    if (next >= this.layout.text.length) this.clear()
    else this.show(this.layout, next)
    return false
  }

  private show(layout: PromptLayout, start: number): void {
    this.layout = layout
    this.start = start
    const first = layout.cells[start]
    const last = layout.cells[layout.cells.length - 1]
    if (!first || !last) return
    const top = this.term.buffer.active.baseY
    const length = (last.row - first.row) * this.term.cols + (last.col - first.col) + 1
    this.term.select(first.col, top + first.row, length)
  }

  private removeSelected(): void {
    if (this.start === null || !this.layout) return
    const count = this.layout.text.length - this.start
    this.clear()
    if (count > 0) this.send(BACKSPACE.repeat(count))
  }

  private readLayout(): PromptLayout | null {
    const buffer = this.term.buffer.active
    const rows: string[] = []
    for (let row = buffer.baseY; row < buffer.baseY + this.term.rows; row += 1) rows.push(buffer.getLine(row)?.translateToString(true) ?? '')
    return promptLayout(rows, this.term.cols)
  }
}
