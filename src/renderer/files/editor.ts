import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { unifiedMergeView } from '@codemirror/merge'
import { tags as t } from '@lezer/highlight'
import { loadLanguage } from './languages'

export type EditorTheme = 'dark' | 'light'

export interface EditorOptions {
  text: string
  path: string
  readOnly: boolean
  theme: EditorTheme
}

export interface FileEditor {
  view: EditorView
  setText(text: string): void
  getText(): string
  setReadOnly(readOnly: boolean): void
  showChanges(baseText: string | null): void
  showFile(): void
  onDirty(cb: () => void): void
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
      '.cm-deletedChunk': { backgroundColor: 'color-mix(in srgb, #e5484d 12%, transparent)', paddingLeft: '8px' },
      '.cm-insertedLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
      '.cm-deletedLine': { backgroundColor: 'color-mix(in srgb, #e5484d 12%, transparent)' },
      '.cm-changedText': { backgroundColor: 'color-mix(in srgb, var(--accent) 24%, transparent)' }
    },
    { dark }
  )
}

// readOnly + editable keeps selection, Ctrl+A/C and the native context menu working while blocking edits
const accessFor = (readOnly: boolean): Extension => [EditorState.readOnly.of(readOnly), EditorView.editable.of(true)]

export function createEditor(host: HTMLElement, options: EditorOptions): FileEditor {
  const language = new Compartment()
  const access = new Compartment()
  const merge = new Compartment()
  const dirtyListeners: Array<() => void> = []
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
        baseTheme(options.theme === 'dark'),
        language.of([]),
        access.of(accessFor(readOnly)),
        merge.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !suppress) for (const cb of dirtyListeners) cb()
        })
      ]
    })
  })

  void loadLanguage(options.path).then((ext) => {
    if (ext && !destroyed) view.dispatch({ effects: language.reconfigure(ext) })
  })

  return {
    view,
    setText(text) {
      suppress = true
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
      } finally {
        suppress = false
      }
    },
    getText: () => view.state.doc.toString(),
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
    focus: () => view.focus(),
    destroy() {
      destroyed = true
      view.destroy()
    }
  }
}
