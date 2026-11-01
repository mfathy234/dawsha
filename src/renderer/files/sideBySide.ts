import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { baseTheme, type EditorTheme } from './editor'
import { loadLanguage } from './languages'

export interface SideBySideOptions {
  base: string
  text: string
  path: string
  theme: EditorTheme
}

const UNCHANGED_MARGIN = 3
const UNCHANGED_MIN = 6

const fillHeight = EditorView.theme({ '&': { height: 'auto' }, '.cm-scroller': { overflow: 'visible' } })

const sideExtensions = (theme: EditorTheme, language: Compartment): Extension[] => [
  lineNumbers(), baseTheme(theme === 'dark'), fillHeight, language.of([]), EditorState.readOnly.of(true), EditorView.editable.of(false)
]

/** The file next to the version on main, in two panes that scroll together. Read only: stage, revert and comments live in the one-column view. */
export class SideBySide {
  private readonly view: MergeView
  private destroyed = false

  constructor(host: HTMLElement, options: SideBySideOptions) {
    const language = new Compartment()
    this.view = new MergeView({
      a: { doc: options.base, extensions: sideExtensions(options.theme, language) },
      b: { doc: options.text, extensions: sideExtensions(options.theme, language) },
      parent: host,
      highlightChanges: true,
      gutter: false,
      collapseUnchanged: { margin: UNCHANGED_MARGIN, minSize: UNCHANGED_MIN }
    })
    this.view.dom.classList.add('side-by-side')
    void loadLanguage(options.path).then((extension) => {
      if (this.destroyed || !extension) return
      for (const side of [this.view.a, this.view.b]) side.dispatch({ effects: language.reconfigure(extension) })
    })
  }

  get el(): HTMLElement {
    return this.view.dom
  }

  destroy(): void {
    this.destroyed = true
    this.view.destroy()
  }
}
