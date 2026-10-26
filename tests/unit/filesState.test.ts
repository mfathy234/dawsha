import { describe, expect, it } from 'vitest'
import { buildTree } from '../../src/shared/fileTree'
import { ancestorsOf, closeTab, flattenTree, openTab, pinTab, treeKey, type TabRef } from '../../src/renderer/files/filesState'

const none = new Set<string>()
const tab = (path: string, pinned = true): TabRef => ({ path, pinned })

describe('openTab', () => {
  it('replaces the preview tab with the next preview and keeps pinned tabs', () => {
    const first = openTab([], 'a.ts', false, null, none)
    expect(first).toEqual({ tabs: [tab('a.ts', false)], active: 'a.ts', evicted: null })
    const second = openTab(first!.tabs, 'b.ts', false, 'a.ts', none)
    expect(second!.tabs).toEqual([tab('b.ts', false)])
    const pinned = openTab(second!.tabs, 'b.ts', true, 'b.ts', none)
    expect(pinned!.tabs).toEqual([tab('b.ts')])
    expect(openTab(pinned!.tabs, 'c.ts', false, 'b.ts', none)!.tabs).toEqual([tab('b.ts'), tab('c.ts', false)])
  })

  it('does not replace a preview tab with unsaved edits', () => {
    const result = openTab([tab('a.ts', false)], 'b.ts', false, 'a.ts', new Set(['a.ts']))
    expect(result!.tabs.map((t) => t.path)).toEqual(['a.ts', 'b.ts'])
  })

  it('closes the oldest idle pinned tab past 12, and refuses when all are unsaved', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => tab(`f${i}.ts`))
    const result = openTab(twelve, 'new.ts', true, 'f11.ts', none)!
    expect(result.evicted).toBe('f0.ts')
    expect(result.tabs).toHaveLength(12)
    expect(openTab(twelve, 'new.ts', true, 'f11.ts', new Set(twelve.map((t) => t.path)))).toBeNull()
  })

  it('pins a tab', () => {
    expect(pinTab([tab('a.ts', false)], 'a.ts')).toEqual([tab('a.ts')])
  })
})

describe('closeTab', () => {
  it('activates the right neighbour, then the left one', () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    expect(closeTab(tabs, 'b', 'b').active).toBe('c')
    expect(closeTab(tabs, 'c', 'c').active).toBe('b')
    expect(closeTab(tabs, 'a', 'b')).toEqual({ tabs: [tab('a'), tab('c')], active: 'a' })
    expect(closeTab([tab('a')], 'a', 'a')).toEqual({ tabs: [], active: null })
  })
})

describe('tree keys', () => {
  const tree = buildTree(['src/a.ts', 'src/ui/b.ts', 'README.md'], new Map())
  const open = new Set<string>(['src'])
  const isOpen = (path: string): boolean => open.has(path)
  const rows = flattenTree(tree, isOpen)

  it('shows only the open folders', () => {
    expect(rows.map((r) => r.node.path)).toEqual(['src', 'src/ui', 'src/a.ts', 'README.md'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0])
  })

  it('moves, folds and opens with the keyboard', () => {
    expect(treeKey(rows, 0, 'ArrowDown', isOpen)).toEqual({ kind: 'move', index: 1 })
    expect(treeKey(rows, 0, 'ArrowUp', isOpen)).toEqual({ kind: 'move', index: 0 })
    expect(treeKey(rows, 0, 'ArrowLeft', isOpen)).toEqual({ kind: 'toggle', path: 'src', open: false })
    expect(treeKey(rows, 1, 'ArrowRight', isOpen)).toEqual({ kind: 'toggle', path: 'src/ui', open: true })
    expect(treeKey(rows, 0, 'ArrowRight', isOpen)).toEqual({ kind: 'move', index: 1 })
    expect(treeKey(rows, 2, 'ArrowLeft', isOpen)).toEqual({ kind: 'move', index: 0 })
    expect(treeKey(rows, 2, 'Enter', isOpen)).toEqual({ kind: 'open', path: 'src/a.ts' })
    expect(treeKey(rows, 2, 'ArrowRight', isOpen)).toBeNull()
    expect(treeKey([], 0, 'ArrowDown', isOpen)).toBeNull()
  })
})

describe('ancestorsOf', () => {
  it('lists the folders above a file', () => {
    expect(ancestorsOf('a/b/c.ts')).toEqual(['a', 'a/b'])
    expect(ancestorsOf('c.ts')).toEqual([])
  })
})
