import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseGitdirFile, parseHead, readHeadBranch } from '../../src/main/gitHead'

const SHA = '0123456789abcdef0123456789abcdef01234567'

describe('parseHead', () => {
  it('reads a branch, including slashes in its name', () => {
    expect(parseHead('ref: refs/heads/main\n')).toBe('main')
    expect(parseHead('ref: refs/heads/feature/rail-1103\r\n')).toBe('feature/rail-1103')
  })

  it('gives a short commit id when HEAD is detached', () => {
    expect(parseHead(`${SHA}\n`)).toBe('0123456')
  })

  it('does not guess at anything else', () => {
    expect(parseHead('')).toBeNull()
    expect(parseHead('ref: refs/heads/')).toBeNull()
    expect(parseHead('ref: refs/remotes/origin/main')).toBeNull()
    expect(parseHead('not a head')).toBeNull()
  })
})

describe('parseGitdirFile', () => {
  it('resolves a relative gitdir against the folder holding the file', () => {
    // A real absolute folder on every platform: 'C:' is only absolute on Windows.
    expect(parseGitdirFile('gitdir: ../main/.git/worktrees/x\n', join(tmpdir(), 'work', 'wt'))).toBe(join(tmpdir(), 'work', 'main', '.git', 'worktrees', 'x'))
  })

  it('keeps an absolute gitdir', () => {
    const absolute = join(tmpdir(), 'repo', '.git', 'worktrees', 'x')
    expect(parseGitdirFile(`gitdir: ${absolute}\n`, 'elsewhere')).toBe(absolute)
  })

  it('ignores a file that is not a gitdir pointer', () => {
    expect(parseGitdirFile('hello', 'here')).toBeNull()
  })
})

describe('readHeadBranch', () => {
  let root = ''
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dawsha-head-')) })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('reads a normal checkout and a folder inside it', async () => {
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'src', 'deep'), { recursive: true })
    writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/release/1.10.3\n')
    expect(await readHeadBranch(root)).toBe('release/1.10.3')
    expect(await readHeadBranch(join(root, 'src', 'deep'))).toBe('release/1.10.3')
  })

  it('follows the .git file of a worktree to its own HEAD', async () => {
    const main = join(root, 'main')
    const gitdir = join(main, '.git', 'worktrees', 'wt')
    mkdirSync(gitdir, { recursive: true })
    writeFileSync(join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(gitdir, 'HEAD'), 'ref: refs/heads/side\n')
    const worktree = join(root, 'wt')
    mkdirSync(worktree)
    writeFileSync(join(worktree, '.git'), `gitdir: ${gitdir}\n`)
    expect(await readHeadBranch(worktree)).toBe('side')
  })

  it('shows the short id for a detached worktree', async () => {
    const gitdir = join(root, 'gitdir')
    mkdirSync(gitdir)
    writeFileSync(join(gitdir, 'HEAD'), `${SHA}\n`)
    const worktree = join(root, 'wt')
    mkdirSync(worktree)
    writeFileSync(join(worktree, '.git'), 'gitdir: ../gitdir\n')
    expect(await readHeadBranch(worktree)).toBe('0123456')
  })

  it('returns null outside a repository, so git is asked instead', async () => {
    expect(await readHeadBranch(join(root, 'nowhere'))).toBeNull()
    mkdirSync(join(root, '.git'))
    expect(await readHeadBranch(root)).toBeNull()
  })
})
