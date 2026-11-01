import { foldService } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

const MAX_SCAN = 200_000

/** Where a block opened at the end of `lineFrom`'s line (or by a lone `{` on the next line) closes. */
function blockAfter(state: EditorState, lineFrom: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineFrom)
  let open = line.text.trimEnd().endsWith('{') ? line.from + line.text.trimEnd().length - 1 : -1
  if (open < 0 && line.number < state.doc.lines) {
    const next = state.doc.line(line.number + 1)
    if (next.text.trim() === '{') open = next.from + next.text.indexOf('{')
  }
  if (open < 0) return null
  const end = Math.min(state.doc.length, open + MAX_SCAN)
  const text = state.sliceDoc(open, end)
  let depth = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return open + index > line.to ? { from: line.to, to: open + index } : null
    }
  }
  return null
}

/** Folding for languages without a syntax tree (the legacy C# mode): a `{ ... }` block folds from the end of its first line. */
export const braceFolding = foldService.of((state, lineStart) => blockAfter(state, lineStart))
