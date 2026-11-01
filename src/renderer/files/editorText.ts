import { StateEffect, StateField, type ChangeDesc, type EditorState, type Extension } from '@codemirror/state'
import { invertedEffects } from '@codemirror/commands'

interface LineEnding {
  readonly pos: number
  readonly text: string
}

interface LineEndings {
  readonly breaks: readonly LineEnding[]
  readonly fallback: string
}

function endingsFor(text: string): LineEndings {
  const breaks: LineEnding[] = []
  let extra = 0
  for (const match of text.matchAll(/\r\n|\r|\n/g)) {
    breaks.push({ pos: match.index - extra, text: match[0] })
    extra += match[0].length - 1
  }
  return { breaks, fallback: breaks[0]?.text ?? '\n' }
}

// Iterate unchanged spans once so a multi-cursor or replace-all edit stays linear.
function survivingEndings(value: LineEndings, changes: ChangeDesc): LineEnding[] {
  const breaks: LineEnding[] = []
  let index = 0
  changes.iterGaps((fromA, fromB, length) => {
    while (index < value.breaks.length && value.breaks[index].pos < fromA) index += 1
    while (index < value.breaks.length && value.breaks[index].pos < fromA + length) {
      const ending = value.breaks[index++]
      breaks.push({ pos: ending.pos + fromB - fromA, text: ending.text })
    }
  })
  return breaks
}

const restoreEndings = StateEffect.define<LineEndings>({
  map: (value, changes) => ({ ...value, breaks: survivingEndings(value, changes) })
})

const lineEndings = StateField.define<LineEndings>({
  create: () => ({ breaks: [], fallback: '\n' }),
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(restoreEndings)) return effect.value
    if (!transaction.docChanged) return value
    const breaks = survivingEndings(value, transaction.changes)
    transaction.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
      let pos = fromB
      for (let line = 1; line < inserted.lines; line += 1) {
        pos += inserted.line(line).length
        breaks.push({ pos, text: value.fallback })
        pos += 1
      }
    })
    breaks.sort((left, right) => left.pos - right.pos)
    return { ...value, breaks }
  }
})

/** CodeMirror splits every newline style; a separate field retains each break's disk bytes. */
export const eolFor = (text: string): Extension => [
  lineEndings.init(() => endingsFor(text)),
  invertedEffects.of(transaction => transaction.docChanged || transaction.effects.some(effect => effect.is(restoreEndings))
    ? [restoreEndings.of(transaction.startState.field(lineEndings))]
    : [])
]

/** Loading disk text also resets endings when its logical content has not changed. */
export const resetEol = (text: string): StateEffect<LineEndings> => restoreEndings.of(endingsFor(text))

export function textForSave(state: EditorState): string {
  const { breaks, fallback } = state.field(lineEndings)
  let index = 0
  return state.doc.toString().replace(/\n/g, (_match, pos: number) => {
    const ending = breaks[index]
    if (ending?.pos === pos) {
      index += 1
      return ending.text
    }
    return fallback
  })
}
