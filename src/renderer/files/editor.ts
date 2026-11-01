import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, codeFolding, ensureSyntaxTree, foldGutter, foldKeymap, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { getChunks, unifiedMergeView } from '@codemirror/merge'
import { nextDiagnostic, previousDiagnostic } from '@codemirror/lint'
import { EDITOR_COLORS } from '../../shared/syntaxPalette'
import { highlightStyleFor } from './syntaxTheme'
import { loadLanguage } from './languages'
import { languageKey } from './languageInfo'
import { outlineResult, type OutlineItem } from './outline'
import { csharpOutline } from './csharpOutline'
import { flashLine, navExtensions, setInline, type InlineSpec } from './editorNav'
import { problemExtensions, showProblems } from './editorProblems'
import { indentGuides } from './indentGuides'
import { nextChangeStart } from './changeStep'
import { hoverInfo, type HoverProvider } from './hoverTip'
import { stickyScroll } from './stickyScroll'
import type { IndentSettings } from './indentRules'
import type { ProblemMark } from './problemMarks'
import { identifierAt, type Identifier } from './symbolAt'
import { eolFor, resetEol, textForSave } from './editorText'

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
  /** The name at a document position, or null in comments, strings and blank spots. */
  identifierAt(pos: number): Identifier | null
  /** The caret's document position. */
  cursorPos(): number
  /** The document position of a 1-based line and column, clamped into the file. */
  posAt(line: number, column: number): number
  /** Puts the caret at a position, scrolls it into view (centred) and focuses the editor. */
  jumpTo(pos: number, options?: { focus?: boolean }): void
  /** Shows a block under a line: the peek or a short message. Replaces what was shown before. */
  showInline(line: number, build: InlineSpec['build']): void
  clearInline(): void
  /** The line, 1-based, that the inline block sits under. */
  inlineLine(): number | null
  flash(line: number): void
  setProblems(marks: readonly ProblemMark[]): void
  setIndent(settings: IndentSettings | null): void
  /** Ctrl+click (Cmd+click) on a name. */
  onGoto(cb: (pos: number) => void): void
  /** What resting the pointer on a name shows; null turns hover off. */
  setHover(provider: HoverProvider | null): void
  /** Moves to the next (1) or previous (-1) change in the Changes view. False when there is none that way. `fromEdge` starts from the file's start (or end) instead of the caret. */
  stepChange(direction: 1 | -1, fromEdge?: boolean): boolean
  /** Moves to the next or previous problem underline. False when the file has none. */
  stepProblem(direction: 1 | -1): boolean
  /** The selected text, or an empty string. */
  selectedText(): string
}

export const CODE_FONT = "'Cascadia Code', 'JetBrains Mono', var(--font-mono)"

