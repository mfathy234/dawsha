import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

export interface Identifier {
  name: string
  from: number
  to: number
}

const IDENTIFIER_NODE = /(?:Name|Definition|Identifier)$/
const LITERAL_NODE = /Comment|String|Template|Regexp/i
const NAME = /^[A-Za-z_$][\w$]*$/
const WORD_CHAR = /[\w$]/

function fromTree(state: EditorState, pos: number): Identifier | 'literal' | null {
  const tree = syntaxTree(state)
  for (const side of [1, -1] as const) {
    const node = tree.resolveInner(pos, side)
    if (LITERAL_NODE.test(node.name)) return 'literal'
    if (!IDENTIFIER_NODE.test(node.name) || node.firstChild) continue
    const name = state.sliceDoc(node.from, node.to)
    if (NAME.test(name)) return { name, from: node.from, to: node.to }
  }
  return null
}

function fromWord(state: EditorState, pos: number): Identifier | null {
  const line = state.doc.lineAt(pos)
  let start = pos - line.from
  let end = start
  while (start > 0 && WORD_CHAR.test(line.text[start - 1])) start -= 1
  while (end < line.text.length && WORD_CHAR.test(line.text[end])) end += 1
  const name = line.text.slice(start, end)
  return NAME.test(name) ? { name, from: line.from + start, to: line.from + end } : null
}

/** The name at a document position: from the syntax tree, or a word match where the language has no tree (legacy C# mode). Null in comments and strings. */
export function identifierAt(state: EditorState, pos: number): Identifier | null {
  const clamped = Math.min(Math.max(pos, 0), state.doc.length)
  const found = fromTree(state, clamped)
  if (found === 'literal') return null
  return found ?? fromWord(state, clamped)
}
