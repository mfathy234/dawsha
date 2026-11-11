import { describe, expect, it } from 'vitest'
import {
  branchOptionLabel,
  candidateDetail,
  cleanupPlan,
  cleanupTitle,
  formatAge,
  formatSize,
  initialTicks,
  leftoverWorktrees,
  parseWorktreeList,
  removeLabel,
  shouldOfferCleanup,
  toggled,
  type CleanupCandidate
} from '../../src/shared/worktreeCleanup'

const candidate = (over: Partial<CleanupCandidate> = {}): CleanupCandidate => ({
  path: 'C:/work/api-preset-abc123',
  branch: 'preset/abc123',
  merged: true,
  sizeBytes: 214 * 1024 * 1024,
  sizeCapped: false,
  createdAt: 0,
  dirtyFiles: 0,
  ...over
})

const porcelain = (...entries: string[][]): string => entries.map((fields) => `${fields.join('\0')}\0`).join('\0')

describe('parseWorktreeList', () => {
  it('reads paths and branches, null for a detached head', () => {
    const text = porcelain(
      ['worktree C:/work/api', 'HEAD aaa', 'branch refs/heads/main'],
      ['worktree C:/work/api-preset-abc123', 'HEAD bbb', 'branch refs/heads/preset/abc123'],
      ['worktree C:/work/other', 'HEAD ccc', 'detached']
    )
    expect(parseWorktreeList(text)).toEqual([
      { path: 'C:/work/api', branch: 'main' },
      { path: 'C:/work/api-preset-abc123', branch: 'preset/abc123' },
      { path: 'C:/work/other', branch: null }
    ])
  })
})

describe('leftoverWorktrees', () => {
  const listed = parseWorktreeList(
    porcelain(
      ['worktree C:/work/api', 'branch refs/heads/main'],
      ['worktree C:/work/api-preset-abc123', 'branch refs/heads/preset/abc123'],
      ['worktree C:/work/api-compare-xyz789-a', 'branch refs/heads/compare/xyz789-a'],
      ['worktree C:/work/api-preset-open111', 'branch refs/heads/preset/open111'],
      ['worktree C:/work/my-own-tree', 'branch refs/heads/feature/x'],
      ['worktree C:/work/api-preset-wrong1', 'branch refs/heads/feature/y'],
      ['worktree C:/work/api-preset-detach', 'detached']
    )
  )

  it('keeps only Dawsha worktrees whose session is closed', () => {
    const open = ['c:\\work\\api-preset-open111\\']
    expect(leftoverWorktrees(listed, open).map((tree) => tree.path)).toEqual(['C:/work/api-preset-abc123', 'C:/work/api-compare-xyz789-a'])
  })

  it('never lists the main checkout, even when it looks like a session folder', () => {
    const main = [{ path: 'C:/work/api-preset-abc123', branch: 'preset/abc123' }]
    expect(leftoverWorktrees(main, [])).toEqual([])
  })
})

describe('selection', () => {
  const clean = candidate()
  const dirty = candidate({ path: 'C:/work/api-preset-dirty1', branch: 'preset/dirty1', dirtyFiles: 4, merged: false })

  it('ticks every row except those with uncommitted files', () => {
    expect([...initialTicks([clean, dirty])]).toEqual([clean.path])
  })

  it('toggles without changing the old set', () => {
    const ticks = initialTicks([clean, dirty])
    const next = toggled(ticks, dirty.path, true)
    expect(next.has(dirty.path)).toBe(true)
    expect(ticks.has(dirty.path)).toBe(false)
    expect(toggled(next, dirty.path, false).has(dirty.path)).toBe(false)
  })

  it('forces only rows with changes and deletes only merged branches', () => {
    const plan = cleanupPlan([clean, dirty], new Set([clean.path, dirty.path]), true)
    expect(plan.items).toEqual([
      { path: clean.path, branch: clean.branch, force: false, deleteBranch: true },
      { path: dirty.path, branch: dirty.branch, force: true, deleteBranch: false }
    ])
    expect(plan.mergedBranches).toEqual([clean.branch])
    expect(plan.lostFiles).toBe(4)
  })

  it('keeps every branch unless the box is ticked', () => {
    const plan = cleanupPlan([clean], new Set([clean.path]), false)
    expect(plan.items[0].deleteBranch).toBe(false)
    expect(plan.mergedBranches).toEqual([clean.branch])
  })

  it('leaves out unticked rows', () => {
    expect(cleanupPlan([clean], new Set(), true).items).toEqual([])
  })
})

describe('copy', () => {
  it('counts worktrees in the button and the title', () => {
    expect(removeLabel(1)).toBe('Remove 1 worktree')
    expect(removeLabel(3)).toBe('Remove 3 worktrees')
    expect(cleanupTitle('api-gateway', 3)).toBe('Remove 3 worktrees from closed sessions in api-gateway?')
    expect(cleanupTitle('api-gateway', 0)).toBe('Remove worktrees from closed sessions in api-gateway?')
  })

  it('names the merged branches', () => {
    expect(branchOptionLabel(['a', 'b'])).toBe('Also delete the merged branches (a, b)')
    expect(branchOptionLabel([])).toBe('Also delete the merged branches')
  })

  it('formats size and age', () => {
    expect(formatSize(214 * 1024 * 1024)).toBe('214 MB')
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(5 * 1024 * 1024, true)).toBe('5.0 MB+')
    const day = 86_400_000
    expect(formatAge(0, 3 * day + 5)).toBe('3 days')
    expect(formatAge(0, day)).toBe('1 day')
    expect(formatAge(0, 100)).toBe('today')
    expect(formatAge(0, 90 * day)).toBe('3 months')
    expect(candidateDetail(candidate({ createdAt: 0 }), 3 * day)).toBe('merged · 214 MB · 3 days')
  })

  it('offers the cleanup above three, and again only for more', () => {
    expect(shouldOfferCleanup(3, 0)).toBe(false)
    expect(shouldOfferCleanup(4, 0)).toBe(true)
    expect(shouldOfferCleanup(4, 4)).toBe(false)
    expect(shouldOfferCleanup(6, 4)).toBe(true)
  })
})