// The editor looks like VS Code: Dark+ on a dark theme, Light+ on a light one, whatever the app's accent is.
export function baseTheme(dark: boolean): Extension {
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

// Ctrl+G is Go to Line in Files, so the search keymap loses its find-next binding (F3 still finds next).
const searchKeys = searchKeymap.filter((binding) => binding.key !== 'Mod-g' && binding.key !== 'Mod-Alt-g')

const OUTLINE_RETRY_MS = 20
const OUTLINE_GIVE_UP_MS = 15_000
const OUTLINE_SLICE_MS = 40
const FLASH_MS = 900

// readOnly + editable keeps selection, Ctrl+A/C and the native context menu working while blocking edits
const accessFor = (readOnly: boolean): Extension => [EditorState.readOnly.of(readOnly), EditorView.editable.of(true)]

export function createEditor(host: HTMLElement, options: EditorOptions): FileEditor {
  const language = new Compartment()
  const theme = new Compartment()
  const eol = new Compartment()
  const access = new Compartment()
  const merge = new Compartment()
  const annotations = new Compartment()
  const indent = new Compartment()
  const gotoListeners: Array<(pos: number) => void> = []
  let hoverProvider: HoverProvider | null = null
  let outlineOf: () => OutlineItem[] = () => []
  const csharp = languageKey(options.path) === 'csharp'
  let outlineTimer: number | undefined
  let inlineSpec: InlineSpec | null = null
  let inlineCount = 0
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
        foldGutter(),
        codeFolding(),
        indentGuides(),
        navExtensions((pos) => {
          for (const cb of gotoListeners) cb(pos)
        }),
        problemExtensions,
        hoverInfo(() => hoverProvider),
        stickyScroll(() => outlineOf()),
        EditorState.allowMultipleSelections.of(true),
        history(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeys, ...foldKeymap, indentWithTab]),
        theme.of(baseTheme(options.theme === 'dark')),
        eol.of(eolFor(options.text)),
        language.of([]),
        access.of(accessFor(readOnly)),
        merge.of([]),
        annotations.of([]),
        indent.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) inlineSpec = null
          if (update.docChanged && !suppress) for (const cb of dirtyListeners) cb()
          if (update.selectionSet || update.docChanged) for (const cb of cursorListeners) cb(cursorOf(update.state))
        })
      ]
    })
  })

  // A big file does not parse within the quick budget: keep parsing in slices and tell the outline when the tree is whole.
  const finishParse = (startedAt: number): void => {
    window.clearTimeout(outlineTimer)
    outlineTimer = window.setTimeout(() => {
      outlineTimer = undefined
      if (destroyed) return
      if (ensureSyntaxTree(view.state, view.state.doc.length, OUTLINE_SLICE_MS)) {
        for (const cb of languageListeners) cb()
      } else if (Date.now() - startedAt < OUTLINE_GIVE_UP_MS) finishParse(startedAt)
    }, OUTLINE_RETRY_MS)
  }
  const currentOutline = (): OutlineItem[] => {
    if (csharp) return csharpOutline(view.state.sliceDoc())
    const result = outlineResult(view.state)
    if (!result.complete && outlineTimer === undefined) finishParse(Date.now())
    return result.items
  }

  outlineOf = currentOutline

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
        const nextDoc = view.state.toText(text)
        const next = nextDoc.toString()
        const current = view.state.doc.toString()
        let start = 0
        const shortest = Math.min(current.length, next.length)
        while (start < shortest && current.charCodeAt(start) === next.charCodeAt(start)) start += 1
        let tail = 0
        while (tail < shortest - start && current.charCodeAt(current.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)) tail += 1
        view.dispatch({
          changes: { from: start, to: current.length - tail, insert: nextDoc.slice(start, next.length - tail) },
          effects: resetEol(text)
        })
      } finally {
        suppress = false
      }
    },
    getText: () => textForSave(view.state),
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
          merge.reconfigure(unifiedMergeView({ original: baseText ?? '', mergeControls: false, highlightChanges: true, gutter: true, syntaxHighlightDeletions: true })),
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
    outline: currentOutline,
    reveal(pos) {
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }) })
      view.focus()
    },
    focus: () => view.focus(),
    identifierAt: (pos) => identifierAt(view.state, pos),
    cursorPos: () => view.state.selection.main.head,
    posAt(line, column) {
      const info = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines))
      return info.from + Math.min(Math.max(column - 1, 0), info.length)
    },
    jumpTo(pos, jump = {}) {
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
      if (jump.focus !== false) view.focus()
    },
    showInline(line, build) {
      inlineCount += 1
      inlineSpec = { id: inlineCount, line, build }
      view.dispatch({ effects: setInline.of(inlineSpec) })
    },
    clearInline() {
      if (!inlineSpec) return
      inlineSpec = null
      view.dispatch({ effects: setInline.of(null) })
    },
    inlineLine: () => inlineSpec?.line ?? null,
    flash(line) {
      view.dispatch({ effects: flashLine.of(line) })
      window.setTimeout(() => {
        if (!destroyed) view.dispatch({ effects: flashLine.of(null) })
      }, FLASH_MS)
    },
    setProblems: (marks) => showProblems(view, marks),
    setIndent(settings) {
      view.dispatch({ effects: indent.reconfigure(settings ? [indentUnit.of(settings.unit), EditorState.tabSize.of(settings.tabSize)] : []) })
    },
    onGoto(cb) {
      gotoListeners.push(cb)
    },
    setHover(provider) {
      hoverProvider = provider
    },
    stepChange(direction, fromEdge = false) {
      const starts = (getChunks(view.state)?.chunks ?? []).map((chunk) => chunk.fromB)
      const here = fromEdge ? (direction === 1 ? -1 : Number.POSITIVE_INFINITY) : view.state.doc.lineAt(view.state.selection.main.head).from
      const target = nextChangeStart(starts, here, direction)
      if (target === null) return false
      view.dispatch({ selection: { anchor: target }, effects: EditorView.scrollIntoView(target, { y: 'center' }), userEvent: 'select.byChunk' })
      return true
    },
    stepProblem: (direction) => (direction === 1 ? nextDiagnostic(view) : previousDiagnostic(view)),
    selectedText() {
      const { from, to } = view.state.selection.main
      return view.state.sliceDoc(from, to)
    },
    destroy() {
      destroyed = true
      window.clearTimeout(outlineTimer)
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
