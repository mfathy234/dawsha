import { describe, expect, it } from 'vitest'
import { buildTree, filterTree, quickOpen, type TreeNode } from '../../src/shared/fileTree'

const names = (nodes: TreeNode[]): string[] => nodes.map((node) => node.name)

const find = (nodes: TreeNode[], path: string): TreeNode | undefined => {
  for (const node of nodes) {
    if (node.path === path) return node
    const inside = find(node.children, path)
    if (inside) return inside
  }
  return undefined
}

const paths = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((node) => [node.path, ...paths(node.children)])

describe('buildTree', () => {
  it('puts folders before files and sorts case-insensitively', () => {
    const tree = buildTree(['readme.md', 'Zeta/a.ts', 'alpha.ts', 'beta/b.ts', 'Beta.ts'], new Map())
    expect(names(tree)).toEqual(['beta', 'Zeta', 'alpha.ts', 'Beta.ts', 'readme.md'])
    expect(names(find(tree, 'beta')!.children)).toEqual(['b.ts'])
  })

  it('nests files under their folders with full paths', () => {
    const tree = buildTree(['src/app/main.ts', 'src/app/util/x.ts'], new Map())
    const app = find(tree, 'src/app')!
    expect(app.kind).toBe('folder')
    expect(names(app.children)).toEqual(['util', 'main.ts'])
    expect(find(tree, 'src/app/util/x.ts')).toMatchObject({ kind: 'file', name: 'x.ts', status: null })
  })

  it('attaches git status letters to files and counts changed files in each folder', () => {
    const status = new Map([
      ['src/a.ts', 'M'],
      ['src/deep/b.ts', 'U'],
      ['src/deep/c.ts', 'D']
    ])
    const tree = buildTree(['src/a.ts', 'src/deep/b.ts', 'src/deep/c.ts', 'src/d.ts', 'top.md'], status)
    expect(find(tree, 'src/a.ts')).toMatchObject({ status: 'M', changed: 1 })
    expect(find(tree, 'src/d.ts')).toMatchObject({ status: null, changed: 0 })
    expect(find(tree, 'src/deep')).toMatchObject({ kind: 'folder', changed: 2 })
    expect(find(tree, 'src')).toMatchObject({ changed: 3 })
    expect(tree.find((node) => node.name === 'top.md')).toMatchObject({ changed: 0 })
  })

  it('normalizes backslashes and ignores empty segments', () => {
    const tree = buildTree(['src\\lib\\a.ts', 'src//lib/b.ts'], new Map([['src/lib/a.ts', 'A']]))
    expect(paths(tree)).toEqual(['src', 'src/lib', 'src/lib/a.ts', 'src/lib/b.ts'])
    expect(find(tree, 'src/lib/a.ts')).toMatchObject({ status: 'A' })
  })

  it('builds 20,000 paths', () => {
    const files = Array.from({ length: 20_000 }, (_, i) => `dir${i % 200}/sub${i % 37}/file${i}.ts`)
    const status = new Map(files.filter((_, i) => i % 10 === 0).map((file) => [file, 'M']))
    const tree = buildTree(files, status)
    expect(find(tree, 'dir0')?.changed).toBe(100)
  })

  it('adds paths that exist only in git status, such as staged deletions', () => {
    const tree = buildTree(['a.ts'], new Map([['gone.ts', 'D']]))
    expect(find(tree, 'gone.ts')).toMatchObject({ kind: 'file', status: 'D', changed: 1 })
    const nested = buildTree(['src/a.ts'], new Map([['src/gone.ts', 'D']]))
    expect(find(nested, 'src')).toMatchObject({ changed: 1 })
  })
})

