import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

export interface OutlineItem {
  name: string
  kind: 'class' | 'function' | 'heading' | 'type' | 'const'
  from: number
  line: number
  depth: number
}

const KINDS: Record<string, OutlineItem['kind']> = {
  ClassDeclaration: 'class',
  ClassDefinition: 'class',
  FunctionDeclaration: 'function',
  FunctionDefinition: 'function',
  MethodDeclaration: 'function',
  InterfaceDeclaration: 'type',
  TypeAliasDeclaration: 'type',
  EnumDeclaration: 'type',
  LexicalDeclaration: 'const',
  VariableDeclaration: 'const'
}

const NAME_NODES = new Set(['VariableDefinition', 'VariableName', 'TypeDefinition', 'DefinitionName', 'PropertyDefinition'])
const WRAPPERS = new Set(['ExportDeclaration', 'DecoratedStatement'])
const MAX_ITEMS = 200

function nameOf(state: EditorState, node: SyntaxNode): string | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (NAME_NODES.has(child.name)) return state.sliceDoc(child.from, child.to)
    if (child.name === 'VariableDeclarator' || child.name === 'Definition') return nameOf(state, child)
  }
  return null
}

function constIsFunction(state: EditorState, node: SyntaxNode): boolean {
  const text = state.sliceDoc(node.from, Math.min(node.to, node.from + 400))
  return /=\s*(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*(:[^=]+)?=>|=\s*(async\s+)?function\b/.test(text)
}

function collect(state: EditorState, parent: SyntaxNode, depth: number, out: OutlineItem[]): void {
  for (let node = parent.firstChild; node && out.length < MAX_ITEMS; node = node.nextSibling) {
    if (WRAPPERS.has(node.name)) {
      collect(state, node, depth, out)
      continue
    }
    const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name)
    if (heading) {
      const name = state.sliceDoc(node.from, node.to).replace(/^#+\s*/, '').replace(/\s*#+\s*$/, '').split('\n')[0].trim()
      if (name) out.push({ name, kind: 'heading', from: node.from, line: state.doc.lineAt(node.from).number, depth: Number(heading[1]) - 1 })
      continue
    }
    const kind = KINDS[node.name]
    if (!kind) continue
    if (kind === 'const' && !constIsFunction(state, node)) continue
    const name = nameOf(state, node)
    if (!name) continue
    out.push({ name, kind: kind === 'const' ? 'function' : kind, from: node.from, line: state.doc.lineAt(node.from).number, depth })
    if (kind === 'class') {
      const body = node.getChild('ClassBody') ?? node.getChild('Body')
      if (body) collect(state, body, depth + 1, out)
    }
  }
}

export interface OutlineResult {
  items: OutlineItem[]
  /** False when the file is too big to parse within the quick budget: the items cover the part parsed so far. */
  complete: boolean
}

const QUICK_BUDGET_MS = 50

/** Top-level classes, functions, types and (for Markdown) headings, with a class's methods nested one level. */
export function outlineResult(state: EditorState): OutlineResult {
  const quick = ensureSyntaxTree(state, state.doc.length, QUICK_BUDGET_MS)
  const tree = quick ?? syntaxTree(state)
  const items: OutlineItem[] = []
  collect(state, tree.topNode, 0, items)
  return { items, complete: quick !== null }
}

export const outlineOf = (state: EditorState): OutlineItem[] => outlineResult(state).items
