import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commitWorktree, mergeBranch, mergeOverview, removeSessionWorktree } from '../../src/main/mergeBack'
import { createSessionWorktree } from '../../src/main/sessionWorktree'

const roots: string[] = []
const IDENTITY = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' }
const saved = { ...process.env }

beforeAll(() => Object.assign(process.env, IDENTITY))
afterAll(() => {
  process.env = saved
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } }).trim()

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-merge-'))
  roots.push(root)
  const repo = join(root, 'acme')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  return repo
}

async function worktreeOf(repo: string, short = 'abc123'): Promise<{ path: string; branch: string }> {
  const made = await createSessionWorktree(repo, short)
  if (!made.ok) throw new Error(made.error)
  return made
}

describe('createSessionWorktree', () => {
  it('adds a worktree on its own branch next to the repo', async () => {
    const repo = makeRepo()
    const made = await worktreeOf(repo)
    expect(made.branch).toBe('preset/abc123')
    expect(existsSync(made.path)).toBe(true)
    expect(git(made.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('preset/abc123')
  })
  it('refuses a bad id, a plain folder and an existing path', async () => {
    const repo = makeRepo()
    expect((await createSessionWorktree(repo, '../x')).ok).toBe(false)
    expect((await createSessionWorktree(mkdtempSync(join(tmpdir(), 'dawsha-plain-')), 'abc123')).ok).toBe(false)
    await worktreeOf(repo)
    expect((await createSessionWorktree(repo, 'abc123')).ok).toBe(false)
  })
})

describe('mergeOverview', () => {
  it('lists the files and counts, and rejects what Dawsha did not make', async () => {
    const repo = makeRepo()
    const tree = await worktreeOf(repo)
    writeFileSync(join(tree.path, 'b.txt'), 'x\ny\n')
    git(tree.path, 'add', '.')
    git(tree.path, 'commit', '-q', '-m', 'add b')
    writeFileSync(join(tree.path, 'loose.txt'), 'z\n')
    const overview = await mergeOverview({ repo, path: tree.path })
    expect(overview).toMatchObject({ ok: true, branch: 'preset/abc123', baseBranch: 'main', ahead: 1, worktreeDirtyFiles: 1, baseDirtyFiles: 0, lastSubject: 'add b' })
    expect(overview.ok && overview.files).toEqual([{ path: 'b.txt', added: 2, removed: 0 }])
    expect((await mergeOverview({ repo, path: repo })).ok).toBe(false)
    expect((await mergeOverview({ repo, path: 'C:\\nowhere-preset-abc123' })).ok).toBe(false)
    expect((await mergeOverview(null)).ok).toBe(false)
  })
})

describe('commitWorktree', () => {
  it('commits everything that is uncommitted, and wants a message', async () => {
    const repo = makeRepo()
    const tree = await worktreeOf(repo)
    writeFileSync(join(tree.path, 'a.txt'), 'changed\n')
    writeFileSync(join(tree.path, 'new.txt'), 'new\n')
    expect((await commitWorktree({ repo, path: tree.path, message: ' ' })).ok).toBe(false)
    expect((await commitWorktree({ repo, path: tree.path, message: 'Save work' })).ok).toBe(true)
    expect(git(tree.path, 'status', '--porcelain')).toBe('')
    expect(git(tree.path, 'log', '-1', '--format=%s')).toBe('Save work')
  })
})

describe('mergeBranch', () => {
  it('merges with a merge commit', async () => {
    const repo = makeRepo()
    const tree = await worktreeOf(repo)
    writeFileSync(join(tree.path, 'b.txt'), 'b\n')
    git(tree.path, 'add', '.')
    git(tree.path, 'commit', '-q', '-m', 'add b')
    const result = await mergeBranch({ repo, path: tree.path })
    expect(result).toEqual({ ok: true, message: 'Merged preset/abc123 into main.' })
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('b\n')
    expect(git(repo, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2)
  })

  it('refuses while the main folder has uncommitted changes', async () => {
    const repo = makeRepo()
    const tree = await worktreeOf(repo)
    writeFileSync(join(tree.path, 'b.txt'), 'b\n')
    git(tree.path, 'add', '.')
    git(tree.path, 'commit', '-q', '-m', 'add b')
    writeFileSync(join(repo, 'a.txt'), 'dirty\n')
    const result = await mergeBranch({ repo, path: tree.path })
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.error).toMatch(/main folder has 1 uncommitted file/)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
  })

  it('refuses while the worktree has uncommitted files', async () => {
    const repo = makeRepo()
    const tree = await worktreeOf(repo)
    writeFileSync(join(tree.path, 'loose.txt'), 'z\n')
    const result = await mergeBranch({ repo, path: tree.path })
    expect(!result.ok && result.error).toMatch(/worktree has 1 uncommitted file/)
  })

  it('aborts on a conflict and names the files', async () => {
    const repo = makeRepo()
    const tree = await worktreeOf(repo)
    writeFileSync(join(tree.path, 'a.txt'), 'from worktree\n')
    git(tree.path, 'commit', '-q', '-am', 'edit in worktree')
    writeFileSync(join(repo, 'a.txt'), 'from main\n')
    git(repo, 'commit', '-q', '-am', 'edit in main')
    const result = await mergeBranch({ repo, path: tree.path })
    expect(result).toMatchObject({ ok: false, conflicts: ['a.txt'] })
    expect(!result.ok && result.error).toContain('conflicts in a.txt')
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('from main\n')
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
  })

  it('has nothing to merge for an untouched worktree', async () => {
    const repo = makeRepo()
    const tree = await worktreeOf(repo)
    const result = await mergeBranch({ repo, path: tree.path })
    expect(!result.ok && result.error).toMatch(/nothing to merge/i)
  })
})

describe('removeSessionWorktree', () => {
  it('removes a merged worktree and its branch', async () => {
    const repo = makeRepo()
    const tree = await worktreeOf(repo)
    expect(await removeSessionWorktree({ repo, path: tree.path, force: false })).toEqual({ ok: true })
    expect(existsSync(tree.path)).toBe(false)
    expect(git(repo, 'branch', '--list', 'preset/abc123')).toBe('')
  })

  it('needs force to drop uncommitted work', async () => {
    const repo = makeRepo()
    const tree = await worktreeOf(repo)
    writeFileSync(join(tree.path, 'loose.txt'), 'z\n')
    expect((await removeSessionWorktree({ repo, path: tree.path, force: false })).ok).toBe(false)
    expect(existsSync(tree.path)).toBe(true)
    expect((await removeSessionWorktree({ repo, path: tree.path, force: true })).ok).toBe(true)
    expect(existsSync(tree.path)).toBe(false)
  })

  it('never removes the main folder or a branch Dawsha did not make', async () => {
    const repo = makeRepo()
    expect((await removeSessionWorktree({ repo, path: repo, force: true })).ok).toBe(false)
    expect(existsSync(repo)).toBe(true)
  })
})
