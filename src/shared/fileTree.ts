import { fuzzyMatch } from './palette'

export type TreeMode = 'all' | 'changed' | 'sessions'

export interface TreeNode {
  name: string
  path: string
  kind: 'folder' | 'file'
  status: string | null
  changed: number
  children: TreeNode[]
}

export const QUICK_OPEN_LIMIT = 50
const BASENAME_BOOST = 1000
const RECENT_BOOST = 300

interface Draft {
  name: string
  path: string
  file: boolean
  status: string | null
  children: Map<string, Draft>
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/')
}

function insert(root: Draft, path: string, status: Map<string, string>): void {
  const segments = normalize(path).split('/').filter(Boolean)
  let node = root
  let full = ''
  for (const [index, segment] of segments.entries()) {
    full = full ? `${full}/${segment}` : segment
    let child = node.children.get(segment)
    if (!child) {
      child = { name: segment, path: full, file: false, status: null, children: new Map() }
      node.children.set(segment, child)
    }
    if (index === segments.length - 1) {
      child.file = true
      child.status = status.get(full) ?? null
    }
    node = child
  }
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  const left = a.name.toLowerCase()
  const right = b.name.toLowerCase()
  return left < right ? -1 : left > right ? 1 : 0
}

function freeze(draft: Draft): TreeNode {
  const children = [...draft.children.values()].map(freeze).sort(compareNodes)
  const changed = draft.file
    ? draft.status === null ? 0 : 1
    : children.reduce((sum, child) => sum + child.changed, 0)
  return {
    name: draft.name,
    path: draft.path,
    kind: draft.file ? 'file' : 'folder',
    status: draft.status,
    changed,
    children
  }
}

export function buildTree(files: string[], status: Map<string, string>): TreeNode[] {
  const root: Draft = { name: '', path: '', file: false, status: null, children: new Map() }
  for (const file of files) insert(root, file, status)
  return freeze(root).children
}

function keeps(node: TreeNode, mode: TreeMode, sessionFiles: Set<string>, text: string): boolean {
  if (mode === 'changed' && node.status === null) return false
  if (mode === 'sessions' && !sessionFiles.has(node.path)) return false
  return text === '' || fuzzyMatch(text, node.path) !== null
}

function filterNode(node: TreeNode, mode: TreeMode, sessionFiles: Set<string>, text: string): TreeNode | null {
  if (node.kind === 'file') return keeps(node, mode, sessionFiles, text) ? node : null
  const children = node.children.flatMap((child) => {
    const kept = filterNode(child, mode, sessionFiles, text)
    return kept ? [kept] : []
  })
  return children.length === 0 ? null : { ...node, children }
}

export function filterTree(nodes: TreeNode[], mode: TreeMode, sessionFiles: Set<string>, text: string): TreeNode[] {
  const query = text.trim()
  if (mode === 'all' && query === '') return nodes
  return nodes.flatMap((node) => {
    const kept = filterNode(node, mode, sessionFiles, query)
    return kept ? [kept] : []
  })
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function recentBoost(file: string, recents: Map<string, number>): number {
  const index = recents.get(file)
  return index === undefined ? 0 : Math.max(0, RECENT_BOOST - index)
}

function rank(file: string, query: string, recents: Map<string, number>): number | null {
  const byName = fuzzyMatch(query, basename(file))
  if (byName) return byName.score + BASENAME_BOOST + recentBoost(file, recents)
  const byPath = fuzzyMatch(query, file)
  return byPath ? byPath.score + recentBoost(file, recents) : null
}

export function quickOpen(files: string[], query: string, recent: string[]): string[] {
  const recents = new Map<string, number>()
  recent.forEach((file, index) => {
    if (!recents.has(file)) recents.set(file, index)
  })
  const scored = [...new Set(files)].flatMap((file) => {
    const score = rank(file, query.trim(), recents)
    return score === null ? [] : [{ file, score }]
  })
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, QUICK_OPEN_LIMIT)
    .map((entry) => entry.file)
}
