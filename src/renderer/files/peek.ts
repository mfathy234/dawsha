import { Compartment, EditorState } from '@codemirror/state'
import { Decoration, EditorView, lineNumbers } from '@codemirror/view'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { baseTheme } from './editor'
import type { InlineElement } from './editorNav'
import { loadLanguage } from './languages'

export interface PeekHit {
  /** Project-relative, as the engine reported it: what the list shows. */
  path: string
  /** Repo-relative: what opens. */
  repoPath: string
  line: number
  column: number
  preview: string
}

export interface PeekModel {
  note: string
  hits: readonly PeekHit[]
}

export interface PeekHooks {
  open(hit: PeekHit): void
  close(): void
  /** The text to show on the left for a hit's file, or null when it cannot be read. */
  text(hit: PeekHit): Promise<string | null>
  dark(): boolean
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const dirName = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const hitLine = Decoration.line({ class: 'nav-peek-hit' })

interface Group {
  path: string
  rows: Array<{ hit: PeekHit; index: number }>
}

function groupHits(hits: readonly PeekHit[]): Group[] {
  const groups = new Map<string, Group>()
  hits.forEach((hit, index) => {
    const group = groups.get(hit.path) ?? { path: hit.path, rows: [] }
    group.rows.push({ hit, index })
    groups.set(hit.path, group)
  })
  return [...groups.values()]
}

/** The read-only code on the left of the peek, with the hit's line marked and scrolled to the middle. */
class Snippet {
  private view: EditorView | null = null
  private token = 0
  private readonly language = new Compartment()

  constructor(private readonly host: HTMLElement, private readonly hooks: PeekHooks) {}

  async show(hit: PeekHit): Promise<void> {
    const token = ++this.token
    const text = await this.hooks.text(hit).catch(() => null)
    if (token !== this.token) return
    this.view?.destroy()
    this.view = null
    if (text === null) {
      this.host.replaceChildren(h('p', { class: 'nav-peek-empty' }, 'This file cannot be shown here.'))
      return
    }
    this.host.replaceChildren()
    const state = EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        baseTheme(this.hooks.dark()),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        this.language.of([]),
        EditorView.decorations.compute([], (current) => Decoration.set([hitLine.range(current.doc.line(Math.min(Math.max(hit.line, 1), current.doc.lines)).from)]))
      ]
    })
    const view = new EditorView({ state, parent: this.host })
    this.view = view
    requestAnimationFrame(() => {
      if (token !== this.token) return
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(Math.min(Math.max(hit.line, 1), view.state.doc.lines)).from, { y: 'center' }) })
    })
    const extension = await loadLanguage(hit.repoPath)
    if (token === this.token && extension) view.dispatch({ effects: this.language.reconfigure(extension) })
  }

  destroy(): void {
    this.token += 1
    this.view?.destroy()
    this.view = null
  }
}

/**
 * The inline peek: the code of the chosen result on the left, every result grouped by file on the right.
 * Arrows move, Enter opens, Esc closes. It never touches the file it sits in, so that file's edit state stays as it was.
 */
export function buildPeek(model: PeekModel, hooks: PeekHooks, width: number): InlineElement {
  let selected = 0
  const code = h('div', { class: 'nav-peek-code' })
  const list = h('div', { class: 'nav-peek-list', role: 'listbox', 'aria-label': 'Results' })
  const title = h('b', {})
  const snippet = new Snippet(code, hooks)
  const root = h('section', { class: 'nav-peek', role: 'region', 'aria-label': 'Peek', tabindex: '-1', style: `width:${width}px` },
    h('div', { class: 'nav-peek-head' },
      title, h('span', { class: 'nav-peek-note' }, model.note), h('span', { class: 'grow' }),
      h('button', { class: 'nav-peek-open', type: 'button', onClick: () => hooks.open(model.hits[selected]) }, 'Open ', h('span', { class: 'nav-peek-key' }, 'Enter')),
      h('button', { class: 'nav-peek-close', type: 'button', 'aria-label': 'Close peek', title: 'Close peek (Esc)', onClick: () => hooks.close() }, icon(ICONS.close))),
    h('div', { class: 'nav-peek-body' }, code, list))

  const renderList = (): void => {
    list.replaceChildren(...groupHits(model.hits).flatMap((group) => [
      h('div', { class: 'nav-peek-group', title: group.path }, h('bdi', {}, baseName(group.path), ' ', h('small', {}, dirName(group.path)))),
      ...group.rows.map(({ hit, index }) => h('button', {
        class: `nav-peek-row${index === selected ? ' sel' : ''}`, type: 'button', role: 'option', 'aria-selected': String(index === selected), 'data-index': String(index), tabindex: '-1',
        onClick: () => select(index), onDblclick: () => hooks.open(hit)
      }, h('u', {}, String(hit.line)), h('span', {}, hit.preview)))
    ]))
  }
  const select = (index: number): void => {
    selected = (index + model.hits.length) % model.hits.length
    title.textContent = baseName(model.hits[selected].path)
    renderList()
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' })
    void snippet.show(model.hits[selected])
  }

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hooks.close()
    else if (event.key === 'Enter' && !(event.target as HTMLElement).closest('.nav-peek-close')) hooks.open(model.hits[selected])
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') select(selected + (event.key === 'ArrowDown' ? 1 : -1))
    else return
    event.preventDefault()
    event.stopPropagation()
  })
  select(0)
  requestAnimationFrame(() => root.focus({ preventScroll: true }))
  return Object.assign(root, { dispose: () => snippet.destroy() })
}

/** The short message under a line: nothing found, or defined outside the project. */
export function buildBubble(text: string, symbol: string, action: { label: string; run(): void } | null): InlineElement {
  const at = text.indexOf(symbol)
  const message = at < 0 ? [text] : [text.slice(0, at), h('b', {}, symbol), text.slice(at + symbol.length)]
  return h('div', { class: 'nav-bubble', role: 'status' }, h('span', {}, ...message), action ? h('button', { class: 'nav-peek-open', type: 'button', onClick: () => action.run() }, action.label) : null)
}
