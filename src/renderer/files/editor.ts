import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { getChunks, unifiedMergeView } from '@codemirror/merge'
import { EDITOR_COLORS } from '../../shared/syntaxPalette'
import { highlightStyleFor } from './syntaxTheme'
import { loadLanguage } from './languages'
import { outlineOf, type OutlineItem } from './outline'

export type EditorTheme = 'dark' | 'light'

export interface EditorOptions {
  text: string
  path: string
  readOnly: boolean
  theme: EditorTheme
}

export interface CursorInfo {
  line: number
  col: number
  startLine: number
  endLine: number
  selected: number
}

export interface FileEditor {
  view: EditorView
  setText(text: string): void
  getText(): string
  setReadOnly(readOnly: boolean): void
  setTheme(theme: EditorTheme): void
  showChanges(baseText: string | null): void
  showFile(): void
  /** Extra gutters and widgets (review comments, blame) for the Changes view. */
  annotate(extension: Extension): void
  /** Line numbers (1-based) the Changes view shows as added. */
  addedLines(): number[]
  /** The line, 1-based, that a document position is on. */
  lineAt(pos: number): number
  onDirty(cb: () => void): void
  onCursor(cb: (info: CursorInfo) => void): void
  onLanguage(cb: () => void): void
  cursor(): CursorInfo
  outline(): OutlineItem[]
  reveal(pos: number): void
  focus(): void
  destroy(): void
}

const CODE_FONT = "'Cascadia Code', 'JetBrains Mono', var(--font-mono)"

// The editor looks like VS Code: Dark+ on a dark theme, Light+ on a light one, whatever the app's accent is.
function baseTheme(dark: boolean): Extension {
  const colors = EDITOR_COLORS[dark ? 'dark' : 'light']
  return [
    EditorView.theme(
    {
      '&': { height: '100%', color: colors.foreground, backgroundColor: colors.background, fontSize: '13px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { fontFamily: CODE_FONT, lineHeight: '1.6', overflow: 'auto' },
      '.cm-content': { caretColor: colors.caret, padding: '8px 0', fontVariantLigatures: 'none', fontFeatureSettings: '"liga" 0, "calt" 0' },
      '.cm-line': { padding: '0 16px 0 8px' },
      '.cm-gutters': { backgroundColor: colors.background, color: colors.gutter, border: 'none' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 16px', minWidth: '3ch' },
      '.cm-activeLine': { backgroundColor: colors.activeLine },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: colors.gutterActive },
      '.cm-cursor': { borderLeftColor: colors.caret },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: colors.selection
      },
      '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)' },
      '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', outline: 'none' },
      '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: 'none' },
      '.cm-panels input, .cm-panels button': { fontFamily: 'inherit' },
      '&.cm-merge-b .cm-changedLine, &.cm-merge-b .cm-inlineChangedLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
      '.cm-deletedChunk': { backgroundColor: 'color-mix(in srgb, var(--danger) 12%, transparent)', paddingLeft: '8px' },
      '.cm-changeGutter': { width: '2px', paddingLeft: '0' },
      '&.cm-merge-b .cm-changedLineGutter': { background: 'var(--accent) !important' },
      '.cm-deletedLineGutter': { background: 'var(--danger) !important' }
    },
    { dark }
    ),
    syntaxHighlighting(highlightStyleFor(dark ? 'dark' : 'light'))
  ]
}

// text with CRLF keeps its line endings through the editor so a save does not rewrite them
const eolFor = (text: string): Extension => (text.includes('\r\n') ? EditorState.lineSeparator.of('\r\n') : [])

// readOnly + editable keeps selection, Ctrl+A/C and the native context menu working while blocking edits
const accessFor = (readOnly: boolean): Extension => [EditorState.readOnly.of(readOnly), EditorView.editable.of(true)]

