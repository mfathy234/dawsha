import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWorktrees, probeRepo, removeWorktree, worktreeStatus } from '../../src/main/compare'

const IDENTITY = ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' }).trim()
}

function makeRepo(commit = true): string {
  const root = mkdtempSync(join(tmpdir(), 'dawsha-compare-'))
  const repo = join(root, 'acme-web')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  if (commit) {
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'first')
  }
  return repo
}

describe('probeRepo', () => {
  it('reports a repository with commits and its branch', async () => {
    expect(await probeRepo(makeRepo())).toEqual({ isRepo: true, hasCommits: true, branch: 'main' })
  })

  it('reports a repository without commits and a plain folder', async () => {
    const empty = await probeRepo(makeRepo(false))
    expect(empty.isRepo).toBe(true)
    expect(empty.hasCommits).toBe(false)
    const plain = mkdtempSync(join(tmpdir(), 'dawsha-plain-'))
    expect(await probeRepo(plain)).toEqual({ isRepo: false, hasCommits: false, branch: null })
  })
})

describe('createWorktrees', () => {
  it('creates two sibling worktrees on new branches from HEAD', async () => {
    const repo = makeRepo()
    const result = await createWorktrees(repo, 'x7k2p9')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sides.a.path.endsWith('acme-web-compare-x7k2p9-a')).toBe(true)
    expect(existsSync(join(result.sides.a.path, 'README.md'))).toBe(true)
    expect(existsSync(join(result.sides.b.path, 'README.md'))).toBe(true)
    expect(git(result.sides.a.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('compare/x7k2p9-a')
    expect(git(repo, 'branch', '--list', 'compare/x7k2p9-b')).toContain('compare/x7k2p9-b')
  })

  it('returns the git error when the repository has no commit to start from and leaves nothing behind', async () => {
    const repo = makeRepo(false)
    const result = await createWorktrees(repo, 'abc123')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.length).toBeGreaterThan(0)
    expect(existsSync(`${repo}-compare-abc123-a`)).toBe(false)
  })

  it('rolls the first worktree back when the second cannot be created', async () => {
    const repo = makeRepo()
    git(repo, 'branch', 'compare/abc123-b')
    const result = await createWorktrees(repo, 'abc123')
    expect(result.ok).toBe(false)
    expect(existsSync(`${repo}-compare-abc123-a`)).toBe(false)
    expect(git(repo, 'branch', '--list', 'compare/abc123-a')).toBe('')
  })

  it('refuses an invalid id and an existing folder', async () => {
    const repo = makeRepo()
    expect(await createWorktrees(repo, '../evil')).toEqual({ ok: false, error: 'The compare id is not valid.' })
    mkdirSync(`${repo}-compare-taken1-a`)
    const taken = await createWorktrees(repo, 'taken1')
    expect(taken.ok).toBe(false)
  })
})

describe('worktreeStatus and removeWorktree', () => {
  it('counts uncommitted files and commits of its own, and keeps dirty work unless forced', async () => {
    const repo = makeRepo()
    const made = await createWorktrees(repo, 'k3m4n5')
    if (!made.ok) throw new Error(made.error)
    const { a } = made.sides
    expect(await worktreeStatus(repo, a.path, a.branch)).toEqual({ exists: true, dirtyFiles: 0, commits: 0 })
    writeFileSync(join(a.path, 'one.txt'), '1')
    writeFileSync(join(a.path, 'two.txt'), '2')
    expect(await worktreeStatus(repo, a.path, a.branch)).toMatchObject({ dirtyFiles: 2, commits: 0 })
    git(a.path, 'add', '.')
    git(a.path, 'commit', '-q', '-m', 'work')
    expect(await worktreeStatus(repo, a.path, a.branch)).toEqual({ exists: true, dirtyFiles: 0, commits: 1 })

    writeFileSync(join(a.path, 'three.txt'), '3')
    const kept = await removeWorktree({ repo, path: a.path, branch: a.branch, force: false })
    expect(kept.ok).toBe(false)
    expect(existsSync(a.path)).toBe(true)

    const removed = await removeWorktree({ repo, path: a.path, branch: a.branch, force: true })
    expect(removed).toEqual({ ok: true })
    expect(existsSync(a.path)).toBe(false)
    expect(git(repo, 'branch', '--list', a.branch)).toBe('')
  })

  it('removes a clean worktree and tolerates one that is already gone', async () => {
    const repo = makeRepo()
    const made = await createWorktrees(repo, 'p2q3r4')
    if (!made.ok) throw new Error(made.error)
    const { b } = made.sides
    expect(await removeWorktree({ repo, path: b.path, branch: b.branch, force: false })).toEqual({ ok: true })
    expect(await worktreeStatus(repo, b.path, b.branch)).toEqual({ exists: false, dirtyFiles: 0, commits: 0 })
    expect(await removeWorktree({ repo, path: b.path, branch: b.branch, force: false })).toEqual({ ok: true })
  })

  it('never touches a branch or folder that was not made for a comparison', async () => {
    const repo = makeRepo()
    const branch = await removeWorktree({ repo, path: `${repo}-compare-abc123-a`, branch: 'main', force: true })
    expect(branch.ok).toBe(false)
    const folder = await removeWorktree({ repo, path: repo, branch: 'compare/abc123-a', force: true })
    expect(folder.ok).toBe(false)
    expect(existsSync(repo)).toBe(true)
    expect(git(repo, 'branch', '--list', 'main')).toContain('main')
  })
})
