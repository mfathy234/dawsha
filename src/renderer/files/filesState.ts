import { FILES_TABS_MAX } from '../../shared/settingsSchema'
import type { TreeNode } from '../../shared/fileTree'

export { FILES_TABS_MAX }

export interface TabRef {
  path: string
  pinned: boolean
}

export interface OpenResult {
  tabs: TabRef[]
  active: string
  /** Set when an old tab had to be closed to stay within the cap. */
  evicted: string | null
}

/**
 * Opens a file in the tab strip. A single click opens a preview tab that the next preview replaces; pinning (double
 * click, or an edit) keeps it. Past the cap the oldest pinned tab that is not active and not protected closes;
 * returns null when every tab is protected (unsaved) so nothing is lost.
 */
export function openTab(tabs: readonly TabRef[], path: string, pin: boolean, active: string | null, protectedPaths: ReadonlySet<string>): OpenResult | null {
  const known = tabs.find((tab) => tab.path === path)
  if (known) return { tabs: tabs.map((tab) => (tab.path === path && pin ? { ...tab, pinned: true } : tab)), active: path, evicted: null }
  let next: TabRef[] = [...tabs]
  const preview = next.findIndex((tab) => !tab.pinned && !protectedPaths.has(tab.path))
  if (!pin && preview >= 0) {
    next[preview] = { path, pinned: false }
    return { tabs: next, active: path, evicted: null }
  }
  next = [...next, { path, pinned: pin }]
  if (next.length <= FILES_TABS_MAX) return { tabs: next, active: path, evicted: null }
  const victim = next.find((tab) => tab.path !== path && tab.path !== active && !protectedPaths.has(tab.path))
  if (!victim) return null
  return { tabs: next.filter((tab) => tab.path !== victim.path), active: path, evicted: victim.path }
}

export function pinTab(tabs: readonly TabRef[], path: string): TabRef[] {
  return tabs.map((tab) => (tab.path === path ? { ...tab, pinned: true } : tab))
}

/** Removes a tab; the neighbour to its right becomes active, or the one to its left. */
export function closeTab(tabs: readonly TabRef[], active: string | null, path: string): { tabs: TabRef[]; active: string | null } {
  const index = tabs.findIndex((tab) => tab.path === path)
  if (index < 0) return { tabs: [...tabs], active }
  const next = tabs.filter((tab) => tab.path !== path)
  if (active !== path) return { tabs: next, active }
  return { tabs: next, active: next[index]?.path ?? next[index - 1]?.path ?? null }
}

export interface TreeRow {
  node: TreeNode
  depth: number
}

/** The rows a tree shows, folders first, descending only into open folders. */
export function flattenTree(nodes: readonly TreeNode[], isOpen: (path: string) => boolean, depth = 0, out: TreeRow[] = []): TreeRow[] {
  for (const node of nodes) {
    out.push({ node, depth })
    if (node.kind === 'folder' && isOpen(node.path)) flattenTree(node.children, isOpen, depth + 1, out)
  }
  return out
}

export type TreeKeyResult =
  | { kind: 'move'; index: number }
  | { kind: 'toggle'; path: string; open: boolean }
  | { kind: 'open'; path: string }
  | null

/** What a key does on the tree: move the cursor, fold or unfold a folder, or open a file. */
export function treeKey(rows: readonly TreeRow[], index: number, key: string, isOpen: (path: string) => boolean): TreeKeyResult {
  if (rows.length === 0) return null
  const at = Math.min(Math.max(index, 0), rows.length - 1)
  const row = rows[at]
  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', index: Math.min(at + 1, rows.length - 1) }
    case 'ArrowUp':
      return { kind: 'move', index: Math.max(at - 1, 0) }
    case 'Home':
      return { kind: 'move', index: 0 }
    case 'End':
      return { kind: 'move', index: rows.length - 1 }
    case 'ArrowRight':
      if (row.node.kind === 'file') return null
      return isOpen(row.node.path) ? { kind: 'move', index: Math.min(at + 1, rows.length - 1) } : { kind: 'toggle', path: row.node.path, open: true }
    case 'ArrowLeft': {
      if (row.node.kind === 'folder' && isOpen(row.node.path)) return { kind: 'toggle', path: row.node.path, open: false }
      for (let i = at - 1; i >= 0; i -= 1) if (rows[i].depth < row.depth) return { kind: 'move', index: i }
      return null
    }
    case 'Enter':
    case ' ':
      return row.node.kind === 'file' ? { kind: 'open', path: row.node.path } : { kind: 'toggle', path: row.node.path, open: !isOpen(row.node.path) }
    default:
      return null
  }
}

/** Folders that hold the given file paths, so a tree can be opened down to them. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}
