import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { unifiedMergeView } from '@codemirror/merge'
import { tags as t } from '@lezer/highlight'
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
  onDirty(cb: () => void): void
  onCursor(cb: (info: CursorInfo) => void): void
  onLanguage(cb: () => void): void
  cursor(): CursorInfo
  outline(): OutlineItem[]
  reveal(pos: number): void
  focus(): void
  destroy(): void
}

const mix = (color: string, pct: number): string => `color-mix(in srgb, ${color} ${pct}%, var(--text))`

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--accent)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: mix('var(--accent)', 55) },
  { tag: [t.number, t.bool, t.null, t.atom], color: mix('var(--accent)', 70) },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--text)', fontWeight: '600' },
  { tag: [t.typeName, t.className, t.namespace], color: mix('var(--accent)', 40) },
  { tag: [t.propertyName, t.attributeName], color: mix('var(--muted)', 45) },
  { tag: [t.tagName, t.heading], color: 'var(--accent)', fontWeight: '600' },
  { tag: [t.punctuation, t.bracket, t.separator, t.operator], color: 'var(--muted)' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' }
])

function baseTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--bg)', fontSize: '13px' },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflow: 'auto' },
      '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
      '.cm-line': { padding: '0 16px 0 8px' },
      '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--muted)', border: 'none', opacity: '0.7' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 16px', minWidth: '3ch' },
      '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--raised) 55%, transparent)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
      '.cm-cursor': { borderLeftColor: 'var(--accent)' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)'
      },
      '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)' },
      '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', outline: 'none' },
      '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: 'none' },
      '.cm-panels input, .cm-panels button': { fontFamily: 'inherit' },
      '.cm-changedLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)' },
      '.cm-deletedChunk': { backgroundColor: 'color-mix(in srgb, var(--danger) 12%, transparent)', paddingLeft: '8px' },
      '.cm-insertedLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
      '.cm-deletedLine': { backgroundColor: 'color-mix(in srgb, var(--danger) 12%, transparent)' },
      '&.cm-merge-b .cm-changedText, &.cm-merge-a .cm-changedText': { background: 'color-mix(in srgb, var(--accent) 24%, transparent) !important' },
      '.cm-deletedChunk .cm-deletedText': { background: 'color-mix(in srgb, var(--danger) 26%, transparent) !important' }
    },
    { dark }
  )
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
        syntaxHighlighting(highlight),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        theme.of(baseTheme(options.theme === 'dark')),
        eol.of(eolFor(options.text)),
        language.of([]),
        access.of(accessFor(readOnly)),
        merge.of([]),
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
      view.dispatch({
        effects: [
          merge.reconfigure(unifiedMergeView({ original: baseText ?? '', mergeControls: false })),
          access.reconfigure(accessFor(true))
        ]
      })
    },
    showFile() {
      showingChanges = false
      view.dispatch({ effects: [merge.reconfigure([]), access.reconfigure(accessFor(readOnly))] })
    },
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