describe('filterTree', () => {
  const files = [
    'src/app/main.ts',
    'src/app/util/format.ts',
    'src/lib/store.ts',
    'docs/guide.md',
    'README.md'
  ]
  const status = new Map([
    ['src/app/util/format.ts', 'M'],
    ['docs/guide.md', 'A']
  ])
  const tree = buildTree(files, status)
  const sessions = new Set(['src/lib/store.ts'])

  it('returns the tree unchanged for all mode with no text', () => {
    expect(filterTree(tree, 'all', sessions, '')).toEqual(tree)
  })

  it('keeps only changed files and their ancestors in changed mode', () => {
    const filtered = filterTree(tree, 'changed', sessions, '')
    expect(paths(filtered)).toEqual(['docs', 'docs/guide.md', 'src', 'src/app', 'src/app/util', 'src/app/util/format.ts'])
  })

  it('keeps only files open in sessions and their ancestors', () => {
    const filtered = filterTree(tree, 'sessions', sessions, '')
    expect(paths(filtered)).toEqual(['src', 'src/lib', 'src/lib/store.ts'])
  })

  it('keeps the ancestors of each text match', () => {
    const filtered = filterTree(tree, 'all', sessions, 'format')
    expect(paths(filtered)).toEqual(['src', 'src/app', 'src/app/util', 'src/app/util/format.ts'])
  })

  it('combines text with the mode', () => {
    expect(filterTree(tree, 'changed', sessions, 'store')).toEqual([])
    expect(filterTree(tree, 'sessions', sessions, 'store')).toEqual(filterTree(tree, 'all', sessions, 'store'))
  })

  it('keeps the full path in the text filter', () => {
    expect(paths(filterTree(tree, 'all', sessions, 'util'))).toContain('src/app/util/format.ts')
  })

  it('normalizes backslashes in session paths and the text filter', () => {
    const copy = buildTree(['sample/copy.ts', 'other.ts'], new Map())
    expect(paths(filterTree(copy, 'all', new Set(), 'Sample\\Copy'))).toEqual(['sample', 'sample/copy.ts'])
    expect(paths(filterTree(copy, 'sessions', new Set(['sample\\copy.ts']), ''))).toEqual(['sample', 'sample/copy.ts'])
  })

  it('keeps the folder badge counts of the unfiltered tree', () => {
    const filtered = filterTree(tree, 'changed', sessions, '')
    expect(find(filtered, 'src/app')).toMatchObject({ changed: 1 })
  })

  it('returns no nodes when nothing matches', () => {
    expect(filterTree(tree, 'all', sessions, 'zzzz-no-match')).toEqual([])
  })
})

describe('quickOpen', () => {
  const files = ['docs/notes/billing.md', 'src/billing/index.ts', 'src/utils/format.ts', 'src/a.ts', 'src/z.ts']

  it('ranks a basename match above a path-only match', () => {
    expect(quickOpen(files, 'billing', [])[0]).toBe('docs/notes/billing.md')
    expect(quickOpen(files, 'billing', [])).toContain('src/billing/index.ts')
  })

  it('returns only files that match the query', () => {
    expect(quickOpen(files, 'format', [])).toEqual(['src/utils/format.ts'])
  })

  it('boosts recent files above others with the same match', () => {
    expect(quickOpen(['src/a.ts', 'src/z.ts'], 'src', ['src/z.ts']))
      .toEqual(['src/z.ts', 'src/a.ts'])
  })

  it('ranks a substring basename match above a longer fuzzy one', () => {
    expect(quickOpen(['src/app/main.ts', 'apple-domain.ts'], 'appmain', [])).toEqual(['src/app/main.ts', 'apple-domain.ts'])
  })

  it('normalizes backslashes in the query', () => {
    expect(quickOpen(['sample/copy.ts', 'x.ts'], 'Sample\\Copy', [])).toEqual(['sample/copy.ts'])
  })

  // Empty query: every file scores 0, so only the recent boost reorders and equal scores keep input order.
  it('lists recent files first, in recency order, when the query is empty', () => {
    expect(quickOpen(files, '', ['src/z.ts', 'src/a.ts'])).toEqual(['src/z.ts', 'src/a.ts', ...files.filter((f) => f !== 'src/z.ts' && f !== 'src/a.ts')])
  })

  it('ignores recent entries that are not in the file list', () => {
    expect(quickOpen(files, '', ['gone.ts'])).toEqual(files)
  })

  it('returns at most 50 results', () => {
    const many = Array.from({ length: 120 }, (_, i) => `pkg/file${i}.ts`)
    expect(quickOpen(many, 'file', [])).toHaveLength(50)
  })

  it('ranks 20,000 files', () => {
    const many = Array.from({ length: 20_000 }, (_, i) => `dir${i % 200}/file${i}.ts`)
    const results = quickOpen(many, 'file19', ['dir199/file19999.ts'])
    expect(results[0]).toBe('dir199/file19999.ts')
    expect(results).toHaveLength(50)
  })
})
