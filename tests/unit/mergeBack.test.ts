import { describe, expect, it } from 'vitest'
import {
  commitMessageProblem,
  conflictText,
  defaultCommitMessage,
  isOwnBranch,
  isOwnWorktree,
  mergeRefusal,
  numstatRows,
  parseConflictFiles,
  presetWorktreeNames,
  removeBlock,
  removeCopy,
  worktreeName,
  worktreeOfPane
} from '../../src/shared/mergeBack'

describe('preset worktree names', () => {
  it('sits next to the project and gets its own branch', () => {
    expect(presetWorktreeNames('C:\\work\\alpha', 'k3m9x2')).toEqual({ path: 'C:\\work\\alpha-preset-k3m9x2', branch: 'preset/k3m9x2' })
    expect(presetWorktreeNames('/home/me/alpha/', 'k3m9x2')).toEqual({ path: '/home/me/alpha-preset-k3m9x2', branch: 'preset/k3m9x2' })
  })
  it('recognises what Dawsha made and nothing else', () => {
    expect(isOwnBranch('preset/k3m9x2')).toBe(true)
    expect(isOwnBranch('compare/k3m9x2-a')).toBe(true)
    expect(isOwnBranch('main')).toBe(false)
    expect(isOwnBranch('preset/../main')).toBe(false)
    expect(isOwnWorktree('C:\\work\\alpha-preset-k3m9x2')).toBe(true)
    expect(isOwnWorktree('/w/alpha-compare-k3m9x2-b')).toBe(true)
    expect(isOwnWorktree('/w/alpha')).toBe(false)
  })
})

describe('worktreeOfPane', () => {
  const sides = { a: { path: '/w/a', branch: 'compare/abcd-a' }, b: { path: '/w/b', branch: 'compare/abcd-b' } }
  it('prefers the pane marker', () => {
    const worktree = { repo: '/r', path: '/w/x', branch: 'preset/abcd' }
    expect(worktreeOfPane({ worktree })).toEqual(worktree)
  })
  it('falls back to the compare side of the pane', () => {
    expect(worktreeOfPane({ compare: { id: 'i', slot: 'b', prompt: '', repo: '/r', sides } })).toEqual({ repo: '/r', path: '/w/b', branch: 'compare/abcd-b' })
  })
  it('is null for a plain pane or a shared-folder compare', () => {
    expect(worktreeOfPane({})).toBeNull()
    expect(worktreeOfPane({ compare: { id: 'i', slot: 'a', prompt: '', repo: '/r', sides: null } })).toBeNull()
  })
})

describe('git output parsing', () => {
  it('turns numstat into file rows', () => {
    expect(numstatRows('3\t1\tsrc/a.ts\0-\t-\timg.png\0')).toEqual([
      { path: 'src/a.ts', added: 3, removed: 1 },
      { path: 'img.png', added: null, removed: null }
    ])
  })
  it('lists conflicted files once', () => expect(parseConflictFiles('a.ts\nb/c.ts\n\na.ts\n')).toEqual(['a.ts', 'b/c.ts']))
})

describe('mergeRefusal', () => {
  const ok = { baseBranch: 'main', baseDirtyFiles: 0, worktreeDirtyFiles: 0, ahead: 2 }
  it('allows a clean merge', () => expect(mergeRefusal(ok)).toBeNull())
  it('refuses a detached main folder', () => expect(mergeRefusal({ ...ok, baseBranch: null })).toMatch(/no branch/i))
  it('refuses an unclean main folder and names the count', () => expect(mergeRefusal({ ...ok, baseDirtyFiles: 1 })).toMatch(/1 uncommitted file\b/))
  it('refuses while the worktree has uncommitted work', () => expect(mergeRefusal({ ...ok, worktreeDirtyFiles: 3 })).toMatch(/3 uncommitted files.*commit/i))
  it('refuses when there is nothing to merge', () => expect(mergeRefusal({ ...ok, ahead: 0 })).toMatch(/nothing to merge/i))
})

describe('messages', () => {
  it('says which files conflict', () => expect(conflictText('main', ['a.ts', 'b.ts'])).toBe('Merging into main conflicts in a.ts, b.ts. The merge was aborted and nothing changed.'))
  it('shortens a long conflict list', () => expect(conflictText('main', Array.from({ length: 12 }, (_, i) => `f${i}`))).toContain('and 4 more'))
  it('proposes a commit message from the branch', () => expect(defaultCommitMessage('preset/k3m9x2')).toBe('Work from preset k3m9x2'))
  it('requires a commit message', () => {
    expect(commitMessageProblem('  ')).toMatch(/message/i)
    expect(commitMessageProblem('Fix it')).toBeNull()
  })
  it('refuses removal while the session runs', () => {
    expect(removeBlock(true)).toMatch(/running/i)
    expect(removeBlock(false)).toBeNull()
  })
})

describe('removeCopy', () => {
  it('names the folder in the title, body and button', () => {
    const copy = removeCopy('C:\\work\\alpha-preset-k3m9x2', 'preset/k3m9x2', { ahead: 0, dirtyFiles: 0 })
    expect(copy.title).toContain('C:\\work\\alpha-preset-k3m9x2')
    expect(copy.body).toContain('C:\\work\\alpha-preset-k3m9x2')
    expect(copy.confirmLabel).toBe('Remove alpha-preset-k3m9x2')
    expect(copy.force).toBe(false)
  })
  it('warns about work that would be lost and forces the removal', () => {
    const copy = removeCopy('/w/a-preset-k3m9x2', 'preset/k3m9x2', { ahead: 2, dirtyFiles: 1 })
    expect(copy.body).toContain('1 uncommitted file and 2 commits that are not merged')
    expect(copy.force).toBe(true)
  })
  it('takes the last path segment as the name', () => {
    expect(worktreeName('/a/b/c/')).toBe('c')
    expect(worktreeName('C:\\a\\b')).toBe('b')
  })
})
