import { EditorView, showPanel, type Panel, type ViewUpdate } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { enclosingSymbols } from './jumpInputs'
import type { OutlineItem } from './outline'

const MAX_STICKY = 3

/** The class and method headers that have scrolled out above the first visible line, outermost first. */
export function stickyHeaders(items: readonly OutlineItem[], topLine: number, max = MAX_STICKY): OutlineItem[] {
  return enclosingSymbols(items, topLine).filter((item) => item.line < topLine).slice(-max)
}

class Sticky implements Panel {
  readonly dom = document.createElement('div')
  readonly top = true
  private signature = ''

  constructor(private readonly view: EditorView, private readonly outline: () => OutlineItem[]) {
    this.dom.className = 'cm-sticky'
    this.dom.hidden = true
    this.dom.setAttribute('aria-label', 'Enclosing scopes')
    view.scrollDOM.addEventListener('scroll', this.refresh)
    this.refresh()
  }

  private readonly refresh = (): void => {
    const view = this.view
    const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop)
    const topLine = view.state.doc.lineAt(block.from).number
    const headers = stickyHeaders(this.outline(), topLine)
    const signature = headers.map((item) => `${item.line}:${item.name}`).join('|')
    if (signature === this.signature) return
    this.signature = signature
    this.dom.hidden = headers.length === 0
    this.dom.replaceChildren(...headers.map((item) => this.row(item)))
  }

  private row(item: OutlineItem): HTMLElement {
    const view = this.view
    const line = view.state.doc.line(Math.min(item.line, view.state.doc.lines))
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'cm-sticky-row'
    row.textContent = line.text.trim()
    row.title = `Line ${item.line}`
    row.addEventListener('mousedown', (event) => event.preventDefault())
    row.addEventListener('click', () => view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start' }) }))
    return row
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.geometryChanged) this.refresh()
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener('scroll', this.refresh)
  }
}

/** Sticky scroll: the headers of the class and method you are inside stay at the top of the editor. */
export function stickyScroll(outline: () => OutlineItem[]): Extension {
  return showPanel.of((view) => new Sticky(view, outline))
}
