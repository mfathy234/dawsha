import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dirtyReport, untrackedFolders } from '../../src/main/gitDirty'
import { runGitQuick, stashArgs } from '../../src/main/gitQuick'
import { addGitIgnore } from '../../src/main/gitIgnore'

const IDENTITY = ['-c', 'core.autocrlf=false', '-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid']
const git = (cwd: string, ...args: string[]): string => execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' }).trim()

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'dawsha-quick-'))
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
  git(repo, 'branch', 'other')
  return repo
}

const branch = (repo: string): string => git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')

describe('stash arguments', () => {
  it('only include untracked files when asked', () => {
    expect(stashArgs(false, 'm')).toEqual(['stash', 'push', '-m', 'm'])
    expect(stashArgs(true, 'm')).toEqual(['stash', 'push', '-u', '-m', 'm'])
  })
})

describe('switching with a stash', () => {
  it('leaves new files in place and records no stash for an untracked-only tree', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'new.txt'), 'fresh\n')
    const result = await runGitQuick({ folder: repo, op: 'switch', branch: 'other', mode: 'local', stash: true, stashUntracked: false })
    expect(result.ok).toBe(true)
    expect(result.ok && result.message).not.toContain('stashed')
    expect(branch(repo)).toBe('other')
    expect(git(repo, 'stash', 'list')).toBe('')
    expect(existsSync(join(repo, 'new.txt'))).toBe(true)
  })

  it('stashes tracked changes but keeps new files when the box is off', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'edited\n')
    writeFileSync(join(repo, 'new.txt'), 'fresh\n')
    const result = await runGitQuick({ folder: repo, op: 'switch', branch: 'other', mode: 'local', stash: true })
    expect(result.ok).toBe(true)
    expect(result.ok && result.message).toContain('Apply last stash')
    expect(git(repo, 'stash', 'list')).toContain('Dawsha: main')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8').replace(/\r/g, '')).toBe('one\n')
    expect(existsSync(join(repo, 'new.txt'))).toBe(true)
  })

  it('stashes new files too when asked', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'edited\n')
    writeFileSync(join(repo, 'new.txt'), 'fresh\n')
    const result = await runGitQuick({ folder: repo, op: 'switch', branch: 'other', mode: 'local', stash: true, stashUntracked: true })
    expect(result.ok).toBe(true)
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
    expect(git(repo, 'show', '--name-only', '--format=', 'stash@{0}^3')).toContain('new.txt')
  })

  it('puts the stash back when the switch fails', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'local edit\n')
    const result = await runGitQuick({ folder: repo, op: 'switch', branch: 'missing', mode: 'local', stash: true })
    expect(result.ok).toBe(false)
    expect(branch(repo)).toBe('main')
    expect(git(repo, 'stash', 'list')).toBe('')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('local edit\n')
  })

  it('creating a branch carries changes without a stash', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'edited\n')
    const result = await runGitQuick({ folder: repo, op: 'switch', branch: 'feature/x', mode: 'create' })
    expect(result.ok).toBe(true)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('edited\n')
    expect(git(repo, 'stash', 'list')).toBe('')
  })
})

describe('dirty report', () => {
  it('counts tracked changes and sizes new files', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'edited\n')
    mkdirSync(join(repo, 'downloads'))
    writeFileSync(join(repo, 'downloads', 'one.bin'), Buffer.alloc(2000))
    writeFileSync(join(repo, 'downloads', 'two.bin'), Buffer.alloc(500))
    expect(await dirtyReport(repo)).toEqual({ ok: true, report: { modified: 1, untracked: 2, untrackedBytes: 2500, capped: false } })
  })

  it('reports a clean tree and refuses a folder that is not a repository', async () => {
    const repo = makeRepo()
    expect(await dirtyReport(repo)).toMatchObject({ ok: true, report: { modified: 0, untracked: 0 } })
    expect((await dirtyReport(mkdtempSync(join(tmpdir(), 'dawsha-none-')))).ok).toBe(false)
  })

  it('counts a staged new file as modified, not new', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'staged.txt'), 's\n')
    git(repo, 'add', 'staged.txt')
    expect(await dirtyReport(repo)).toMatchObject({ ok: true, report: { modified: 1, untracked: 0 } })
  })
})

describe('untracked folders', () => {
  it('lists only folders with nothing tracked or staged inside', async () => {
    const repo = makeRepo()
    mkdirSync(join(repo, 'downloads'))
    writeFileSync(join(repo, 'downloads', 'big.bin'), Buffer.alloc(3000))
    mkdirSync(join(repo, 'mixed'))
    writeFileSync(join(repo, 'mixed', 'staged.txt'), 's\n')
    git(repo, 'add', 'mixed/staged.txt')
    writeFileSync(join(repo, 'mixed', 'loose.txt'), 'l\n')
    expect(await untrackedFolders(repo)).toEqual({ ok: true, folders: [{ path: 'downloads/', files: 1, bytes: 3000, capped: false }] })
  })
})

describe('adding to .gitignore', () => {
  it('creates the file, is idempotent and keeps CRLF', async () => {
    const repo = makeRepo()
    mkdirSync(join(repo, 'downloads'))
    writeFileSync(join(repo, 'downloads', 'x.bin'), 'x')
    expect(await addGitIgnore({ folder: repo, path: 'downloads/' })).toEqual({ ok: true, entry: '/downloads/', added: true })
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('/downloads/\n')
    expect(await addGitIgnore({ folder: repo, path: 'downloads' })).toMatchObject({ ok: true, added: false })
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('/downloads/\n')
    mkdirSync(join(repo, 'dist'))
    writeFileSync(join(repo, '.gitignore'), 'node_modules\r\nlogs')
    await addGitIgnore({ folder: repo, path: 'dist' })
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('node_modules\r\nlogs\r\n/dist/\r\n')
  })

  it('rejects paths that leave the repository, tracked folders and missing folders', async () => {
    const repo = makeRepo()
    for (const bad of ['../x', '/abs', 'a/../../b', 'C:/x', 'a\nb', '']) {
      expect((await addGitIgnore({ folder: repo, path: bad })).ok).toBe(false)
    }
    expect((await addGitIgnore({ folder: repo, path: 'nope/' })).ok).toBe(false)
    mkdirSync(join(repo, 'src'))
    writeFileSync(join(repo, 'src', 't.txt'), 't')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'src')
    expect((await addGitIgnore({ folder: repo, path: 'src/' })).ok).toBe(false)
    expect(existsSync(join(repo, '.gitignore'))).toBe(false)
  })
})