export function createEditor(host: HTMLElement, options: EditorOptions): FileEditor {
  const language = new Compartment()
  const theme = new Compartment()
  const eol = new Compartment()
  const access = new Compartment()
  const merge = new Compartment()
  const annotations = new Compartment()
  const dirtyListeners: Array<() => void> = []
  const cursorListeners: Array<(info: CursorInfo) => void> = []
  const languageListeners: Array<() => void> = []
  const cursorOf = (state: EditorState): CursorInfo => {
    const main = state.selection.main
    const head = state.doc.lineAt(main.head)
    return {
      line: head.number,
      col: main.head - head.from + 1,
      startLine: state.doc.lineAt(main.from).number,
      endLine: state.doc.lineAt(main.empty ? main.to : main.to - 1).number,
      selected: main.to - main.from
    }
  }
  let readOnly = options.readOnly
  let showingChanges = false
  let destroyed = false
  let suppress = false

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: options.text,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        theme.of(baseTheme(options.theme === 'dark')),
        eol.of(eolFor(options.text)),
        language.of([]),
        access.of(accessFor(readOnly)),
        merge.of([]),
        annotations.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !suppress) for (const cb of dirtyListeners) cb()
          if (update.selectionSet || update.docChanged) for (const cb of cursorListeners) cb(cursorOf(update.state))
        })
      ]
    })
  })

  void loadLanguage(options.path).then((ext) => {
    if (!ext || destroyed) return
    view.dispatch({ effects: language.reconfigure(ext) })
    for (const cb of languageListeners) cb()
  })

  return {
    view,
    setText(text) {
      suppress = true
      try {
        view.dispatch({ effects: eol.reconfigure(eolFor(text)) })
        const current = view.state.sliceDoc()
        let start = 0
        const shortest = Math.min(current.length, text.length)
        while (start < shortest && current.charCodeAt(start) === text.charCodeAt(start)) start += 1
        let tail = 0
        while (tail < shortest - start && current.charCodeAt(current.length - 1 - tail) === text.charCodeAt(text.length - 1 - tail)) tail += 1
        view.dispatch({ changes: { from: start, to: current.length - tail, insert: text.slice(start, text.length - tail) } })
      } finally {
        suppress = false
      }
    },
    getText: () => view.state.sliceDoc(),
    setTheme(next) {
      view.dispatch({ effects: theme.reconfigure(baseTheme(next === 'dark')) })
    },
    setReadOnly(next) {
      readOnly = next
      view.dispatch({ effects: access.reconfigure(accessFor(readOnly || showingChanges)) })
    },
    showChanges(baseText) {
      showingChanges = true
      view.dom.classList.add('diff')
      view.dispatch({
        effects: [
          merge.reconfigure(unifiedMergeView({ original: baseText ?? '', mergeControls: false, highlightChanges: false, gutter: true, syntaxHighlightDeletions: true })),
          access.reconfigure(accessFor(true))
        ]
      })
    },
    showFile() {
      showingChanges = false
      view.dom.classList.remove('diff')
      view.dispatch({ effects: [merge.reconfigure([]), access.reconfigure(accessFor(readOnly))] })
    },
    annotate(extension) {
      view.dispatch({ effects: annotations.reconfigure(extension) })
    },
    addedLines() {
      return addedLinesOf(view.state)
    },
    lineAt: (pos) => view.state.doc.lineAt(pos).number,
    onDirty(cb) {
      dirtyListeners.push(cb)
    },
    onCursor(cb) {
      cursorListeners.push(cb)
    },
    onLanguage(cb) {
      languageListeners.push(cb)
    },
    cursor: () => cursorOf(view.state),
    outline: () => outlineOf(view.state),
    reveal(pos) {
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }) })
      view.focus()
    },
    focus: () => view.focus(),
    destroy() {
      destroyed = true
      view.destroy()
    }
  }
}

/** The lines the unified merge view marks as added: the new side of every chunk that has text. */
export function addedLinesOf(state: EditorState): number[] {
  const chunks = getChunks(state)?.chunks ?? []
  const lines: number[] = []
  for (const chunk of chunks) {
    if (chunk.toB <= chunk.fromB) continue
    const first = state.doc.lineAt(chunk.fromB).number
    const last = state.doc.lineAt(Math.max(chunk.fromB, chunk.toB - 1)).number
    for (let line = first; line <= last; line += 1) lines.push(line)
  }
  return lines
}
