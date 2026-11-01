import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { markRange, type ProblemMark } from './problemMarks'

const SOURCE_NOTE = ' From your last run.'

class ProblemText extends WidgetType {
  constructor(private readonly text: string) {
    super()
  }

  override eq(other: ProblemText): boolean {
    return other.text === this.text
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-problem-text'
    span.textContent = this.text
    return span
  }
}

const setProblemText = StateEffect.define<DecorationSet>()

const problemText = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setProblemText)) return effect.value
    return transaction.docChanged ? value.map(transaction.changes) : value
  },
  provide: (field) => EditorView.decorations.from(field)
})

export const problemExtensions: Extension = problemText

function diagnosticsOf(state: EditorState, marks: readonly ProblemMark[]): Diagnostic[] {
  return marks.flatMap((mark) => {
    const range = markRange(state.doc, mark.line, mark.column)
    return range ? [{ ...range, severity: mark.severity, message: mark.message, source: mark.source }] : []
  })
}

function textDecorations(state: EditorState, marks: readonly ProblemMark[]): DecorationSet {
  const seen = new Set<number>()
  const ranges = marks
    .filter((mark) => mark.severity === 'error' && mark.line >= 1 && mark.line <= state.doc.lines && !seen.has(mark.line) && seen.add(mark.line))
    .map((mark) => Decoration.widget({ widget: new ProblemText(`${mark.message}${SOURCE_NOTE}`), side: 1 }).range(state.doc.line(mark.line).to))
  return Decoration.set(ranges, true)
}

/** Underlines the problems a run reported for this file and writes the first error of each line after the code. */
export function showProblems(view: EditorView, marks: readonly ProblemMark[]): void {
  const lint = setDiagnostics(view.state, diagnosticsOf(view.state, marks))
  const effects = ([] as Array<StateEffect<unknown>>).concat(lint.effects ?? [], setProblemText.of(textDecorations(view.state, marks)))
  view.dispatch({ effects })
}
